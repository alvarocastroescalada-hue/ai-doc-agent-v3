import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

import { parseDocument } from "../parser/parseDocument";
import { chunkTextAdaptive } from "../indexing/chunker";
import { embedTexts } from "../indexing/embedder";
import { upsertChunks } from "../indexing/vectorStore";
import { multiRetrieve } from "../rag/multiRetrieve";
import { buildRagContext } from "../rag/buildContext";
import { loadMemory } from "../memory/memoryStore";
import { queryMemorySimilar, upsertMemoryVectors } from "../memory/memoryIndex";
import { exportBacklogToExcel } from "../export/exportExcel";
import { getGoldenStoryTexts } from "../golden/indexGoldenStories";
import { loadGoldenStoriesFromExcel } from "../golden/loadGoldenFromExcel";
import { evaluateBacklogAgainstExpected } from "../evaluation/evaluateBacklog";
import { getLearningGuidanceText, suggestTargetStories, updateLearningFromRun } from "../learning/qualityLearning";
import { loadHumanFeedback } from "../feedback/humanFeedback";

import { openai, MODELS } from "../reasoning/llmClient";
import {
  systemPolicyPrompt,
  analysisPrompt,
  extractionPrompt,
  extractionRefinementPrompt,
  gapCoveragePrompt,
  validationPrompt
} from "../reasoning/prompts";

import {
  BacklogSchema,
  ValidationReportSchema
} from "../models/schemas";

import { applyDeterministicQualityGate } from "../quality/qualityGate";

const TOP_K = 12;
const MEMORY_TOP_K = 6;
const MEMORY_QUERY_CHARS = 2000;
const HARD_CONSTRAINTS_MODE = (process.env.HARD_CONSTRAINTS_MODE || "warn").toLowerCase();
const MIN_QUALITY_SCORE = Number(process.env.MIN_QUALITY_SCORE || 0.55);
const MIN_VALIDATION_SCORE = Number(process.env.MIN_VALIDATION_SCORE || 75);
const MIN_FUNCTIONALITY_COVERAGE = Number(process.env.MIN_FUNCTIONALITY_COVERAGE || 0.7);

/* ================= NORMALIZACION ================= */

function normalizeBacklog(backlogRaw: any) {

  for (const story of backlogRaw.userStories || []) {

    // TRACEABILITY
    if (!Array.isArray(story.traceability)) {
      story.traceability = [];
    }
    story.traceability = story.traceability.map((t: any) => {
      if (typeof t === "string") {
        return { chunkId: t, confidence: 0.8 };
      }
      if (typeof t === "object" && t.chunkId) {
        return {
          chunkId: t.chunkId,
          confidence: t.confidence ?? 0.8
        };
      }
      return { chunkId: "unknown", confidence: 0.5 };
    });
    if (story.traceability.length === 0) {
      story.traceability.push({ chunkId: "unknown", confidence: 0.5 });
    }

    // ACCEPTANCE CRITERIA
    if (!Array.isArray(story.acceptanceCriteria)) {
      story.acceptanceCriteria = [];
    }

    story.acceptanceCriteria = story.acceptanceCriteria.map((ac: any) => {
      if (typeof ac === "string") return ac;
      if (typeof ac === "object") {
        if (ac.given && ac.when && ac.then) {
          return `DADO ${ac.given} CUANDO ${ac.when} ENTONCES ${ac.then}`;
        }
        return Object.values(ac).join(" ");
      }
      return String(ac);
    });

    while (story.acceptanceCriteria.length < 5) {
      story.acceptanceCriteria.push(
        "DADO un contexto valido CUANDO se ejecuta la accion ENTONCES el sistema responde segun la regla definida."
      );
    }
  }

  return backlogRaw;
}

/* ================= RUN AGENT ================= */

