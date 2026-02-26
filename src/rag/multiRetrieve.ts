import { embedTexts } from "../indexing/embedder";
import { querySimilar } from "../indexing/vectorStore";

export type RetrievedChunk = { chunkId: string; content: string; score: number };

const QUERY_TEMPLATES: Record<string, string> = {
  functional: "Extrae funcionalidades y acciones del usuario/sistema. Incluye CRUD, pantallas, reglas operativas.",
  integration: "Extrae integraciones, APIs, eventos, webhooks, sistemas externos, contratos de interfaz.",
  security: "Extrae seguridad, permisos, roles, auditoría, logging, RGPD, cifrado, autenticación.",
  data: "Extrae entidades, campos, estados, identificadores, reglas de datos, validaciones de datos.",
  nfr: "Extrae requisitos no funcionales: rendimiento, disponibilidad, escalabilidad, observabilidad, SLAs.",
  flows: "Extrae flujos end-to-end, pasos, estados, excepciones, reintentos, casos alternativos.",
  validation: "Extrae validaciones, criterios de aceptación implícitos, errores, mensajes, condiciones."
};

export async function multiRetrieve(params: {
  topK: number;
  documentId: string;
  versionId: string;
  categories: string[];
  extraDocumentIds?: string[];
  extraVersionIds?: string[];
}): Promise<{ merged: RetrievedChunk[]; perCategory: Record<string, RetrievedChunk[]> }> {
  const perCategory: Record<string, RetrievedChunk[]> = {};
  const all: RetrievedChunk[] = [];

  for (const cat of params.categories) {
    const q = QUERY_TEMPLATES[cat] ?? `Extrae requisitos de categoría: ${cat}`;
    const [emb] = await embedTexts([q]);

    const documentIds = [params.documentId, ...(params.extraDocumentIds ?? [])];
    const versionIds = [params.versionId, ...(params.extraVersionIds ?? [])];

    const retrieved = await querySimilar(emb, params.topK, {
      documentId: documentIds,
      versionId: versionIds
    });

    perCategory[cat] = retrieved;
    all.push(...retrieved);
  }

  // merge + dedup por chunkId, quedándonos con el mejor score
  const best = new Map<string, RetrievedChunk>();
  for (const r of all) {
    const prev = best.get(r.chunkId);
    if (!prev || r.score > prev.score) best.set(r.chunkId, r);
  }

  const merged = Array.from(best.values()).sort((a, b) => b.score - a.score);

  return { merged, perCategory };
}
