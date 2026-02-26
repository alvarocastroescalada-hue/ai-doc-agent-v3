import path from "node:path";
import fs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { runAgent } from "./engine/runAgent";
import { upsertRun } from "./runs/runRegistry";
import { applyFeedbackAndRetrain } from "./feedback/runFeedbackLoop";

async function main() {
  const args = process.argv.slice(2);
  const command = resolveCommand(args);

  if (command === "feedback") {
    await runFeedback(args.slice(1));
    return;
  }

  await runAnalyze(command === "analyze" ? args.slice(1) : args);
}

async function runAnalyze(args: string[]) {
  const filePath = args.find(a => !a.startsWith("-"));
  const useGolden = !args.includes("--no-golden");

  if (!filePath) {
    console.error("Uso:");
    console.error("  npm run analyze -- <ruta_documento> [--no-golden]");
    console.error("  npm run analyze -- analyze <ruta_documento> [--no-golden]");
    console.error("  npm run analyze -- feedback <runId> --file <feedback.json>");
    process.exit(1);
  }

  const runId = `run_${uuidv4()}`;
  const startedAt = new Date().toISOString();
  const originalName = path.basename(filePath);
  const storedPath = path.resolve(filePath);

  upsertRun(runId, () => ({
    runId,
    status: "running",
    startedAt,
    finishedAt: null,
    originalName,
    storedPath,
    outputs: {}
  }));

  try {
    const result = await runAgent(filePath, { useGolden });
    const toUrlPath = (p: string) => path.relative(process.cwd(), p).split(path.sep).join("/");
    const outputs = {
      backlogJson: toUrlPath(result.outputs.backlogJson),
      validationJson: toUrlPath(result.outputs.validationJson),
      requirementsJson: toUrlPath(result.outputs.requirementsJson),
      retrievalJson: toUrlPath(result.outputs.retrievalJson),
      evalJson: toUrlPath(result.outputs.evalJson),
      excel: toUrlPath(result.outputs.excel)
    };

    upsertRun(runId, current => ({
      ...(current || {
        runId,
        status: "running",
        startedAt,
        finishedAt: null,
        originalName,
        storedPath,
        outputs: {}
      }),
      status: "completed",
      finishedAt: new Date().toISOString(),
      outputs
    }));

    console.log(JSON.stringify({ runId, status: "completed", outputs }, null, 2));
  } catch (e: any) {
    upsertRun(runId, current => ({
      ...(current || {
        runId,
        status: "running",
        startedAt,
        finishedAt: null,
        originalName,
        storedPath,
        outputs: {}
      }),
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: e?.message ?? String(e)
    }));

    console.error("ERROR DETALLADO:");
    console.error(e instanceof Error ? e.stack : e);
    console.error(`runId: ${runId}`);
    process.exit(1);
  }
}

async function runFeedback(args: string[]) {
  const runId = args[0];
  if (!runId) {
    console.error("Uso: npm run analyze -- feedback <runId> --file <feedback.json>");
    process.exit(1);
  }

  const feedbackFile = getFlagValue(args, "--file");
  if (!feedbackFile) {
    console.error("Falta --file <feedback.json>");
    process.exit(1);
  }

  if (!fs.existsSync(feedbackFile)) {
    console.error(`No existe el archivo de feedback: ${feedbackFile}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(feedbackFile, "utf-8"));
  const correctedStories = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.correctedStories)
      ? raw.correctedStories
      : [];

  const accepted = args.includes("--rejected")
    ? false
    : args.includes("--accepted")
      ? true
      : typeof raw?.accepted === "boolean"
        ? raw.accepted
        : true;

  const notes = getFlagValue(args, "--notes")
    || (typeof raw?.notes === "string" ? raw.notes : undefined);
  const author = getFlagValue(args, "--author")
    || (typeof raw?.author === "string" ? raw.author : undefined);

  const result = applyFeedbackAndRetrain({
    runId,
    correctedStories,
    notes,
    author,
    accepted
  });

  console.log(JSON.stringify({ status: "ok", ...result }, null, 2));
}

function resolveCommand(args: string[]) {
  const first = args[0];
  if (first === "analyze" || first === "feedback") return first;
  return "analyze";
}

function getFlagValue(args: string[], flag: string) {
  const idx = args.indexOf(flag);
  if (idx === -1) return "";
  return args[idx + 1] || "";
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