export async function runAgent(
  filePath: string,
  options?: { useGolden?: boolean }
): Promise<{
  base: string;
  outputs: {
    backlogJson: string;
    validationJson: string;
    requirementsJson: string;
    retrievalJson: string;
    evalJson: string;
    excel: string;
  };
}> {

  console.log("1. PARSE");
  const parsed = await parseDocument(filePath);

  console.log("2. CHUNK");
  const chunks = chunkTextAdaptive(parsed.rawText, 600, 120);

  console.log("3. EMBEDDINGS");
  const embeddings = await embedTexts(chunks.map(c => c.content));

  await upsertChunks(
    chunks.map((c, idx) => ({
      chunkId: c.chunkId,
      content: c.content,
      embedding: embeddings[idx],
      documentId: parsed.documentId,
      versionId: parsed.versionId,
      chunkHash: c.hash,
      chunkIndex: c.index
    }))
  );

  console.log("4. RETRIEVAL");
  const useGolden = options?.useGolden !== false;
  let goldenData: ReturnType<typeof getGoldenStoryTexts> | null = null;
  if (useGolden) {
    goldenData = getGoldenStoryTexts();
  }
  const humanFeedback = loadHumanFeedback();

  const retrievedPack = await multiRetrieve({
    topK: TOP_K,
    documentId: parsed.documentId,
    versionId: parsed.versionId,
    categories: ["functional","integration","security","data","flows","nfr"]
  });

  const memoryHits = await buildMemoryContext(parsed.rawText);
  const analysisContext = buildRagContext({
    ...retrievedPack,
    memoryHits
  });

  console.log("5. ANALYSIS");
  const requirementsObj = await callLLMJson(analysisPrompt(analysisContext));

  console.log("6. EXTRACTION");
  const goldenStyleGuide = useGolden && goldenData
    ? buildGoldenStyleGuide(goldenData.stories)
    : "";
  const actorGuide = buildActorGuide(requirementsObj);
  const learningGuide = getLearningGuidanceText();
  const extractionTargets = buildExtractionTargets(requirementsObj, learningGuide, humanFeedback.guideText);

  const rawExtraction = await callLLMJson(
    extractionPrompt(
      JSON.stringify(requirementsObj),
      goldenStyleGuide,
      actorGuide,
      extractionTargets,
      humanFeedback.guideText
    )
  );

  let userStories: any[] = [];

  if (Array.isArray(rawExtraction)) {
    userStories = rawExtraction;
  } else if (Array.isArray(rawExtraction.userStories)) {
    userStories = rawExtraction.userStories;
  } else if (Array.isArray(rawExtraction.stories)) {
    userStories = rawExtraction.stories;
  } else {
    console.error("Extraction returned:", rawExtraction);
    throw new Error("Extraction did not return valid userStories array.");
  }

  const targetStoryCount = resolveTargetStoryCount(requirementsObj);
  const maxRefinementPasses = 3;
  let refinementPass = 0;
  while (userStories.length < targetStoryCount && refinementPass < maxRefinementPasses) {
    refinementPass++;
    const beforeCount = userStories.length;
    console.log(`6b. REFINEMENT #${refinementPass} (${beforeCount} -> min ${targetStoryCount})`);

    const refinedRaw = await callLLMJson(
      extractionRefinementPrompt(
        JSON.stringify(requirementsObj),
        JSON.stringify(userStories),
        targetStoryCount,
        beforeCount,
        refinementPass,
        goldenStyleGuide,
        actorGuide,
        extractionTargets,
        humanFeedback.guideText
      )
    );

    const refinedStories = Array.isArray(refinedRaw?.userStories)
      ? refinedRaw.userStories
      : Array.isArray(refinedRaw)
        ? refinedRaw
        : [];

    if (refinedStories.length > userStories.length) {
      userStories = refinedStories;
    } else {
      break;
    }
  }

  const coverageBeforeGap = buildFunctionalityCoverage(requirementsObj, userStories);
  if (
    coverageBeforeGap.coverage < MIN_FUNCTIONALITY_COVERAGE &&
    coverageBeforeGap.uncoveredTop.length > 0
  ) {
    console.log(`6c. GAP_COVERAGE (${coverageBeforeGap.coveredFunctionalities}/${coverageBeforeGap.totalFunctionalities})`);
    const gapRaw = await callLLMJson(
      gapCoveragePrompt(
        JSON.stringify(requirementsObj),
        JSON.stringify(userStories),
        JSON.stringify(coverageBeforeGap.uncoveredTop),
        targetStoryCount,
        actorGuide,
        goldenStyleGuide,
        humanFeedback.guideText
      )
    );

    const additionalStories = Array.isArray(gapRaw?.additionalUserStories)
      ? gapRaw.additionalUserStories
      : [];

    if (additionalStories.length > 0) {
      userStories = dedupeStoriesByIntent([...userStories, ...additionalStories]);
    }
  }

  const backlogCandidate = normalizeBacklog({
    documentId: parsed.documentId,
    versionId: parsed.versionId,
    generatedAt: new Date().toISOString(),
    userStories
  });
  enforceActorConsistency(backlogCandidate, requirementsObj);
  enrichTraceabilityFromEvidence(backlogCandidate, requirementsObj, retrievedPack.merged);

  const backlog = BacklogSchema.parse(backlogCandidate);

  console.log("7. VALIDATION");

  const validation = ValidationReportSchema.parse(
    await callLLMJson(
      validationPrompt(JSON.stringify(backlog))
    )
  );

  const finalValidation = applyDeterministicQualityGate(
    backlog,
    validation,
    parsed.rawText.length
  );

  const evaluation = buildExpectedStoriesEvaluation(backlog.userStories) as any;
  const functionalityCoverage = buildFunctionalityCoverage(requirementsObj, backlog.userStories);
  evaluation.functionalityCoverage = functionalityCoverage;

  const hardConstraints = evaluateHardConstraints({
    generatedStoriesCount: backlog.userStories.length,
    targetStoryCount,
    validationScore: finalValidation.score,
    qualityScore: typeof evaluation?.qualityScore === "number" ? evaluation.qualityScore : 0,
    functionalityCoverageRatio: functionalityCoverage.coverage
  });
  evaluation.hardConstraints = hardConstraints;

  if (!hardConstraints.passed) {
    const message = `Hard constraints failed: ${hardConstraints.violations.join(" | ")}`;
    if (HARD_CONSTRAINTS_MODE === "fail") {
      throw new Error(message);
    }
    console.warn(message);
  }

  console.log("8. SAVE");

  const outDir = path.resolve("outputs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const base = parsed.filename.replace(/\.[^/.]+$/, "");

  const outputs = {
    backlogJson: path.join(outDir, `${base}.backlog.json`),
    validationJson: path.join(outDir, `${base}.validation.json`),
    requirementsJson: path.join(outDir, `${base}.requirements.json`),
    retrievalJson: path.join(outDir, `${base}.retrieval.json`),
    evalJson: path.join(outDir, `${base}.eval.json`),
    excel: path.join(outDir, `${base}.backlog.xlsx`)
  };

  fs.writeFileSync(
    outputs.requirementsJson,
    JSON.stringify(requirementsObj, null, 2)
  );

  fs.writeFileSync(
    outputs.retrievalJson,
    JSON.stringify(
      {
        ...retrievedPack
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    outputs.backlogJson,
    JSON.stringify(backlog, null, 2)
  );

  fs.writeFileSync(
    outputs.validationJson,
    JSON.stringify(finalValidation, null, 2)
  );

  fs.writeFileSync(
    outputs.evalJson,
    JSON.stringify(evaluation, null, 2)
  );

  const expectedForLearning = loadExpectedStories();
  const feedbackForLearning = expectedForLearning.length > 0 ? expectedForLearning : humanFeedback.stories;
  const learningUpdate = updateLearningFromRun({
    generatedStories: backlog.userStories,
    expectedStories: feedbackForLearning,
    validationScore: finalValidation.score,
    qualityScore: typeof (evaluation as any)?.qualityScore === "number"
      ? (evaluation as any).qualityScore
      : 0,
    functionalityCoverage: functionalityCoverage.coverage,
    validationFindings: finalValidation.findings,
    options: {
      minQualityScore: MIN_QUALITY_SCORE,
      minValidationScore: MIN_VALIDATION_SCORE
    }
  });
  console.log("Learning update:", JSON.stringify(learningUpdate));

  await exportBacklogToExcel(
    backlog,
    outputs.excel,
    {
      actors: Array.isArray(requirementsObj?.actors) ? requirementsObj.actors : []
    }
  );

  console.log("DONE");
  return { base, outputs };
}

/* ================= LLM ================= */

async function callLLMJson(userPrompt: string): Promise<any> {

  const res: any = await openai.chat.completions.create({
    model: MODELS.chat,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPolicyPrompt() },
      { role: "user", content: userPrompt }
    ]
  });

  const content = String(res?.choices?.[0]?.message?.content ?? "");
  const parsed = parseJsonFromLLMContent(content);
  if (parsed === null) {
    console.error("LLM RAW RESPONSE:", content);
    throw new Error("LLM did not return parseable JSON.");
  }

  return parsed;
}

function parseJsonFromLLMContent(content: string) {
  const trimmed = String(content || "").trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  const fenced = extractFencedBlocks(trimmed);
  candidates.push(...fenced);
  candidates.push(...extractBalancedJsonCandidates(trimmed));

  for (const candidate of candidates) {
    const value = tryParseJson(candidate);
    if (value !== null) return value;
  }

  return null;
}

function extractFencedBlocks(content: string) {
  const blocks: string[] = [];
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(content)) !== null) {
    const body = String(match[1] || "").trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

function extractBalancedJsonCandidates(content: string) {
  const results: string[] = [];
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch !== "{" && ch !== "[") continue;

    const end = findBalancedJsonEnd(content, i);
    if (end !== -1) {
      results.push(content.slice(i, end + 1));
    }
  }
  return results;
}

