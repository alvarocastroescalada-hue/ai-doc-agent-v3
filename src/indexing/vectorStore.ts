import * as lancedb from "@lancedb/lancedb";
import path from "node:path";
import fs from "node:fs";

export type VectorRow = {
  chunkId: string;
  content: string;
  embedding: number[];
  documentId: string;
  versionId: string;
  chunkHash: string;
  chunkIndex: number;
};

const DB_DIR = path.resolve("data", "lancedb");
const TABLE_NAME = "chunks";

async function getTable() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const db = await lancedb.connect(DB_DIR);

  const tables = await db.tableNames();
  if (!tables.includes(TABLE_NAME)) {
    // Creamos tabla vacía con schema al primer insert real.
    // LanceDB necesita filas para inferir schema en createTable,
    // así que la crearemos en upsertChunks si no existe.
    return { db, table: null as any, exists: false };
  }

  const table = await db.openTable(TABLE_NAME);
  return { db, table, exists: true };
}

export async function upsertChunks(rows: VectorRow[]) {
  const { db, table, exists } = await getTable();

  if (!exists) {
    const created = await db.createTable(TABLE_NAME, rows);
    return { dbDir: DB_DIR, table: TABLE_NAME, added: rows.length, skipped: 0 };
  }

  // Dedup simple: no reinsertar misma doc+version+hash
  // (MVP: scan + filter; para grandes volúmenes, haríamos índice secundario fuera)
  const existing = await table.query().toArray();

  const seen = new Set(
    existing.map((r: any) => `${r.documentId}::${r.versionId}::${r.chunkHash}`)
  );

  const toAdd = rows.filter(
    r => !seen.has(`${r.documentId}::${r.versionId}::${r.chunkHash}`)
  );

  if (toAdd.length > 0) await table.add(toAdd);

  return { dbDir: DB_DIR, table: TABLE_NAME, added: toAdd.length, skipped: rows.length - toAdd.length };
}

export async function querySimilar(
  queryEmbedding: number[],
  topK: number,
  filters?: { documentId?: string | string[]; versionId?: string | string[] }
): Promise<Array<{ chunkId: string; content: string; score: number }>> {
  const { table } = await getTable();
  if (!table) return [];

  let search = table.search(queryEmbedding).limit(topK);

  // LanceDB filters dependen de versión; MVP: filtramos post-query si hace falta
  const results = await search
  .select(["chunkId", "content", "documentId", "versionId", "_distance"])
  .toArray();

  const filtered = results.filter((r: any) => {
    if (filters?.documentId) {
      const docIds = Array.isArray(filters.documentId)
        ? filters.documentId
        : [filters.documentId];
      if (!docIds.includes(r.documentId)) return false;
    }
    if (filters?.versionId) {
      const verIds = Array.isArray(filters.versionId)
        ? filters.versionId
        : [filters.versionId];
      if (!verIds.includes(r.versionId)) return false;
    }
    return true;
  });

  return filtered.slice(0, topK).map((r: any) => ({
    chunkId: r.chunkId,
    content: r.content,
    score: typeof r._distance === "number" ? 1 / (1 + r._distance) : 0.5
  }));
}
