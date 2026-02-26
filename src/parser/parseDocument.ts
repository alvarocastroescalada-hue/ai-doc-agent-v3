import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { v4 as uuidv4 } from "uuid";
import { parsePdf } from "./parsePdf";

export type ParsedDocument = {
  documentId: string;
  versionId: string;
  filename: string;
  ext: string;
  rawText: string;
};

export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();

  let rawText = "";

  if (ext === ".pdf") {
    rawText = await parsePdf(filePath);
  } else if (ext === ".docx") {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    rawText = result.value || "";
  } else if (ext === ".md" || ext === ".txt") {
    rawText = fs.readFileSync(filePath, "utf-8");
  } else {
    throw new Error(`Formato no soportado: ${ext}. Usa PDF/DOCX/MD/TXT`);
  }

  rawText = normalizeText(rawText);

  return {
    documentId: `doc_${uuidv4()}`,
    versionId: `v_${new Date().toISOString()}`,
    filename,
    ext,
    rawText
  };
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}