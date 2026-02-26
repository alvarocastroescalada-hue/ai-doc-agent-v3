import fs from "node:fs";
import path from "node:path";
import { loadGoldenStoriesFromExcel } from "../golden/loadGoldenFromExcel";

export type HumanFeedbackPack = {
  stories: any[];
  guideText: string;
};

const FEEDBACK_DIR = path.resolve("context", "human_feedback");

export function loadHumanFeedback(): HumanFeedbackPack {
  if (!fs.existsSync(FEEDBACK_DIR)) {
    return { stories: [], guideText: "" };
  }

  const files = fs.readdirSync(FEEDBACK_DIR);
  const hasExcel = files.some(f => f.toLowerCase().endsWith(".xlsx"));
  const stories = hasExcel ? loadGoldenStoriesFromExcel(FEEDBACK_DIR) : [];

  const guideParts: string[] = [];
  for (const file of files) {
    const lower = file.toLowerCase();
    if (!lower.endsWith(".txt") && !lower.endsWith(".md")) continue;
    const full = path.join(FEEDBACK_DIR, file);
    const content = fs.readFileSync(full, "utf-8").trim();
    if (!content) continue;
    guideParts.push(`### ${file}\n${content}`);
  }

  if (stories.length > 0) {
    const roleCounts = new Map<string, number>();
    for (const s of stories) {
      const role = String(s?.role || "").trim();
      if (!role) continue;
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
    }
    const topRoles = Array.from(roleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([r, c]) => `${r} (${c})`)
      .join(", ");

    guideParts.push(
      [
        "### feedback_dataset_stats",
        `- historias_feedback: ${stories.length}`,
        `- roles_frecuentes: ${topRoles || "n/a"}`
      ].join("\n")
    );
  }

  return {
    stories,
    guideText: guideParts.join("\n\n").trim()
  };
}
