import fs from "node:fs";
import path from "node:path";
import { updateLearningFromRun } from "../learning/qualityLearning";
import { findRun, upsertRun } from "../runs/runRegistry";

type RawCorrectedStory = {
  storyId?: string;
  title?: string;
  role?: string;
  want?: string;
  soThat?: string;
  acceptanceCriteria?: unknown;
  notesHu?: unknown;
};

type NormalizedExpectedStory = {
  storyId?: string;
  title?: string;
  role?: string;
  want?: string;
  soThat?: string;
  acceptanceCriteria?: string[];
  notesHu?: string;
};

type FeedbackInput = {
  runId: string;
  correctedStories: RawCorrectedStory[];
  notes?: string;
  author?: string;
  accepted?: boolean;
};

type FeedbackHistoryRecord = {
  feedbackId: string;
  runId: string;
  createdAt: string;
  author?: string;
  notes?: string;
  accepted?: boolean;
  correctedStoriesCount: number;
  learningUpdate: unknown;
};

const FEEDBACK_FILE = path.resolve("data", "run_feedback.json");

export function applyFeedbackAndRetrain(input: FeedbackInput) {
  const run = findRun(input.runId);
  if (!run) {
    throw new Error(`Run not found: ${input.runId}`);
  }
  if (run.status !== "completed") {
    throw new Error(`Run ${input.runId} is not completed.`);
  }

  const backlog = readJsonFromRunOutput(run.outputs.backlogJson, "backlogJson");
  const validation = readJsonFromRunOutput(run.outputs.validationJson, "validationJson");
  const evaluation = readJsonFromRunOutputOptional(run.outputs.evalJson);

  const generatedStories = Array.isArray(backlog?.userStories) ? backlog.userStories : [];
  if (generatedStories.length === 0) {
    throw new Error(`Run ${input.runId} has no generated stories in backlog.`);
  }

  const correctedStories = normalizeCorrectedStories(input.correctedStories);
  if (correctedStories.length === 0) {
    throw new Error("Feedback must include at least one corrected story.");
  }

  const validationScore = Number(validation?.score || 0);
  const qualityScore = Number(evaluation?.qualityScore || 0);
  const functionalityCoverage = Number(evaluation?.functionalityCoverage?.coverage || 0);
  const validationFindings = Array.isArray(validation?.findings) ? validation.findings : [];
  const acceptedByHuman = input.accepted !== false;

  const learningUpdate = updateLearningFromRun({
    generatedStories,
    expectedStories: correctedStories,
    validationScore,
    qualityScore,
    functionalityCoverage,
    validationFindings,
    forceAccept: acceptedByHuman,
    options: {
      minQualityScore: Number(process.env.MIN_QUALITY_SCORE || 0.55),
      minValidationScore: Number(process.env.MIN_VALIDATION_SCORE || 75)
    }
  });

  const feedbackId = `fb_${Date.now()}`;
  const createdAt = new Date().toISOString();

  const historyRecord: FeedbackHistoryRecord = {
    feedbackId,
    runId: input.runId,
    createdAt,
    author: input.author,
    notes: input.notes,
    accepted: acceptedByHuman,
    correctedStoriesCount: correctedStories.length,
    learningUpdate
  };

  appendFeedbackHistory(historyRecord);

  upsertRun(input.runId, current => {
    if (!current) throw new Error(`Run not found while updating feedback: ${input.runId}`);
    return {
      ...current,
      feedback: {
        feedbackId,
        createdAt,
        author: input.author,
        correctedStoriesCount: correctedStories.length,
        notes: input.notes,
        accepted: acceptedByHuman,
        learningUpdated: Boolean((learningUpdate as { updated?: boolean })?.updated)
      }
    };
  });

  return {
    runId: input.runId,
    feedbackId,
    createdAt,
    correctedStoriesCount: correctedStories.length,
    accepted: acceptedByHuman,
    learningUpdate
  };
}

export function loadFeedbackHistory() {
  ensureFeedbackFile();
  try {
    const raw = fs.readFileSync(FEEDBACK_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendFeedbackHistory(record: FeedbackHistoryRecord) {
  const current = loadFeedbackHistory();
  current.push(record);
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(current, null, 2));
}

function ensureFeedbackFile() {
  const dir = path.dirname(FEEDBACK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FEEDBACK_FILE)) {
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify([], null, 2));
  }
}

function readJsonFromRunOutput(runOutputPath: string | undefined, field: string) {
  if (!runOutputPath) throw new Error(`Run output missing: ${field}`);
  const full = path.resolve(runOutputPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Run output file not found for ${field}: ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, "utf-8"));
}

function readJsonFromRunOutputOptional(runOutputPath: string | undefined) {
  if (!runOutputPath) return null;
  const full = path.resolve(runOutputPath);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch {
    return null;
  }
}

function normalizeCorrectedStories(stories: RawCorrectedStory[]) {
  const input = Array.isArray(stories) ? stories : [];
  return input.map<NormalizedExpectedStory>(story => ({
    storyId: String(story?.storyId || "").trim(),
    title: String(story?.title || "").trim(),
    role: String(story?.role || "").trim(),
    want: String(story?.want || "").trim(),
    soThat: String(story?.soThat || "").trim(),
    acceptanceCriteria: normalizeAcceptanceCriteria(story?.acceptanceCriteria),
    notesHu: normalizeNotes(story?.notesHu)
  }));
}

function normalizeAcceptanceCriteria(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => String(v || "").trim())
    .filter(Boolean);
}

function normalizeNotes(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";

  const lines: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const section = String((item as { section?: unknown }).section || "").trim();
    if (section) lines.push(`- ${section}`);

    const bulletsRaw = (item as { bullets?: unknown }).bullets;
    if (!Array.isArray(bulletsRaw)) continue;
    for (const bullet of bulletsRaw) {
      const text = String(bullet || "").trim();
      if (text) lines.push(`  - ${text}`);
    }
  }

  return lines.join("\n").trim();
}
