import * as lancedb from "@lancedb/lancedb";
import path from "node:path";
import fs from "node:fs";

const DB_DIR = path.resolve(__dirname, "../../data/lancedb");
const TABLE = "memory_items";

export type MemoryVectorRow = {
  id: string;
  title: string;
  content: string;
  tags: string;
  embedding: number[];
  updatedAt: string;
};

export type MemoryHit = {
  id: string;
  title: string;
  content: string;
  tags: string;
  score: number;
};

async function getDb() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  return lancedb.connect(DB_DIR);
}

export async function upsertMemoryVectors(
  rows: MemoryVectorRow[]
): Promise<{ added: number; skipped: number }> {

  const db = await getDb();
  const tables = await db.tableNames();

  if (!tables.includes(TABLE)) {
    await db.createTable(TABLE, rows);
    return { added: rows.length, skipped: 0 };
  }

  const table = await db.openTable(TABLE);

  const existingRows = await table.query().toArray();
  const existingIds = new Set(existingRows.map((r: any) => r.id));

  const toInsert = rows.filter(r => !existingIds.has(r.id));

  if (toInsert.length > 0) {
    await table.add(toInsert);
  }

  return {
    added: toInsert.length,
    skipped: rows.length - toInsert.length
  };
}

export async function getExistingMemoryIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const db = await getDb();
  const tables = await db.tableNames();
  if (!tables.includes(TABLE)) return new Set();

  const table = await db.openTable(TABLE);
  const results = await table
    .query()
    .select(["id"])
    .toArray();

  const existing = new Set(results.map((r: any) => String(r.id)));
  const filtered = new Set<string>();
  for (const id of ids) {
    if (existing.has(id)) filtered.add(id);
  }
  return filtered;
}

export async function queryMemorySimilar(
  embedding: number[],
  topK: number,
  options?: {
    excludeTagContains?: string[];
  }
): Promise<MemoryHit[]> {

  const db = await getDb();
  const tables = await db.tableNames();

  if (!tables.includes(TABLE)) return [];

  const table = await db.openTable(TABLE);
  const candidateLimit = Math.max(topK * 5, topK);

  const results = await table
    .search(embedding)
    .limit(candidateLimit)
    .select(["id", "title", "content", "tags", "_distance"])
    .toArray();

  const blocked = (options?.excludeTagContains || []).map(t => t.toLowerCase());

  return results
    .map((r: any) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      tags: r.tags,
      score: typeof r._distance === "number"
        ? 1 / (1 + r._distance)
        : 0.5
    }))
    .filter(hit => {
      if (blocked.length === 0) return true;
      const tags = String(hit.tags || "").toLowerCase();
      return !blocked.some(b => tags.includes(b));
    })
    .slice(0, topK);
}
