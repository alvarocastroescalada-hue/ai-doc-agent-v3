import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { runAgent } from "../engine/runAgent";
import { applyFeedbackAndRetrain, loadFeedbackHistory } from "../feedback/runFeedbackLoop";
import { loadRuns, upsertRun } from "../runs/runRegistry";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// API Key simple (opcional)
const API_KEY = process.env.API_KEY || "";
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const key = req.header("x-api-key");
  if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
});

const uploadDir = path.resolve("uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

function toUrlPath(p: string) {
  return path.relative(process.cwd(), p).split(path.sep).join("/");
}

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// POST /analyze (multipart)
app.post("/analyze", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Missing file" });

  const runId = `run_${uuidv4()}`;
  const start = new Date().toISOString();

  upsertRun(runId, () => ({
    runId,
    status: "running",
    startedAt: start,
    finishedAt: null,
    originalName: file.originalname,
    storedPath: file.path,
    outputs: {}
  }));

  try {
    console.log("Running agent...");
    const result = await runAgent(file.path, { useGolden: true });

    const outputs = {
      backlogJson: toUrlPath(result.outputs.backlogJson),
      validationJson: toUrlPath(result.outputs.validationJson),
      requirementsJson: toUrlPath(result.outputs.requirementsJson),
      retrievalJson: toUrlPath(result.outputs.retrievalJson),
      evalJson: toUrlPath(result.outputs.evalJson),
      excel: toUrlPath(result.outputs.excel)
    };

    const doneAt = new Date().toISOString();
    upsertRun(runId, current => ({
      ...(current || {
        runId,
        status: "running",
        startedAt: start,
        finishedAt: null,
        originalName: file.originalname,
        storedPath: file.path,
        outputs: {}
      }),
      status: "completed",
      finishedAt: doneAt,
      outputs
    }));

    return res.json({ runId, status: "completed", outputs });
  } catch (e: any) {
    console.error("Agent failed:", e);
    const doneAt = new Date().toISOString();
    upsertRun(runId, current => ({
      ...(current || {
        runId,
        status: "running",
        startedAt: start,
        finishedAt: null,
        originalName: file.originalname,
        storedPath: file.path,
        outputs: {}
      }),
      status: "failed",
      finishedAt: doneAt,
      error: e?.message ?? String(e)
    }));

    return res.status(500).json({ runId, status: "failed", error: e?.message ?? String(e) });
  }
});

// GET /runs/:runId
app.get("/runs/:runId", (req, res) => {
  const { runId } = req.params;
  const runs = loadRuns();
  const run = runs.find(r => r.runId === runId);
  if (!run) return res.status(404).json({ error: "Not found" });
  res.json(run);
});

// POST /runs/:runId/feedback
app.post("/runs/:runId/feedback", (req, res) => {
  const { runId } = req.params;
  const body = req.body || {};
  const correctedStories = body.correctedStories;

  if (!Array.isArray(correctedStories) || correctedStories.length === 0) {
    return res.status(400).json({
      error: "correctedStories must be a non-empty array."
    });
  }

  try {
    const result = applyFeedbackAndRetrain({
      runId,
      correctedStories,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      author: typeof body.author === "string" ? body.author : undefined,
      accepted: typeof body.accepted === "boolean" ? body.accepted : true
    });

    return res.json({
      status: "ok",
      ...result
    });
  } catch (e: any) {
    return res.status(400).json({
      status: "error",
      error: e?.message ?? String(e)
    });
  }
});

// GET /runs/:runId/feedback
app.get("/runs/:runId/feedback", (req, res) => {
  const { runId } = req.params;
  const runs = loadRuns();
  const run = runs.find(r => r.runId === runId);
  if (!run) return res.status(404).json({ error: "Not found" });

  const history = loadFeedbackHistory().filter((f: any) => f?.runId === runId);
  return res.json({
    runId,
    feedback: run.feedback || null,
    history
  });
});

// Servir outputs estaticos (para descargar)
app.use("/outputs", express.static(path.resolve("outputs")));

export function startServer(port: number) {
  app.listen(port, () => {
    console.log(`[API] listening on http://localhost:${port}`);
  });
}
