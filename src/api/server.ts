import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { runAgent } from "../engine/runAgent";

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

// Run registry simple en disco
const runsFile = path.resolve("data", "runs.json");
function loadRuns(): any[] {
  const dir = path.dirname(runsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(runsFile)) fs.writeFileSync(runsFile, JSON.stringify([], null, 2));
  return JSON.parse(fs.readFileSync(runsFile, "utf-8"));
}
function saveRuns(runs: any[]) {
  fs.writeFileSync(runsFile, JSON.stringify(runs, null, 2));
}

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// POST /analyze (multipart)
app.post("/analyze", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Missing file" });

  const runId = `run_${uuidv4()}`;
  const start = new Date().toISOString();

  // Guardar run inicial
  const runs = loadRuns();
  runs.push({
    runId,
    status: "running",
    startedAt: start,
    finishedAt: null,
    originalName: file.originalname,
    storedPath: file.path,
    outputs: {}
  });
  saveRuns(runs);

  try {
    // Ejecuta pipeline (sincronamente en este MVP)
    console.log("Running agent...");
    const result = await runAgent(file.path, { useGolden: true });

    const toUrlPath = (p: string) => path.relative(process.cwd(), p).split(path.sep).join("/");
    const outputs = {
      backlogJson: toUrlPath(result.outputs.backlogJson),
      validationJson: toUrlPath(result.outputs.validationJson),
      requirementsJson: toUrlPath(result.outputs.requirementsJson),
      retrievalJson: toUrlPath(result.outputs.retrievalJson),
      evalJson: toUrlPath(result.outputs.evalJson),
      excel: toUrlPath(result.outputs.excel)
    };

    const doneAt = new Date().toISOString();
    const updated = loadRuns().map(r =>
      r.runId === runId
        ? { ...r, status: "completed", finishedAt: doneAt, outputs }
        : r
    );
    saveRuns(updated);

    return res.json({ runId, status: "completed", outputs });
  } catch (e: any) {
    console.error("Agent failed:", e);
    const doneAt = new Date().toISOString();
    const updated = loadRuns().map(r =>
      r.runId === runId
        ? { ...r, status: "failed", finishedAt: doneAt, error: e?.message ?? String(e) }
        : r
    );
    saveRuns(updated);

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

// Servir outputs estaticos (para descargar)
app.use("/outputs", express.static(path.resolve("outputs")));

export function startServer(port: number) {
  app.listen(port, () => {
    console.log(`[API] listening on http://localhost:${port}`);
  });
}
