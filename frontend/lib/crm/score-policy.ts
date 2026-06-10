// ---------------------------------------------------------------------------
// SCORE DISPATCH POLICY (Fixes D + E) — pure, no I/O
// ---------------------------------------------------------------------------

export type Temperature = 'hot' | 'warm' | 'cold';

export interface ScorePoint {
  score: number;
  temperature: string;
}

// (E) Never downgrade. Persist max(existing, computed); when the prior score is
// >= the freshly computed one (e.g. a thin re-score call), keep the prior score
// AND its temperature. Mirrors the deterministic-vs-Groq max() in scoring.service.
export function pickHigherScore(
  existing: ScorePoint | null,
  computed: ScorePoint,
): ScorePoint {
  if (existing && existing.score >= computed.score) {
    return { score: existing.score, temperature: existing.temperature };
  }
  return { score: computed.score, temperature: computed.temperature };
}

// (D) A re-score request is "thin" when it carries none of the scoring signals
// (phone is a tier-gate, not a signal). A thin call must not clobber a higher
// stored score — combined with pickHigherScore this guarantees no downgrade.
export function isThinScoreInput(supplied: Record<string, unknown>, signalFields: string[]): boolean {
  return signalFields.every((f) => supplied[f] === null || supplied[f] === undefined);
}
