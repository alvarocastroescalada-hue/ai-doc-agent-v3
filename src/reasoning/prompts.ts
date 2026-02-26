// src/reasoning/prompts.ts

export function systemPolicyPrompt_old() {
  return `
Eres un agente de análisis funcional y redacción de historias de usuario para entorno corporativo.
REGLAS:
- Salida SIEMPRE en JSON válido, sin markdown, sin texto extra.
- Si faltan datos, genera openQuestions específicas.
- No inventes sistemas, endpoints o reglas no soportadas por evidencias.
- Toda historia debe incluir trazabilidad (sourceChunkIds) a evidencias.
- Historias atomizadas: UNA acción principal por historia.
- Evita verbos vagos: "gestionar", "permitir", "soportar", "manejar" si no se concretan.
`;
}

export function systemPolicyPrompt() {
  return `
Devuelve exclusivamente JSON válido.
No escribas texto adicional.
No expliques.
No uses markdown.
`;
}

/**
 * PASO 1: descomposición funcional real (no historias).
 * Forzamos actores, acciones atómicas, validaciones y evidencias.
 */
export function analysisPrompt(contextWithMemoryAndRag: string) {
  return `
ROLE
Actúas como Analista Funcional Senior (Enterprise) especialista en descomposición de requisitos ambiguos.

OBJETIVO
Extraer un "catálogo" de funcionalidades atómicas + validaciones + puntos de diseño relevantes, con trazabilidad.

REGLAS CRÍTICAS
- NO generes historias.
- Lista acciones atómicas: una sola acción observable por ítem.
- Identifica ACTOR concreto: usuario final, admin, técnico, sistema A, sistema B...
- Para cada funcionalidad, añade:
  - validations[] (reglas verificables)
  - notes[] (decisiones, edge cases, dependencias, observabilidad, seguridad)
- Siempre añade sourceChunkIds[] (ids de los chunks de evidencia).
- Si algo es ambiguo o falta info: openQuestions[].

SALIDA JSON ESTRICTA:
{
  "actors": [
    { "id":"", "name":"", "description":"" }
  ],
  "functionalities": [
    {
      "id": "F-001",
      "actorId": "",
      "userGoal": "",
      "action": "",
      "benefit": "",
      "category": "ui|workflow|integration|security|data|observability|nfr",
      "validations": ["..."],
      "notes": ["..."],
      "sourceChunkIds": ["..."]
    }
  ],
  "glossary": [
    { "term":"", "meaning":"", "sourceChunkIds":["..."] }
  ],
  "openQuestions": ["..."]
}

CONTEXTO (memoria + evidencias):
${contextWithMemoryAndRag}
`;
}

/**
 * PASO 2: generar historias desde funcionalidades (1 a 1).
 * Forzamos NOTAS HU con secciones y AC mínimos.
 */
export function extractionPrompt(
  requirementsJson: string,
  goldenExamples?: string,
  actorGuide?: string,
  extractionTargets?: string,
  humanFeedbackGuide?: string
) {
  const goldenBlock = goldenExamples?.trim()
    ? `
GUÍA DE PATRONES GOLDEN (solo como guía de calidad y estructura; no copiar literal ni inventar requisitos):
${goldenExamples}
`
    : "";
  const actorBlock = actorGuide?.trim()
    ? `
CATÁLOGO DE ACTORES DEL INPUT (usar estos perfiles como fuente de verdad para "role"):
${actorGuide}
`
    : "";
  const targetsBlock = extractionTargets?.trim()
    ? `
OBJETIVOS DE COBERTURA/CALIDAD PARA ESTA EJECUCIÓN:
${extractionTargets}
`
    : "";
  const humanFeedbackBlock = humanFeedbackGuide?.trim()
    ? `
FEEDBACK HUMANO ACUMULADO (prioridad alta como criterio de calidad):
${humanFeedbackGuide}
`
    : "";

  return `
Actúa como Product Owner Senior experto en negocio B2B.

Genera historias de usuario de alta calidad.

Formato obligatorio:

{
  "userStories": [
    {
      "storyId": "",
      "epic": "",
      "title": "",
      "role": "",
      "want": "",
      "soThat": "",
      "notesHu": [
        { "section": "", "bullets": [] }
      ],
      "acceptanceCriteria": [],
      "traceability": [],
      "assumptions": [],
      "openQuestions": []
    }
  ]
}

Reglas:
- Actor específico.
- Want concreto.
- Valor de negocio real.
- Mínimo 5 criterios de aceptación en DADO/CUANDO/ENTONCES.
- Incluir edge cases y errores.
- Notas HU con al menos 2 secciones y bullets no vacíos.
- No texto fuera del JSON.
- Mantén coherencia de estilo con los patrones golden (tono, nivel de detalle, granularidad, estructura).
- El campo role debe corresponder a un actor/perfil del catálogo del input.
- Si hay ambigüedad de actor, elige el actor más probable y registra la duda en openQuestions.
- Cubre todas las funcionalidades del análisis: evita perder flujos críticos.
- Prioriza granularidad atómica: una acción principal por historia.

REQUISITOS:
${requirementsJson}

${goldenBlock}
${actorBlock}
${targetsBlock}
${humanFeedbackBlock}
`;
}

