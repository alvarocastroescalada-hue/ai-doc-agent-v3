type StoryLike = {
  storyId?: string;
  title?: string;
  role?: string;
  want?: string;
  soThat?: string;
  acceptanceCriteria?: string[];
  notesHu?: Array<{ section?: string; bullets?: string[] }>;
};

type ExpectedLike = {
  storyId?: string;
  title?: string;
  role?: string;
  want?: string;
  soThat?: string;
  acceptanceCriteria?: string[];
  notesHu?: string;
};

export function evaluateBacklogAgainstExpected(
  generatedStories: StoryLike[],
  expectedStories: ExpectedLike[]
) {
  const generated = Array.isArray(generatedStories) ? generatedStories : [];
  const expected = Array.isArray(expectedStories) ? expectedStories : [];

  if (expected.length === 0) {
    return {
      status: "skipped",
      reason: "No expected stories found.",
      metrics: {}
    };
  }

  const usedGenerated = new Set<number>();
  const matches: Array<{
    expectedIndex: number;
    generatedIndex: number;
    score: number;
    roleMatch: boolean;
  }> = [];

  for (let ei = 0; ei < expected.length; ei++) {
    let bestIdx = -1;
    let bestScore = 0;
    let bestRoleMatch = false;

    for (let gi = 0; gi < generated.length; gi++) {
      if (usedGenerated.has(gi)) continue;
      const score = storySimilarity(expected[ei], generated[gi]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = gi;
        bestRoleMatch = normalize(expected[ei].role) === normalize(generated[gi].role);
      }
    }

    if (bestIdx >= 0 && bestScore >= 0.45) {
      usedGenerated.add(bestIdx);
      matches.push({
        expectedIndex: ei,
        generatedIndex: bestIdx,
        score: bestScore,
        roleMatch: bestRoleMatch
      });
    }
  }

  const matchedCount = matches.length;
  const coverage = ratio(matchedCount, expected.length);
  const precision = ratio(matchedCount, generated.length);
  const avgMatchScore = matchedCount > 0
    ? round(matches.reduce((acc, m) => acc + m.score, 0) / matchedCount)
    : 0;
  const actorConsistency = matchedCount > 0
    ? round(matches.filter(m => m.roleMatch).length / matchedCount)
    : 0;

  const acWithGwt = generated.map(s => {
    const list = Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria : [];
    if (list.length === 0) return 0;
    const ok = list.filter(isGivenWhenThen).length;
    return ok / list.length;
  });
  const acGwtRatio = acWithGwt.length > 0
    ? round(acWithGwt.reduce((a, b) => a + b, 0) / acWithGwt.length)
    : 0;

  const storiesWithEnoughAC = round(ratio(
    generated.filter(s => (s.acceptanceCriteria || []).length >= 5).length,
    generated.length
  ));

  const storiesWithNotes = round(ratio(
    generated.filter(s => countValidNotesSections(s) >= 2).length,
    generated.length
  ));

  const qualityScore = computeQualityScore({
    coverage,
    precision,
    avgMatchScore,
    actorConsistency,
    acGwtRatio,
    storiesWithEnoughAC,
    storiesWithNotes
  });

  return {
    status: "ok",
    qualityScore,
    metrics: {
      expectedCount: expected.length,
      generatedCount: generated.length,
      matchedCount,
      coverage,
      precision,
      avgMatchScore,
      actorConsistency,
      acGwtRatio,
      storiesWithEnoughAC,
      storiesWithNotes
    },
    unmatchedExpected: expected
      .map((s, idx) => ({ idx, storyId: s.storyId || "", title: s.title || "" }))
      .filter(x => !matches.some(m => m.expectedIndex === x.idx)),
    unmatchedGenerated: generated
      .map((s, idx) => ({ idx, storyId: s.storyId || "", title: s.title || "" }))
      .filter(x => !matches.some(m => m.generatedIndex === x.idx))
  };
}

function computeQualityScore(metrics: {
  coverage: number;
  precision: number;
  avgMatchScore: number;
  actorConsistency: number;
  acGwtRatio: number;
  storiesWithEnoughAC: number;
  storiesWithNotes: number;
}) {
  const score =
    metrics.coverage * 0.30 +
    metrics.precision * 0.15 +
    metrics.avgMatchScore * 0.15 +
    metrics.actorConsistency * 0.15 +
    metrics.acGwtRatio * 0.10 +
    metrics.storiesWithEnoughAC * 0.10 +
    metrics.storiesWithNotes * 0.05;

  return round(score);
}

function storySimilarity(a: ExpectedLike, b: StoryLike) {
  const roleScore = textOverlap(a.role, b.role);
  const titleScore = textOverlap(a.title, b.title);
  const wantScore = textOverlap(a.want, b.want);
  const soThatScore = textOverlap(a.soThat, b.soThat);
  return round(roleScore * 0.25 + titleScore * 0.25 + wantScore * 0.35 + soThatScore * 0.15);
}

function textOverlap(a?: string, b?: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function tokens(text?: string) {
  const parts = normalize(text).split(" ").filter(t => t.length >= 3);
  return new Set(parts);
}

function normalize(text?: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGivenWhenThen(text: string) {
  const s = normalize(text);
  return s.includes("dado") && s.includes("cuando") && s.includes("entonces");
}

function countValidNotesSections(story: StoryLike) {
  const notes = Array.isArray(story.notesHu) ? story.notesHu : [];
  return notes.filter(n =>
    String(n?.section || "").trim().length > 0 &&
    Array.isArray(n?.bullets) &&
    n!.bullets!.some(b => String(b || "").trim().length > 0)
  ).length;
}

function ratio(n: number, d: number) {
  if (!d) return 0;
  return n / d;
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