function findBalancedJsonEnd(content: string, start: number) {
  const opener = content[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === opener) depth++;
    if (ch === closer) depth--;

    if (depth === 0) return i;
  }

  return -1;
}

function tryParseJson(raw: string) {
  const candidate = String(raw || "").trim();
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function buildMemoryContext(rawText: string) {
  const memory = loadMemory();
  if (memory.items.length > 0) {
    const memoryTexts = memory.items.map(item =>
      `TITLE: ${item.title}\nCONTENT: ${item.content}\nTAGS: ${item.tags.join(", ")}`
    );

    const memoryEmbeddings = await embedTexts(memoryTexts);

    await upsertMemoryVectors(
      memory.items.map((item, idx) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        tags: item.tags.join(", "),
        embedding: memoryEmbeddings[idx],
        updatedAt: item.updatedAt
      }))
    );
  }

  const queryText = rawText.slice(0, MEMORY_QUERY_CHARS);
  const [queryEmbedding] = await embedTexts([
    `Resumen del documento:\n${queryText}`
  ]);

  return queryMemorySimilar(queryEmbedding, MEMORY_TOP_K, {
    excludeTagContains: ["golden_excel"]
  });
}

function buildGoldenStyleGuide(stories: Array<{
  title: string;
  role: string;
  want: string;
  soThat: string;
  notesHu: string;
  acceptanceCriteria: string[];
}>) {
  if (stories.length === 0) return "";

  const roleCounts = new Map<string, number>();
  const sectionCounts = new Map<string, number>();
  let totalAc = 0;

  for (const s of stories) {
    const role = String(s.role || "").trim();
    if (role) roleCounts.set(role, (roleCounts.get(role) || 0) + 1);

    totalAc += Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria.length : 0;

    const lines = String(s.notesHu || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("- ")) continue;
      const section = trimmed.replace(/^- /, "").trim();
      if (!section) continue;
      if (section.toLowerCase().startsWith("dado ")) continue;
      sectionCounts.set(section, (sectionCounts.get(section) || 0) + 1);
    }
  }

  const topRoles = Array.from(roleCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([role, count]) => `${role} (${count})`);

  const topSections = Array.from(sectionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([section, count]) => `${section} (${count})`);

  const avgAc = (totalAc / stories.length).toFixed(1);

  const templates = stories.slice(0, 2).map((s, idx) => {
    const ac = (s.acceptanceCriteria || []).slice(0, 3).join(" | ");
    return `[template_${idx + 1}]
TITLE: ${s.title}
ROLE: ${s.role}
WANT: ${s.want}
SO THAT: ${s.soThat}
AC_SAMPLE: ${ac}`;
  });

  return `
PATRONES GOLDEN (objetivo de calidad/forma; no reutilizar contenido literal):
- total_historias_golden: ${stories.length}
- media_criterios_aceptacion_por_hu: ${avgAc}
- roles_frecuentes: ${topRoles.join(", ") || "n/a"}
- secciones_notas_frecuentes: ${topSections.join(", ") || "n/a"}
- estándar_formato_ac: DADO/CUANDO/ENTONCES con escenarios de error y edge case

PLANTILLAS DE FORMA:
${templates.join("\n\n")}
`.trim();
}

