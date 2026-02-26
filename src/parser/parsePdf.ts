import fs from "node:fs";

// Forzamos el legacy build de Node
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

const originalWarn = console.warn;
console.warn = (...args: any[]) => {
  const msg = String(args[0] ?? "");
  if (msg.includes("Cannot polyfill `DOMMatrix`") || msg.includes("Cannot polyfill `Path2D`")) return;
  originalWarn(...args);
};

export async function parsePdf(filePath: string): Promise<string> {
  const data = new Uint8Array(fs.readFileSync(filePath));

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it: any) => it.str);
    text += strings.join(" ") + "\n";
  }

  return text;
}