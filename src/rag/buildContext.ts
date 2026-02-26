import type { RetrievedChunk } from "./multiRetrieve";
import type { MemoryHit } from "../memory/memoryIndex";

export function buildRagContext(params: {
  merged: RetrievedChunk[];
  perCategory: Record<string, RetrievedChunk[]>;
  memoryHits?: MemoryHit[];
}) {
  const blocks: string[] = [];

  if (params.memoryHits && params.memoryHits.length > 0) {
    const body = params.memoryHits
      .map(
        (m, i) =>
          `[memory.${i + 1}] id=${m.id} score=${m.score.toFixed(3)} title=${m.title}\n${m.content}\nTags: ${m.tags}`
      )
      .join("\n\n---\n\n");

    blocks.push(`### MEMORY\n\n${body}`);
  }

  for (const [cat, chunks] of Object.entries(params.perCategory)) {
    const body = chunks
      .map(
        (c, i) =>
          `[${cat}.${i + 1}] chunkId=${c.chunkId} score=${c.score.toFixed(3)}\n${c.content}`
      )
      .join("\n\n---\n\n");

    blocks.push(`### CATEGORY: ${cat}\n\n${body}`);
  }

  // merged al final como "vista global"
  const mergedBody = params.merged
    .slice(0, 30)
    .map(
      (c, i) =>
        `[merged.${i + 1}] chunkId=${c.chunkId} score=${c.score.toFixed(3)}\n${c.content}`
    )
    .join("\n\n---\n\n");

  blocks.push(`### CATEGORY: merged_top\n\n${mergedBody}`);

  return `EVIDENCIAS (chunks):\n\n${blocks.join("\n\n====================\n\n")}`;
}