function buildActorGuide(requirementsObj: any) {
  const actors = Array.isArray(requirementsObj?.actors) ? requirementsObj.actors : [];
  if (actors.length === 0) return "No hay actores explícitos; inferir del contexto funcional.";

  return actors
    .map((a: any, idx: number) => {
      const name = String(a?.name || "").trim();
      const description = String(a?.description || "").trim();
      return `- actor_${idx + 1}: ${name}${description ? ` | ${description}` : ""}`;
    })
    .join("\n");
}

function buildExtractionTargets(requirementsObj: any, learningGuide?: string, humanFeedbackGuide?: string) {
  const functionalities = Array.isArray(requirementsObj?.functionalities)
    ? requirementsObj.functionalities
    : [];
  const actors = Array.isArray(requirementsObj?.actors) ? requirementsObj.actors : [];

  const targetMinStories = resolveTargetStoryCount(requirementsObj);
  const categories = new Set(
    functionalities
      .map((f: any) => String(f?.category || "").trim())
      .filter(Boolean)
  );

  const lines = [
    `- min_historias_objetivo: ${targetMinStories}`,
    `- funcionalidad_total_detectada: ${functionalities.length}`,
    `- actores_detectados: ${actors.length}`,
    `- categorias_detectadas: ${Array.from(categories).join(", ") || "n/a"}`,
    "- regla_cobertura: intenta mapear 1 historia por funcionalidad atómica; solo agrupar si no se pierde testabilidad."
  ];

  if (learningGuide?.trim()) {
    lines.push("- patrones_aprendidos_previos:");
    lines.push(...learningGuide.split("\n"));
  }
  if (humanFeedbackGuide?.trim()) {
    lines.push("- feedback_humano_relevante:");
    lines.push(...humanFeedbackGuide.split("\n").slice(0, 20));
  }

  return lines.join("\n");
}

