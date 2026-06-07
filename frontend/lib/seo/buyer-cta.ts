// Phase C4 — State-aware buyer CTA helpers for the content engine.
//
// Every programmatic article funnels readers to the same place: a private
// AutoLenis auction where local dealers compete. C4's job is to make that CTA
// specific to the page the reader is on — the exact vehicle, city, and state —
// and to carry that context into the auction intake via query params so the
// experience (and attribution) is continuous.
//
// These are pure functions on purpose: they have no DOM/analytics side effects
// so they can be unit-tested and reused from both server and client components.

// The public buyer-intake landing page. The auction form lives here; the query
// params below are additive context (vehicle + locale) for prefill/attribution.
const BUYER_INTAKE_PATH = "/for-buyers";

export interface BuyerCtaContext {
  city?: string | null;
  state?: string | null; // USPS abbreviation, e.g. "TX"
  make?: string | null;
  model?: string | null;
}

/**
 * Build the deep link into the buyer auction intake, carrying whatever vehicle
 * and locale context the article has. Empty/nullish fields are omitted so the
 * URL stays clean (e.g. dealer-fee articles have no make/model).
 *
 *   buildBuyerUrl({ city: "Dallas", state: "TX", make: "Toyota", model: "RAV4" })
 *     => "/for-buyers?city=Dallas&state=TX&make=Toyota&model=RAV4"
 */
export function buildBuyerUrl(ctx: BuyerCtaContext): string {
  const params = new URLSearchParams();
  const add = (key: string, value?: string | null) => {
    const v = value?.trim();
    if (v) params.set(key, v);
  };
  add("city", ctx.city);
  add("state", ctx.state);
  add("make", ctx.make);
  add("model", ctx.model);

  const qs = params.toString();
  return qs ? `${BUYER_INTAKE_PATH}?${qs}` : BUYER_INTAKE_PATH;
}

/** "Toyota RAV4" | "Toyota" | "" — whatever vehicle context exists. */
function vehicleLabel(ctx: BuyerCtaContext): string {
  return [ctx.make, ctx.model]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(" ");
}

/** "Dallas, TX" | "Dallas" | "" — whatever locale context exists. */
export function locationLabel(ctx: BuyerCtaContext): string {
  const city = ctx.city?.trim();
  const state = ctx.state?.trim();
  if (city && state) return `${city}, ${state}`;
  return city || state || "";
}

/**
 * The primary CTA headline, as specific as the available context allows:
 *   make+model+city+state → "Get Toyota RAV4 dealers in Dallas, TX to compete"
 *   city+state only        → "Get dealers in Dallas, TX to compete"
 *   nothing                → "Get local dealers to compete"
 */
export function buildCtaHeadline(ctx: BuyerCtaContext): string {
  const vehicle = vehicleLabel(ctx);
  const location = locationLabel(ctx);

  const subject = vehicle ? `${vehicle} dealers` : "dealers";
  if (location) return `Get ${subject} in ${location} to compete`;
  return vehicle ? `Get ${subject} to compete` : "Get local dealers to compete";
}

/** Supporting line beneath the headline — factual auction mechanics only. */
export function buildCtaSubcopy(ctx: BuyerCtaContext): string {
  const location = locationLabel(ctx);
  const where = location ? ` in ${location}` : "";
  return (
    `AutoLenis runs a private 48-hour auction where local dealers${where} compete ` +
    "for your business. You compare every offer and pick the winner."
  );
}
