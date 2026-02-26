import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

export function loadGoldenStoriesFromExcel(folderPath: string) {

  const files = fs.readdirSync(folderPath)
    .filter(f => f.endsWith(".xlsx"));

  const stories: any[] = [];

  for (const file of files) {

    const workbook = XLSX.readFile(path.join(folderPath, file));
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

    for (const row of rows) {
      const description = pickField(row, [
        "Descripción HU",
        "Descripcion HU",
        "Descripción",
        "Descripcion"
      ]);

      stories.push({
        epic: pickField(row, ["Épica", "Epica", "Epic"]) || "",
        storyId: pickField(row, ["HU Id", "HU ID", "Id", "ID"]) || "",
        title: pickField(row, ["Título HU", "Titulo HU", "Título", "Titulo"]) || "",
        role: extractRole(description),
        want: extractWant(description),
        soThat: extractSoThat(description),
        notesHu: pickField(row, ["Notas HU", "Notas", "Notes"]) || "",
        acceptanceCriteria: splitAC(pickField(row, ["Criterios Aceptación", "Criterios Aceptacion", "Acceptance Criteria"]))
      });

    }
  }

  return stories;
}

function extractRole(text: string) {
  const normalized = String(text || "").replace(/\r?\n/g, " ").trim();
  const matchInline = normalized.match(/\bcomo\s+(.+?)\s+\bquiero\b/i);
  if (matchInline?.[1]) return matchInline[1].trim();

  const matchLine = String(text || "").match(/Como (.*?)\n/i);
  return matchLine?.[1]?.trim() || "";
}

function extractWant(text: string) {
  const normalized = String(text || "").replace(/\r?\n/g, " ").trim();
  const matchInline = normalized.match(/\bquiero\s+(.+?)\s+\bpara\b/i);
  if (matchInline?.[1]) return matchInline[1].trim();

  const matchLine = String(text || "").match(/Quiero (.*?)\n/i);
  return matchLine?.[1]?.trim() || "";
}

function extractSoThat(text: string) {
  const normalized = String(text || "").replace(/\r?\n/g, " ").trim();
  const matchInline = normalized.match(/\bpara\s+(.+)$/i);
  if (matchInline?.[1]) return matchInline[1].trim();

  const matchLine = String(text || "").match(/Para (.*)/i);
  return matchLine?.[1]?.trim() || "";
}

function splitAC(text: string) {
  if (!text) return [];
  return text
    .split(/\r?\n\r?\n|\r?\n/)
    .map((l: string) => l.replace(/^- /, "").trim())
    .filter(Boolean);
}

function pickField(row: Record<string, any>, aliases: string[]) {
  for (const key of aliases) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return "";
}
