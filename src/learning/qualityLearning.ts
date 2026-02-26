import fs from "node:fs";
import path from "node:path";

type StoryLike = {
  role?: string;
  acceptanceCriteria?: string[];
  notesHu?: Array<{ section?: string; bullets?: string[] }>;
};

type ExpectedLike = {
  role?: string;
  acceptanceCriteria?: string[];
  notesHu?: string;
};

type LearningFile = {
  version: number;
  runs: number;
  lastUpdated: string;
  stats: {
    targetStoriesAvg: number;
    targetAcAvg: number;
    validationScoreAvg: number;
    qualityScoreAvg: number;
  };
  roleCounts: Record<string, number>;
  notesSectionCounts: Record<string, number>;
};

const LEARNING_FILE = path.resolve("data", "quality_patterns.json");

export function getLearningGuidanceText() {
  const data = loadLearning();
  if (data.runs === 0) return "";

  const topRoles = Object.entries(data.roleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([role]) => role);

  const topSections = Object.entries(data.notesSectionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([section]) => section);

  return [
    `- aprendizaje_runs: ${data.runs}`,
    `- aprendizaje_target_historias_media: ${data.stats.targetStoriesAvg.toFixed(1)}`,
    `- aprendizaje_ac_media_por_hu: ${data.stats.targetAcAvg.toFixed(1)}`,
    `- aprendizaje_roles_frecuentes: ${topRoles.join(", ") || "n/a"}`,
    `- aprendizaje_secciones_notas_frecuentes: ${topSections.join(", ") || "n/a"}`,
    "- aplica estos patrones como guía de calidad, sin inventar requisitos no presentes en el documento."
  ].join("\n");
}

export function suggestTargetStories(requirementsFunctionalitiesCount: number, expectedCount: number) {
  if (expectedCount > 0) return expectedCount;

  const learned = loadLearning();
  const learnedTarget = learned.runs > 0
    ? Math.round(learned.stats.targetStoriesAvg)
    : 0;

  const base = Math.max(5, Math.min(30, requirementsFunctionalitiesCount || 5));
  if (learnedTarget <= 0) return base;
  return Math.max(base, Math.min(30, learnedTarget));
}

export function updateLearningFromRun(params: {
  generatedStories: StoryLike[];
  expectedStories?: ExpectedLike[];
  validationScore?: number;
  qualityScore?: number;
  options?: {
    minQualityScore?: number;
    minValidationScore?: number;
  };
}) {
  const generatedStories = Array.isArray(params.generatedStories) ? params.generatedStories : [];
  if (generatedStories.length === 0) {
    return {
      updated: false,
      reason: "no_generated_stories"
    };
  }

  const minQualityScore = params.options?.minQualityScore ?? 0.55;
  const minValidationScore = params.options?.minValidationScore ?? 75;
  const qualityScore = Number(params.qualityScore || 0);
  const validationScore = Number(params.validationScore || 0);

  if (qualityScore < minQualityScore) {
    return {
      updated: false,
      reason: "quality_below_threshold",
      thresholds: { minQualityScore, minValidationScore },
      values: { qualityScore, validationScore }
    };
  }

  if (validationScore < minValidationScore) {
    return {
      updated: false,
      reason: "validation_below_threshold",
      thresholds: { minQualityScore, minValidationScore },
      values: { qualityScore, validationScore }
    };
  }

  const expectedStories = Array.isArray(params.expectedStories) ? params.expectedStories : [];
  const targetStories = expectedStories.length > 0 ? expectedStories.length : generatedStories.length;
  const targetAc = expectedStories.length > 0
    ? averageAc(expectedStories.map(s => s.acceptanceCriteria || []))
    : averageAc(generatedStories.map(s => s.acceptanceCriteria || []));

  const learning = loadLearning();
  learning.runs += 1;
  learning.lastUpdated = new Date().toISOString();
  learning.stats.targetStoriesAvg = runningAverage(learning.stats.targetStoriesAvg, learning.runs, targetStories);
  learning.stats.targetAcAvg = runningAverage(learning.stats.targetAcAvg, learning.runs, targetAc);
  learning.stats.validationScoreAvg = runningAverage(
    learning.stats.validationScoreAvg,
    learning.runs,
    validationScore
  );
  learning.stats.qualityScoreAvg = runningAverage(
    learning.stats.qualityScoreAvg,
    learning.runs,
    qualityScore
  );

  const roleSource = expectedStories.length > 0 ? expectedStories : generatedStories;
  for (const s of roleSource) {
    const role = normalize(String(s.role || ""));
    if (!role) continue;
    learning.roleCounts[role] = (learning.roleCounts[role] || 0) + 1;
  }

  const sections = expectedStories.length > 0
    ? extractSectionsFromExpected(expectedStories)
    : extractSectionsFromGenerated(generatedStories);
  for (const section of sections) {
    const key = normalize(section);
    if (!key) continue;
    learning.notesSectionCounts[key] = (learning.notesSectionCounts[key] || 0) + 1;
  }

  saveLearning(learning);
  return {
    updated: true,
    reason: "ok",
    thresholds: { minQualityScore, minValidationScore },
    values: { qualityScore, validationScore }
  };
}

function extractSectionsFromExpected(stories: ExpectedLike[]) {
  const sections: string[] = [];
  for (const s of stories) {
    const text = String(s.notesHu || "");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      sections.push(trimmed.replace(/^- /, ""));
    }
  }
  return sections;
}

function extractSectionsFromGenerated(stories: StoryLike[]) {
  const sections: string[] = [];
  for (const s of stories) {
    const notes = Array.isArray(s.notesHu) ? s.notesHu : [];
    for (const n of notes) {
      const sec = String(n?.section || "").trim();
      if (sec) sections.push(sec);
    }
  }
  return sections;
}

function averageAc(acLists: string[][]) {
  if (acLists.length === 0) return 0;
  const total = acLists.reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0);
  return total / acLists.length;
}

function runningAverage(currentAvg: number, runCountAfterIncrement: number, value: number) {
  if (runCountAfterIncrement <= 1) return value;
  return ((currentAvg * (runCountAfterIncrement - 1)) + value) / runCountAfterIncrement;
}

function loadLearning(): LearningFile {
  ensureLearningFile();
  try {
    const raw = fs.readFileSync(LEARNING_FILE, "utf-8");
    return JSON.parse(raw) as LearningFile;
  } catch {
    return initialLearning();
  }
}

function saveLearning(data: LearningFile) {
  ensureLearningFile();
  fs.writeFileSync(LEARNING_FILE, JSON.stringify(data, null, 2));
}

function ensureLearningFile() {
  const dir = path.dirname(LEARNING_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LEARNING_FILE)) {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(initialLearning(), null, 2));
  }
}

function initialLearning(): LearningFile {
  return {
    version: 1,
    runs: 0,
    lastUpdated: new Date(0).toISOString(),
    stats: {
      targetStoriesAvg: 0,
      targetAcAvg: 0,
      validationScoreAvg: 0,
      qualityScoreAvg: 0
    },
    roleCounts: {},
    notesSectionCounts: {}
  };
}

function normalize(s: string) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