export function extractionRefinementPrompt(
  requirementsJson: string,
  currentStoriesJson: string,
  minStories: number,
  currentCount: number,
  attempt: number,
  goldenExamples?: string,
  actorGuide?: string,
  extractionTargets?: string,
  humanFeedbackGuide?: string
) {
  const goldenBlock = goldenExamples?.trim()
    ? `
GUÍA DE PATRONES GOLDEN (solo como guía de calidad y estructura; no copiar literal ni inventar requisitos):
${goldenExamples}
`
    : "";
  const actorBlock = actorGuide?.trim()
    ? `
CATÁLOGO DE ACTORES DEL INPUT (usar estos perfiles como fuente de verdad para "role"):
${actorGuide}
`
    : "";
  const targetsBlock = extractionTargets?.trim()
    ? `
OBJETIVOS DE COBERTURA/CALIDAD PARA ESTA EJECUCIÓN:
${extractionTargets}
`
    : "";
  const humanFeedbackBlock = humanFeedbackGuide?.trim()
    ? `
FEEDBACK HUMANO ACUMULADO (prioridad alta como criterio de calidad):
${humanFeedbackGuide}
`
    : "";

  return `
Actúa como Product Owner Senior.

Tu tarea es REFINAR y COMPLETAR el backlog para cubrir funcionalidades faltantes.

REGLAS:
- Devuelve JSON estricto con formato:
{
  "userStories": [ ... ]
}
- Intento de refinamiento: ${attempt}.
- Historias actuales: ${currentCount}. Objetivo mínimo: ${minStories}.
- Debe haber al menos ${minStories} historias.
- Si faltan historias, crea historias NUEVAS para funcionalidades no cubiertas.
- Usa como base las historias actuales, pero divide historias demasiado amplias.
- Evita duplicados semánticos.
- Cada historia con actor específico, 1 acción principal y mínimo 5 AC DADO/CUANDO/ENTONCES.
- role debe corresponder al catálogo de actores del input.
- No inventes requisitos fuera del análisis funcional.

REQUISITOS:
${requirementsJson}

HISTORIAS ACTUALES:
${currentStoriesJson}

${goldenBlock}
${actorBlock}
${targetsBlock}
${humanFeedbackBlock}
`;
}

export function gapCoveragePrompt(
  requirementsJson: string,
  currentStoriesJson: string,
  uncoveredFunctionalitiesJson: string,
  minStories: number,
  actorGuide?: string,
  goldenExamples?: string,
  humanFeedbackGuide?: string
) {
  const actorBlock = actorGuide?.trim()
    ? `
CATÁLOGO DE ACTORES DEL INPUT:
${actorGuide}
`
    : "";
  const goldenBlock = goldenExamples?.trim()
    ? `
PATRONES GOLDEN DE FORMA:
${goldenExamples}
`
    : "";
  const humanFeedbackBlock = humanFeedbackGuide?.trim()
    ? `
FEEDBACK HUMANO ACUMULADO (prioridad alta):
${humanFeedbackGuide}
`
    : "";

  return `
Actúa como Product Owner Senior.

Objetivo: cerrar gaps de cobertura funcional sin duplicar historias existentes.

Salida JSON estricta:
{
  "additionalUserStories": [
    {
      "storyId": "",
      "epic": "",
      "title": "",
      "role": "",
      "want": "",
      "soThat": "",
      "notesHu": [{ "section": "", "bullets": [] }],
      "acceptanceCriteria": [],
      "traceability": [],
      "assumptions": [],
      "openQuestions": []
    }
  ]
}

Reglas:
- Crea historias SOLO para funcionalidades no cubiertas.
- No reescribas historias ya presentes.
- No inventes requisitos fuera del análisis.
- Role debe venir del catálogo de actores.
- Mínimo 5 AC DADO/CUANDO/ENTONCES por historia nueva.
- Tras añadir historias, el backlog debe acercarse a ${minStories} historias.

REQUISITOS:
${requirementsJson}

HISTORIAS ACTUALES:
${currentStoriesJson}

FUNCIONALIDADES NO CUBIERTAS:
${uncoveredFunctionalitiesJson}

${actorBlock}
${goldenBlock}
${humanFeedbackBlock}
`;
}
export function extractionPrompt_old(requirementsJson: string) {

  return `
Actúa como Product Owner Senior con más de 15 años en productos B2B empresariales.

Tu objetivo es convertir requisitos en historias de usuario de ALTA CALIDAD, listas para desarrollo.

REGLAS OBLIGATORIAS:

1. Cada historia debe ser atómica.
2. El actor debe ser específico (no usar "usuario").
3. El WANT debe describir una acción concreta y observable.
4. El SO THAT debe reflejar valor de negocio real.
5. Mínimo 5 criterios de aceptación por historia:
   - 1 happy path
   - 1 error funcional
   - 1 error técnico o integración
   - 1 edge case
   - 1 criterio de validación de datos o reglas
6. Las Notas HU deben incluir:
   - Reglas de negocio
   - Validaciones obligatorias
   - Dependencias
   - Riesgos o consideraciones
7. No agrupar funcionalidades distintas.
8. No repetir criterios entre historias.

FORMATO DE SALIDA JSON EXACTO:

{
  "userStories": [
    {
      "storyId": "",
      "epic": "",
      "title": "",
      "role": "",
      "want": "",
      "soThat": "",
      "notesHu": [
        {
          "section": "",
          "bullets": []
        }
      ],
      "acceptanceCriteria": [],
      "traceability": [],
      "assumptions": [],
      "openQuestions": []
    }
  ]
}

REQUISITOS ANALIZADOS:
${requirementsJson}
`;
}

