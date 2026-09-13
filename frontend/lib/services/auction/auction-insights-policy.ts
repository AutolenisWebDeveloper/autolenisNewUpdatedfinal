// §13-D35 — what a dealer may learn about an auction, and when.
//
// Owner ruling, 2026-09-11: "KEEP SEALED. Remove offerCount from the active dealer route, delete
// the page's unguarded median, publish position only after close. The n=2 disclosure of a single
// competitor's price is the finding; an auction that leaks one rival's number is not sealed."
//
// ONE MODULE BECAUSE THERE WERE TWO IMPLEMENTATIONS AND THEY DISAGREED. The API route
// (`app/api/dealer/auctions/[auctionId]/insights/route.ts`) withheld the segment median below a
// sample of four, with a comment explaining exactly why. The server page
// (`app/dealer/auctions/[auctionId]/insights/page.tsx`) recomputed the same median with
// `length > 0` and rendered a percentage against it — so at two offers a dealership was shown,
// to within a rounding error, the other losing dealership's exact out-the-door price. Both now
// import this.

/**
 * The anonymisation floor for a segment median.
 *
 * Below this, the median is attributable to a single competitor: at n=1 it IS that competitor's
 * price, at n=2 it is one of the two, and at n=3 it is the middle one exactly. Four is the first
 * sample size at which the published figure is not any one dealership's number.
 */
export const MIN_MEDIAN_SAMPLE = 4;

/**
 * Whether a segment median may be published for a given sample.
 *
 * A function rather than a bare comparison at each site, so "sealed" is one decision with one
 * place to read it — which is the property the two surfaces lacked.
 */
export function mayPublishSegmentMedian(sampleSize: number): boolean {
  return sampleSize >= MIN_MEDIAN_SAMPLE;
}
