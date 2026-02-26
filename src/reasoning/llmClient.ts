import OpenAI from "openai";
import "dotenv/config";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Falta OPENAI_API_KEY en .env");

export const openai = new OpenAI({ apiKey });

export const MODELS = {
  chat: process.env.OPENAI_MODEL || "gpt-4o-mini",
  embed: process.env.OPENAI_EMBED_MODEL || "text-embedding-3-large"
};