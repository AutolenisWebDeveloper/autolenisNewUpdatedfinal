// lib/services/offer/feature-match.ts
//
// §8a / parity row A17b — THE REQUIRED-FEATURE MATCH, computed at submit and persisted.
//
// `offers.required_feature_matches` and `.required_feature_mismatches` shipped in the Phase 1 wave
// with no writer, so §8c's "required-versus-preferred feature distinction" existed in the schema
// and nowhere else — and §8c's tie-break ("lowest out-the-door, then BEST REQUIRED-FEATURE MATCH,
// then shortest distance, then earliest submission") had no second key to read.
//
// THE ONE RULE THAT MATTERS HERE IS THAT UNKNOWN IS NOT ABSENT.
//
// `InventoryItem.features` is `String[] @default([])`, so a listing from a feed that does not
// publish a feature list is stored as `[]` — indistinguishable from a vehicle that genuinely has
// none of the buyer's required features. Treating `[]` as "has nothing" would mark every required
// feature a mismatch for every such dealership, push them to the bottom of the ranked report, and
// lose them the tie-break — punishing them for a gap in someone else's data feed rather than for
// anything about their offer.
//
// So an empty or missing offered list yields NULL on both columns and a null score, which the
// ranking treats as neutral. Only a NON-EMPTY list establishes anything.
//
// Run: pnpm test:offer

export interface FeatureMatchResult {
  /** Required features the offered vehicle has. `null` when nothing could be established. */
  matches: string[] | null;
  /** Required features it does not. `null` when nothing could be established. */
  mismatches: string[] | null;
  /**
   * The tie-break key (§8c): higher is a better match. `null` when not established, which the
   * comparator must treat as neutral rather than as the worst possible value.
   */
  score: number | null;
}

/**
 * Feature strings arrive from dealer feeds, inventory providers and buyer forms, so "Heated Seats",
 * "heated  seats" and "Heated-Seats" are the same requirement written three ways. Normalisation is
 * deliberately blunt — case, punctuation and repeated whitespace — and stops there: stemming or
 * synonym tables would start guessing at what a buyer meant, and a wrong guess here silently
 * changes who wins a tie.
 */
export function normalizeFeature(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Does the offered vehicle have this required feature?
 *
 * ONE DIRECTION ONLY. "Panoramic Sunroof" satisfies a requirement for "sunroof" — the vehicle has
 * a sunroof and then some. The reverse is not true: a vehicle listing "sunroof" does not satisfy a
 * buyer who required a "panoramic sunroof", and matching it would tell them they are getting
 * something they are not.
 */
function satisfies(offered: readonly string[], required: string): boolean {
  const req = normalizeFeature(required);
  if (!req) return false;
  return offered.some((o) => {
    const off = normalizeFeature(o);
    return off === req || off.includes(req);
  });
}

/**
 * Compare a buyer's REQUIRED features against the features of the vehicle an offer answers.
 *
 * `offeredFeatures` comes from the bound candidate's `InventoryItem` (§8c binds every offer to the
 * candidate it answers), which is why this takes plain arrays rather than reading the database: the
 * caller already has the rows, and a pure function is the half that can be tested exhaustively.
 */
export function computeFeatureMatch(
  requiredFeatures: readonly string[] | null | undefined,
  offeredFeatures: readonly string[] | null | undefined,
): FeatureMatchResult {
  const required = (requiredFeatures ?? []).filter((f) => normalizeFeature(f).length > 0);

  // The buyer required nothing. That is ESTABLISHED, not unknown — every offer matches equally,
  // and the tie-break falls through to the next key for all of them rather than being decided by
  // which dealership happens to have the longer feature list.
  if (required.length === 0) return { matches: [], mismatches: [], score: 0 };

  const offered = (offeredFeatures ?? []).filter((f) => normalizeFeature(f).length > 0);
  if (offered.length === 0) return { matches: null, mismatches: null, score: null };

  const matches: string[] = [];
  const mismatches: string[] = [];
  for (const req of required) {
    (satisfies(offered, req) ? matches : mismatches).push(req);
  }
  return { matches, mismatches, score: matches.length - mismatches.length };
}
