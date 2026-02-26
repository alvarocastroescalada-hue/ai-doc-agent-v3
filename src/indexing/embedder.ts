import { openai, MODELS } from "../reasoning/llmClient";

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await openai.embeddings.create({
    model: MODELS.embed,
    input: texts
  });

  return res.data.map(d => d.embedding as number[]);
}