function resolveTargetStoryCount(requirementsObj: any) {
  const functionalities = Array.isArray(requirementsObj?.functionalities)
    ? requirementsObj.functionalities.length
    : 0;
  const expectedCount = getExpectedStoriesCount();
  return suggestTargetStories(functionalities, expectedCount);
}

function enforceActorConsistency(backlogCandidate: any, requirementsObj: any) {
  const stories = Array.isArray(backlogCandidate?.userStories) ? backlogCandidate.userStories : [];
  const actors = Array.isArray(requirementsObj?.actors) ? requirementsObj.actors : [];
  const functionalities = Array.isArray(requirementsObj?.functionalities) ? requirementsObj.functionalities : [];

  if (stories.length === 0 || actors.length === 0) return;

  const actorById = new Map<string, any>();
  const canonicalActors = actors
    .map((a: any) => ({
      id: String(a?.id || ""),
      name: String(a?.name || "").trim(),
      description: String(a?.description || "").trim()
    }))
    .filter((a: any) => a.name.length > 0);

  for (const actor of canonicalActors) {
    if (actor.id) actorById.set(actor.id, actor);
  }

  for (const story of stories) {
    const role = String(story?.role || "").trim();
    const roleNorm = normalizeForMatch(role);

    const direct = canonicalActors.find((a: any) => normalizeForMatch(a.name) === roleNorm);
    if (direct) {
      story.role = direct.name;
      continue;
    }

    const bestByAction = findBestActorByFunctionality(story, functionalities, actorById);
    const fallbackByName = findBestActorByTextMatch(role, canonicalActors);
    const chosen = bestByAction || fallbackByName;

    if (chosen) {
      story.role = chosen.name;
      story.assumptions = Array.isArray(story.assumptions) ? story.assumptions : [];
      story.assumptions.push(`Actor normalizado a '${chosen.name}' usando catálogo de actores del input.`);
    } else if (canonicalActors.length > 0) {
      story.openQuestions = Array.isArray(story.openQuestions) ? story.openQuestions : [];
      story.openQuestions.push(`Confirmar actor para la historia '${story.storyId || story.title || "sin_id"}'. Actores disponibles: ${canonicalActors.map((a: any) => a.name).join(", ")}.`);
    }
  }
}

