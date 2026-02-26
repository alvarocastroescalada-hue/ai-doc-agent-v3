import fs from "node:fs";
import path from "node:path";

export type RunStatus = "running" | "completed" | "failed";

export type RunOutputs = {
  backlogJson?: string;
  validationJson?: string;
  requirementsJson?: string;
  retrievalJson?: string;
  evalJson?: string;
  excel?: string;
};

export type RunFeedbackSummary = {
  feedbackId: string;
  createdAt: string;
  author?: string;
  correctedStoriesCount: number;
  notes?: string;
  accepted?: boolean;
  learningUpdated?: boolean;
};

export type RunRecord = {
  runId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  originalName: string;
  storedPath: string;
  outputs: RunOutputs;
  error?: string;
  feedback?: RunFeedbackSummary;
};

const RUNS_FILE = path.resolve("data", "runs.json");

export function loadRuns(): RunRecord[] {
  ensureRunsFile();
  try {
    const raw = fs.readFileSync(RUNS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveRuns(runs: RunRecord[]) {
  ensureRunsFile();
  fs.writeFileSync(RUNS_FILE, JSON.stringify(runs, null, 2));
}

export function findRun(runId: string): RunRecord | undefined {
  return loadRuns().find(r => r.runId === runId);
}

export function upsertRun(runId: string, updater: (current: RunRecord | undefined) => RunRecord) {
  const runs = loadRuns();
  const idx = runs.findIndex(r => r.runId === runId);
  const current = idx >= 0 ? runs[idx] : undefined;
  const next = updater(current);
  if (idx >= 0) runs[idx] = next;
  else runs.push(next);
  saveRuns(runs);
  return next;
}

function ensureRunsFile() {
  const dir = path.dirname(RUNS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(RUNS_FILE)) {
    fs.writeFileSync(RUNS_FILE, JSON.stringify([], null, 2));
  }
}
