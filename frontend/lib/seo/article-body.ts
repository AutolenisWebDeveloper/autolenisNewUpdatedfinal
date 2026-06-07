// Phase C4 — split a generated article body for mid-page CTA injection.
//
// The quality rubric requires a conversion element above the fold AND at
// mid-page. Article bodies are stored as a single HTML string, so we split them
// at the <h2> boundary nearest the visual middle and render a CTA in the seam.
// Pure + deterministic so it can be unit-tested and run on the server.

export interface SplitBody {
  before: string;
  after: string;
  /** True when a real mid-point split was made (≥2 sections). */
  didSplit: boolean;
}

// Match the start of an <h2 ...> tag, case-insensitively.
const H2_OPEN = /<h2[\s>]/gi;

/**
 * Split `html` into `before` / `after` at the <h2> boundary closest to the
 * character midpoint, so a mid-page CTA can be rendered between them.
 *
 * Falls back to no split (everything in `before`) when there aren't at least
 * two H2 sections — injecting a CTA into a one-section article would land it
 * either at the very top or bottom, where CTAs already exist.
 */
export function splitBodyForMidCta(html: string): SplitBody {
  if (!html) return { before: html, after: "", didSplit: false };

  // Collect every H2 start offset.
  const offsets: number[] = [];
  for (const match of html.matchAll(H2_OPEN)) {
    if (match.index !== undefined) offsets.push(match.index);
  }

  // Need at least two sections to have a meaningful seam with content on both
  // sides. Candidate seams are every H2 except the first (so `before` is never
  // empty); each candidate has content after it by construction.
  const candidates = offsets.filter((o) => o > 0);
  if (candidates.length === 0) {
    return { before: html, after: "", didSplit: false };
  }

  const midpoint = html.length / 2;
  let splitAt = candidates[0];
  let bestDistance = Math.abs(splitAt - midpoint);
  for (const offset of candidates) {
    const distance = Math.abs(offset - midpoint);
    if (distance < bestDistance) {
      bestDistance = distance;
      splitAt = offset;
    }
  }

  return {
    before: html.slice(0, splitAt),
    after: html.slice(splitAt),
    didSplit: true,
  };
}
