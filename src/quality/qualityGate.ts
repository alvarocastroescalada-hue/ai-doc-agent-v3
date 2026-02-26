import { Backlog } from "../models/schemas";
import { ValidationReport } from "../models/schemas";

export function applyDeterministicQualityGate(
  backlog: Backlog,
  validation: ValidationReport,
  rawTextLength: number
): ValidationReport {

  const updated = {
    ...validation,
    findings: [...validation.findings]
  };

  // ======================================================
  // 1. Numero minimo de historias
  // ======================================================

  const minStories = Math.max(
    3,
    Math.floor(rawTextLength / 1200)
  );

  if (backlog.userStories.length < minStories) {
    updated.score = Math.min(updated.score, 80);

    updated.findings.push({
      type: "missing_flow",
      severity: "medium",
      targetId: "",
      message: "Numero de historias inferior al esperado.",
      suggestedFix: "Revisar descomposicion funcional.",
      evidenceChunkIds: []
    });
  }

  // ======================================================
  // 2. Reglas por historia
  // ======================================================

  for (const s of backlog.userStories) {

    // minimo 5 AC
    if ((s.acceptanceCriteria?.length || 0) < 5) {
      updated.score = Math.min(updated.score, 75);

      updated.findings.push({
        type: "weak_ac",
        severity: "medium",
        targetId: s.storyId,
        message: "Menos de 5 criterios de aceptacion.",
        suggestedFix: "Anadir escenarios happy path, error y edge cases.",
        evidenceChunkIds: []
      });
    }

    // criterio de error
    const hasErrorAC = s.acceptanceCriteria.some(ac =>
      ac.toLowerCase().includes("error") ||
      ac.toLowerCase().includes("falla") ||
      ac.toLowerCase().includes("no ")
    );

    if (!hasErrorAC) {
      updated.score = Math.min(updated.score, 85);

      updated.findings.push({
        type: "missing_flow",
        severity: "low",
        targetId: s.storyId,
        message: "No incluye escenario negativo o de error.",
        suggestedFix: "Anadir al menos un criterio de fallo.",
        evidenceChunkIds: []
      });
    }

    // notas tecnicas
    const validNoteSections =
      (s.notesHu?.filter(n => n?.bullets?.length > 0).length || 0);

    if (validNoteSections < 2) {
      updated.score = Math.min(updated.score, 80);

      updated.findings.push({
        type: "missing_notes",
        severity: "medium",
        targetId: s.storyId,
        message: "Notas HU insuficientes.",
        suggestedFix: "Anadir reglas tecnicas y edge cases.",
        evidenceChunkIds: []
      });
    }

    // actor generico
    if (String(s.role || "").toLowerCase() === "usuario") {
      updated.score = Math.min(updated.score, 80);

      updated.findings.push({
        type: "bad_actor",
        severity: "medium",
        targetId: s.storyId,
        message: "Actor demasiado generico.",
        suggestedFix: "Especificar actor tecnico concreto.",
        evidenceChunkIds: []
      });
    }

    // verbos vagos
    const vagueVerbs = ["gestionar", "permitir", "soportar", "manejar"];

    if (vagueVerbs.some(v => s.want?.toLowerCase().includes(v))) {
      updated.score = Math.min(updated.score, 85);

      updated.findings.push({
        type: "ambiguity",
        severity: "medium",
        targetId: s.storyId,
        message: "Uso de verbo vago en want.",
        suggestedFix: "Reemplazar por accion tecnica concreta.",
        evidenceChunkIds: []
      });
    }

  }

  return updated;
}
