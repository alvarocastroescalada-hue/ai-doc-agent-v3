import { v4 as uuidv4 } from "uuid";

export type Chunk = {
  chunkId: string;
  content: string;
  index: number;
  charStart: number;
  charEnd: number;
  hash: string;
};

export function chunkTextAdaptive(
  text: string,
  chunkSize: number,
  overlap: number
): Chunk[] {
  let chunks = chunkText(text, chunkSize, overlap);

  // Si por lo que sea sale 1 chunk y el texto es largo, reducimos automaticamente
  if (chunks.length === 1 && text.length > 2000) {
    const smaller = Math.max(300, Math.floor(chunkSize / 2));
    const smallerOverlap = Math.max(60, Math.floor(overlap / 2));
    chunks = chunkText(text, smaller, smallerOverlap);
  }

  return chunks;
}

function chunkText(text: string, chunkSize: number, overlap: number): Chunk[] {
  if (chunkSize <= overlap) throw new Error("chunkSize debe ser > overlap");

  const tokens = naiveTokenize(text);
  const chunks: Chunk[] = [];

  let start = 0;
  let i = 0;

  // mapeo aproximado char offsets (MVP)
  let cursorChar = 0;

  while (start < tokens.length) {
    const end = Math.min(start + chunkSize, tokens.length);
    const sliceTokens = tokens.slice(start, end);
    const slice = sliceTokens.join(" ").trim();

    if (slice.length > 0) {
      const charStart = Math.max(0, cursorChar);
      const charEnd = charStart + slice.length;

      chunks.push({
        chunkId: `c_${uuidv4()}`,
        content: slice,
        index: i++,
        charStart,
        charEnd,
        hash: simpleHash(slice)
      });

      cursorChar = charEnd - overlap; // aproximacion
    }

    start = end - overlap;
    if (start < 0) start = 0;
    if (end === tokens.length) break;
  }

  return chunks;
}

function naiveTokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// Hash simple (MVP). Si quieres: crypto sha256.
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `h_${h.toString(16)}`;
}
