import fs from "node:fs";
import path from "node:path";

export type MemoryItem = {
  id: string;
  type: "decision" | "glossary" | "rule" | "resolved_question" | "pattern";
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

const MEMORY_FILE = path.resolve("data", "memory.json");

type MemoryFile = {
  version: number;
  items: MemoryItem[];
};

function ensureMemoryFile() {
  const dir = path.dirname(MEMORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(MEMORY_FILE)) {
    const init: MemoryFile = { version: 1, items: [] };
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(init, null, 2));
  }
}

export function loadMemory(): MemoryFile {
  ensureMemoryFile();
  const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
  return JSON.parse(raw) as MemoryFile;
}

export function saveMemory(mem: MemoryFile) {
  ensureMemoryFile();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

export function addMemoryItem(item: MemoryItem) {
  const mem = loadMemory();
  mem.items.push(item);
  saveMemory(mem);
}

export function upsertMemoryItem(item: MemoryItem) {
  const mem = loadMemory();
  const idx = mem.items.findIndex(x => x.id === item.id);
  if (idx >= 0) mem.items[idx] = item;
  else mem.items.push(item);
  saveMemory(mem);
}