/**
 * PASO 3: validación estricta de calidad.
 * Devuelve issues accionables y score.
 */
export function validationPrompt(backlogJson: string) {
  return `
ROLE
Eres QA Lead + Agile Coach. Validas historias para desarrollo enterprise.

OBJETIVO
Detectar problemas y devolver issues accionables.

CHECKLIST OBLIGATORIA
- Actor específico (no "usuario" genérico) y coherente con la acción.
- 1 acción principal (no "y", no múltiple responsabilidad).
- Notas HU: al menos 3 secciones con bullets no vacíos (si aplican).
- AC: mínimo 5, formato DADO/CUANDO/ENTONCES.
- AC verificables (sin "correctamente", "adecuadamente" sin métrica).
- Trazabilidad: al menos 1 chunkId por historia.
- Si hay integraciones => incluir errores/reintentos/timeouts en notas o AC.
- Si hay logs => incluir transactionId/correlación en notas o AC.

REGLAS DE FORMATO OBLIGATORIAS
- type SOLO puede ser uno de:
  duplicate | ambiguity | unsupported | contradiction | non_testable | missing_flow | too_large | bad_format | bad_actor | missing_notes | weak_ac
- message es obligatorio y debe ser string.
- suggestedFix debe ser string si existe.
- No usar campos 'problem', 'category' ni 'fix'.

SALIDA JSON:
{
  "score": 0,
  "findings":[
    {
      "type":"ambiguity",
      "severity":"medium",
      "targetId":"HU-001",
      "message":"La historia contiene múltiples acciones en el want.",
      "suggestedFix":"Dividir la historia en dos historias independientes.",
      "evidenceChunkIds":[]
    }
  ],
  "summary":""
}

BACKLOG JSON:
${backlogJson}
`;
}

/**
 * PASO 4: mejora automática aplicando los fixes.
 */
export function improvementPrompt(backlogJson: string, validationJson: string) {
  return `
ROLE
Eres Product Owner Senior. Aplicas correcciones y mejoras de calidad.

OBJETIVO
Devolver patchedBacklog con historias corregidas:
- Actor más específico
- Notas HU completas por secciones
- AC >= 5 en DADO/CUANDO/ENTONCES
- Historias atomizadas (split si hay múltiples acciones)

REGLAS
- No cambies storyId.
- Mantén trazabilidad y, si divides historias, crea NUEVOS storyId derivados: HU-001a, HU-001b.
- No inventes requisitos; si falta info, añade openQuestions.

REGLAS CRÍTICAS DE MEJORA (NO NEGOCIABLES)
- Cada historia debe mantener >= 3 criterios de aceptación.
- Si no puedes mejorar una historia, devuélvela sin cambios.
- No elimines secciones de notesHu; amplíalas si procede.

SALIDA JSON:
{
  "patchedBacklog": { ... }
}

BACKLOG:
${backlogJson}

VALIDATION:
${validationJson}
`;
}
