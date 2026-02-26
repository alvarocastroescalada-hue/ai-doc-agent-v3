import { embedTexts } from "../indexing/embedder";
import { upsertChunks } from "../indexing/vectorStore";
import { loadGoldenStoriesFromExcel } from "./loadGoldenFromExcel";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export type GoldenStory = {
  epic: string;
  storyId: string;
  title: string;
  role: string;
  want: string;
  soThat: string;
  notesHu: string;
  acceptanceCriteria: string[];
};

type GoldenIndexCache = {
  version: number;
  sourcePath: string;
  textHash: string;
  count: number;
  updatedAt: string;
};

const GOLDEN_CACHE_FILE = path.resolve("data", "golden_index.json");

export function getGoldenStories(folderPath = "context/golden_stories"): GoldenStory[] {
  return loadGoldenStoriesFromExcel(folderPath);
}

export function getGoldenStoryTexts(folderPath = "context/golden_stories") {
  const stories = getGoldenStories(folderPath);
  const texts = stories.map(s =>
    `
EPIC: ${s.epic}
TITLE: ${s.title}
ROLE: ${s.role}
WANT: ${s.want}
SO THAT: ${s.soThat}
NOTES: ${s.notesHu}
AC: ${s.acceptanceCriteria.join(" | ")}
`
  );

  return { stories, texts };
}

function hashTexts(texts: string[]) {
  const h = crypto.createHash("sha256");
  for (const t of texts) h.update(t);
  return h.digest("hex");
}

function readCache(): GoldenIndexCache | null {
  if (!fs.existsSync(GOLDEN_CACHE_FILE)) return null;
  try {
    const raw = fs.readFileSync(GOLDEN_CACHE_FILE, "utf-8");
    return JSON.parse(raw) as GoldenIndexCache;
  } catch {
    return null;
  }
}

function writeCache(cache: GoldenIndexCache) {
  const dir = path.dirname(GOLDEN_CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GOLDEN_CACHE_FILE, JSON.stringify(cache, null, 2));
}

export async function indexGoldenExcelStories(
  folderPath = "context/golden_stories",
  precomputed?: { stories: GoldenStory[]; texts: string[] }
) {
  const data = precomputed ?? getGoldenStoryTexts(folderPath);

  if (data.texts.length === 0) {
    console.log("Golden Excel stories indexed: 0");
    return 0;
  }

  const textHash = hashTexts(data.texts);
  const cached = readCache();

  if (
    cached &&
    cached.textHash === textHash &&
    cached.count === data.texts.length &&
    cached.sourcePath === folderPath
  ) {
    console.log("Golden Excel stories indexed: cached", data.texts.length);
    return data.texts.length;
  }

  const embeddings = await embedTexts(data.texts);

  await upsertChunks(
    data.texts.map((content, idx) => ({
      chunkId: `gold_excel_${idx}`,
      content,
      embedding: embeddings[idx],
      documentId: "golden_excel",
      versionId: "v1",
      chunkHash: crypto
        .createHash("sha256")
        .update(content)
        .digest("hex"),
      chunkIndex: idx
    }))
  );

  writeCache({
    version: 1,
    sourcePath: folderPath,
    textHash,
    count: data.texts.length,
    updatedAt: new Date().toISOString()
  });

  console.log("Golden Excel stories indexed:", data.texts.length);
  return data.texts.length;
}
