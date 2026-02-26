import { z } from "zod";

/* ======================================================
   TRACEABILITY
====================================================== */

export const TraceabilitySchema = z.object({
  chunkId: z.string(),
  confidence: z.number().min(0).max(1).optional()
});

/* ======================================================
   NOTES HU (NUEVO)
====================================================== */

export const NotesSectionSchema = z.object({
  section: z.string().min(2),
  bullets: z.array(z.string().min(3)).min(1)
});

/* ======================================================
   USER STORY
====================================================== */

export const UserStorySchema = z.object({
  storyId: z.string(),
  epic: z.string().optional(),

  title: z.string().min(3),

  role: z.string().min(2),
  want: z.string().min(3),
  soThat: z.string().min(3),

  /* 🔥 NUEVO: Notas HU estructuradas */
  notesHu: z.array(NotesSectionSchema).min(1),

  /* 🔥 Aumentamos exigencia */
  acceptanceCriteria: z.array(z.string().min(10)).min(3),

  traceability: z.array(TraceabilitySchema).min(1),

  assumptions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([])
});

/* ======================================================
   BACKLOG
====================================================== */

export const BacklogSchema = z.object({
  documentId: z.string(),
  versionId: z.string(),
  generatedAt: z.string(),
  userStories: z.array(UserStorySchema).min(1)
});

export type Backlog = z.infer<typeof BacklogSchema>;

/* ======================================================
   VALIDATION
====================================================== */

export const ValidationFindingSchema = z.object({
  type: z.enum([
    "duplicate",
    "ambiguity",
    "unsupported",
    "contradiction",
    "non_testable",
    "missing_flow",
    "too_large",
    "bad_format",
    "bad_actor",
    "missing_notes",
    "weak_ac"
  ]),
  severity: z.enum(["low", "medium", "high"]),
  targetId: z.string().optional(),
  message: z.string(),
  suggestedFix: z.string().optional(),
  evidenceChunkIds: z.array(z.string()).default([])
});

export const ValidationReportSchema = z.object({
  score: z.number().min(0).max(100),
  findings: z.array(ValidationFindingSchema),
  summary: z.string()
});

export type ValidationReport = z.infer<typeof ValidationReportSchema>;