function findBestActorByFunctionality(
  story: any,
  functionalities: any[],
  actorById: Map<string, any>
) {
  if (!Array.isArray(functionalities) || functionalities.length === 0) return null;

  const storyText = `${story?.want || ""} ${story?.soThat || ""}`.trim();
  if (!storyText) return null;

  let bestScore = 0;
  let bestActor: any = null;

  for (const f of functionalities) {
    const sourceText = `${f?.action || ""} ${f?.userGoal || ""} ${f?.benefit || ""}`.trim();
    if (!sourceText) continue;

    const score = overlapScore(storyText, sourceText);
    if (score <= bestScore) continue;

    const actor = actorById.get(String(f?.actorId || ""));
    if (!actor?.name) continue;

    bestScore = score;
    bestActor = actor;
  }

  return bestScore >= 0.15 ? bestActor : null;
}

function findBestActorByTextMatch(role: string, actors: Array<{ name: string; description: string }>) {
  const roleNorm = normalizeForMatch(role);
  if (!roleNorm) return null;

  let bestScore = 0;
  let best: any = null;

  for (const actor of actors) {
    const candidate = `${actor.name} ${actor.description}`.trim();
    const score = overlapScore(roleNorm, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = actor;
    }
  }

  return bestScore >= 0.2 ? best : null;
}

function normalizeForMatch(text: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlapScore(a: string, b: string) {
  const sa = new Set(normalizeForMatch(a).split(" ").filter(t => t.length >= 3));
  const sb = new Set(normalizeForMatch(b).split(" ").filter(t => t.length >= 3));
  if (sa.size === 0 || sb.size === 0) return 0;

  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter++;
  }
  return inter / Math.max(sa.size, sb.size);
}

function dedupeStoriesByIntent(stories: any[]) {
  const input = Array.isArray(stories) ? stories : [];
  const kept: any[] = [];

  for (const s of input) {
    const keyText = `${s?.role || ""} ${s?.title || ""} ${s?.want || ""}`.trim();
    const duplicate = kept.some(k => overlapScore(
      keyText,
      `${k?.role || ""} ${k?.title || ""} ${k?.want || ""}`.trim()
    ) >= 0.82);

    if (!duplicate) kept.push(s);
  }

  return kept;
}

function enrichTraceabilityFromEvidence(
  backlogCandidate: any,
  requirementsObj: any,
  mergedChunks: Array<{ chunkId: string; content: string; score: number }>
) {
  const stories = Array.isArray(backlogCandidate?.userStories) ? backlogCandidate.userStories : [];
  const functionalities = Array.isArray(requirementsObj?.functionalities)
    ? requirementsObj.functionalities
    : [];
  const chunks = Array.isArray(mergedChunks) ? mergedChunks : [];

  for (const story of stories) {
    const storyText = `${story?.title || ""} ${story?.want || ""} ${story?.soThat || ""} ${(story?.acceptanceCriteria || []).join(" ")}`.trim();
    const picks: Array<{ chunkId: string; confidence: number }> = [];

    let bestFunctionality: any = null;
    let bestFuncScore = 0;
    for (const f of functionalities) {
      const fText = `${f?.action || ""} ${f?.userGoal || ""} ${f?.benefit || ""} ${(f?.validations || []).join(" ")}`.trim();
      const score = overlapScore(storyText, fText);
      if (score > bestFuncScore) {
        bestFuncScore = score;
        bestFunctionality = f;
      }
    }

    if (bestFunctionality?.sourceChunkIds && Array.isArray(bestFunctionality.sourceChunkIds)) {
      for (const cid of bestFunctionality.sourceChunkIds.slice(0, 3)) {
        if (!cid) continue;
        picks.push({
          chunkId: String(cid),
          confidence: Math.max(0.55, Math.min(0.95, bestFuncScore || 0.55))
        });
      }
    }

    const chunkMatches = chunks
      .map(c => ({
        chunkId: c.chunkId,
        confidence: overlapScore(storyText, c.content)
      }))
      .filter(c => c.confidence >= 0.12)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)
      .map(c => ({
        chunkId: c.chunkId,
        confidence: Math.max(0.5, Math.min(0.9, c.confidence))
      }));

    const merged = [...picks, ...chunkMatches];
    const seen = new Set<string>();
    const finalTrace = merged
      .filter(t => {
        if (!t.chunkId || seen.has(t.chunkId)) return false;
        seen.add(t.chunkId);
        return true;
      })
      .slice(0, 4);

    if (finalTrace.length > 0) {
      story.traceability = finalTrace;
    }
  }
}

function buildExpectedStoriesEvaluation(userStories: any[]) {
  const expectedFolder = path.resolve("context", "expected_stories");
  if (!fs.existsSync(expectedFolder)) {
    return {
      status: "skipped",
      reason: "Folder context/expected_stories not found."
    };
  }

  const excelFiles = fs.readdirSync(expectedFolder)
    .filter(f => f.toLowerCase().endsWith(".xlsx"));
  if (excelFiles.length === 0) {
    return {
      status: "skipped",
      reason: "No .xlsx files found in context/expected_stories."
    };
  }

  const expectedStories = loadGoldenStoriesFromExcel(expectedFolder);
  return evaluateBacklogAgainstExpected(userStories, expectedStories);
}

function buildFunctionalityCoverage(requirementsObj: any, userStories: any[]) {
  const functionalities = Array.isArray(requirementsObj?.functionalities)
    ? requirementsObj.functionalities
    : [];
  const stories = Array.isArray(userStories) ? userStories : [];

  if (functionalities.length === 0) {
    return {
      totalFunctionalities: 0,
      coveredFunctionalities: 0,
      coverage: 0,
      uncoveredTop: []
    };
  }

  const covered: Array<{ id: string; score: number }> = [];
  const uncovered: Array<{ id: string; score: number; action: string }> = [];

  for (const f of functionalities) {
    const fId = String(f?.id || "");
    const fText = `${f?.action || ""} ${f?.userGoal || ""} ${f?.benefit || ""} ${(f?.validations || []).join(" ")}`.trim();

    let best = 0;
    for (const s of stories) {
      const sText = `${s?.title || ""} ${s?.want || ""} ${s?.soThat || ""} ${(s?.acceptanceCriteria || []).join(" ")}`.trim();
      const score = overlapScore(fText, sText);
      if (score > best) best = score;
    }

    if (best >= 0.18) {
      covered.push({ id: fId, score: best });
    } else {
      uncovered.push({ id: fId, score: best, action: String(f?.action || "") });
    }
  }

  return {
    totalFunctionalities: functionalities.length,
    coveredFunctionalities: covered.length,
    coverage: covered.length / functionalities.length,
    uncoveredTop: uncovered
      .sort((a, b) => a.score - b.score)
      .slice(0, 10)
  };
}

function evaluateHardConstraints(params: {
  generatedStoriesCount: number;
  targetStoryCount: number;
  validationScore: number;
  qualityScore: number;
  functionalityCoverageRatio: number;
}) {
  const violations: string[] = [];

  if (params.generatedStoriesCount < params.targetStoryCount) {
    violations.push(`stories ${params.generatedStoriesCount}/${params.targetStoryCount}`);
  }
  if (params.validationScore < MIN_VALIDATION_SCORE) {
    violations.push(`validation_score ${params.validationScore}<${MIN_VALIDATION_SCORE}`);
  }
  if (params.qualityScore < MIN_QUALITY_SCORE) {
    violations.push(`quality_score ${params.qualityScore}<${MIN_QUALITY_SCORE}`);
  }
  if (params.functionalityCoverageRatio < MIN_FUNCTIONALITY_COVERAGE) {
    violations.push(`functionality_coverage ${params.functionalityCoverageRatio.toFixed(3)}<${MIN_FUNCTIONALITY_COVERAGE}`);
  }

  return {
    mode: HARD_CONSTRAINTS_MODE,
    passed: violations.length === 0,
    violations,
    thresholds: {
      minStories: params.targetStoryCount,
      minValidationScore: MIN_VALIDATION_SCORE,
      minQualityScore: MIN_QUALITY_SCORE,
      minFunctionalityCoverage: MIN_FUNCTIONALITY_COVERAGE
    },
    values: {
      stories: params.generatedStoriesCount,
      validationScore: params.validationScore,
      qualityScore: params.qualityScore,
      functionalityCoverage: params.functionalityCoverageRatio
    }
  };
}

function getExpectedStoriesCount() {
  const expectedStories = loadExpectedStories();
  return expectedStories.length;
}

function loadExpectedStories() {
  const expectedFolder = path.resolve("context", "expected_stories");
  if (!fs.existsSync(expectedFolder)) return [];

  const excelFiles = fs.readdirSync(expectedFolder)
    .filter(f => f.toLowerCase().endsWith(".xlsx"));
  if (excelFiles.length === 0) return [];

  try {
    return loadGoldenStoriesFromExcel(expectedFolder);
  } catch {
    return [];
  }
}
