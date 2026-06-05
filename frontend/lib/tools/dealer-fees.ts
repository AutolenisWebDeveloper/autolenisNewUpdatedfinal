// lib/tools/dealer-fees.ts
// AutoLenis Phase C-Tools — State-Aware Dealer Fee library.
//
// AutoLenis operates nationally: the dealer discovery system finds 5-8 local
// dealers near any US zip code. The Dealer Fee Calculator must therefore know
// dealer fee rules for all 50 states — not just Texas. A buyer in California
// entering a $200 doc fee gets a different verdict than a buyer in Florida.
//
// All monetary values in this module are in CENTS to stay consistent with the
// rest of the AutoLenis codebase (Stripe, prequal, etc.). Never store dollars.

// ─── Part A — Fee type definitions ──────────────────────────────────────────

export type FeeCategory =
  | "state_required"
  | "dealer_standard"
  | "negotiable"
  | "pure_markup";

export type UniversalVerdict =
  | "required"
  | "legitimate"
  | "negotiate"
  | "reject"
  | "varies";

export interface FeeType {
  id: string; // "doc_fee", "market_adjustment", etc.
  displayName: string; // "Documentation/Processing Fee"
  category: FeeCategory;
  universalNegotiable: boolean;
  universalVerdict: UniversalVerdict;
  description: string; // plain language explanation
  commonNames: string[]; // aliases buyers might use
}

export const FEE_TYPES: FeeType[] = [
  {
    id: "doc_fee",
    displayName: "Documentation / Processing Fee",
    category: "dealer_standard",
    universalNegotiable: true,
    universalVerdict: "varies", // depends on state cap
    description:
      "A dealer admin fee for processing paperwork. Some states cap it by law; others have no limit. Often negotiable.",
    commonNames: [
      "doc fee",
      "processing fee",
      "admin fee",
      "documentation fee",
      "conveyance fee",
    ],
  },
  {
    id: "market_adjustment",
    displayName: "Market Adjustment / ADM",
    category: "pure_markup",
    universalNegotiable: true,
    universalVerdict: "reject",
    description:
      "A made-up markup dealers add above MSRP during high demand. Completely negotiable — many dealers will remove it if you push back or shop elsewhere.",
    commonNames: [
      "market adjustment",
      "adm",
      "additional dealer markup",
      "dealer adjustment",
      "market value adjustment",
    ],
  },
  {
    id: "title_fee",
    displayName: "Title Fee",
    category: "state_required",
    universalNegotiable: false,
    universalVerdict: "required",
    description:
      "A state government fee to transfer vehicle title to your name. Set by your state — not negotiable.",
    commonNames: ["title fee", "title transfer", "title transfer fee"],
  },
  {
    id: "registration",
    displayName: "Registration / License Fee",
    category: "state_required",
    universalNegotiable: false,
    universalVerdict: "required",
    description:
      "State registration fee. Set by your state based on vehicle weight/value. Not negotiable.",
    commonNames: ["registration", "license fee", "reg fee", "plate fee"],
  },
  {
    id: "gap_insurance",
    displayName: "GAP Insurance",
    category: "negotiable",
    universalNegotiable: true,
    universalVerdict: "negotiate",
    description:
      "Covers the difference if your car is totaled and you owe more than it's worth. Useful if financing with low down payment, but overpriced at the dealer. Buy from your own insurer instead — usually 3-5x cheaper.",
    commonNames: ["gap insurance", "gap coverage", "guaranteed asset protection"],
  },
  {
    id: "nitrogen_tires",
    displayName: "Nitrogen Tire Inflation",
    category: "pure_markup",
    universalNegotiable: true,
    universalVerdict: "reject",
    description:
      "Regular air is 78% nitrogen. Paying $200-$400 for nitrogen tire inflation is pure profit for the dealer with zero meaningful benefit.",
    commonNames: ["nitrogen tires", "nitrogen fill", "nitrogen package"],
  },
  {
    id: "paint_protection",
    displayName: "Paint / Fabric Protection",
    category: "pure_markup",
    universalNegotiable: true,
    universalVerdict: "reject",
    description:
      "Dealer-applied coating sold at extreme markup. The same products are available at any auto parts store for under $50. Reject this.",
    commonNames: [
      "paint protection",
      "paint sealant",
      "fabric protection",
      "scotchgard",
      "ceramic coating",
      "clear coat protection",
    ],
  },
  {
    id: "vin_etching",
    displayName: "VIN Etching",
    category: "pure_markup",
    universalNegotiable: true,
    universalVerdict: "reject",
    description:
      "Etching your VIN into windows for theft deterrence. Worth about $20 at a DIY store. Dealers charge $200-$400. Reject it.",
    commonNames: ["vin etching", "window etching", "security etching"],
  },
  {
    id: "extended_warranty",
    displayName: "Extended Warranty / Service Contract",
    category: "negotiable",
    universalNegotiable: true,
    universalVerdict: "negotiate",
    description:
      "Can be valuable for certain vehicles. But dealer pricing is heavily marked up and it's negotiable. Get a quote from a third-party warranty provider first. Also — you can buy this AFTER purchase, usually cheaper.",
    commonNames: [
      "extended warranty",
      "service contract",
      "vehicle service contract",
      "extended service plan",
    ],
  },
  {
    id: "dealer_addons",
    displayName: "Dealer Installed Options / Add-Ons",
    category: "pure_markup",
    universalNegotiable: true,
    universalVerdict: "reject",
    description:
      "Tinted windows, floor mats, door guards added by the dealer. Usually 3-5x what you'd pay elsewhere. Ask to have them removed or get a full itemized list before agreeing.",
    commonNames: [
      "dealer options",
      "installed accessories",
      "dealer accessories",
      "dealer prep",
      "door guards",
      "tint",
    ],
  },
];

// ─── Part B — State-specific doc fee data ─────────────────────────────────────

export interface StateFeeRules {
  state: string; // "CA", "TX", "FL", etc.
  stateName: string; // "California", "Texas", "Florida"
  docFeeCap: number | null; // cents; null = no legal cap
  docFeeTypicalRange: [number, number]; // [low, high] cents
  docFeeNotes: string; // plain language
  highFeeWarningThreshold: number; // cents — above this = negotiate hard
}

export const STATE_FEE_RULES: Record<string, StateFeeRules> = {
  TX: {
    state: "TX",
    stateName: "Texas",
    docFeeCap: 15000, // $150 legal cap
    docFeeTypicalRange: [5000, 15000],
    docFeeNotes:
      "Texas law caps doc fees at $150. Any amount above this is illegal.",
    highFeeWarningThreshold: 15000,
  },
  CA: {
    state: "CA",
    stateName: "California",
    docFeeCap: 8500, // $85 legal cap
    docFeeTypicalRange: [6500, 8500],
    docFeeNotes: "California caps doc fees at $85. Above this is illegal.",
    highFeeWarningThreshold: 8500,
  },
  FL: {
    state: "FL",
    stateName: "Florida",
    docFeeCap: null, // no cap
    docFeeTypicalRange: [30000, 99900], // $300-$999
    docFeeNotes:
      "Florida has no doc fee cap. Dealers charge $300-$999+. Always negotiate.",
    highFeeWarningThreshold: 70000, // $700
  },
  NY: {
    state: "NY",
    stateName: "New York",
    docFeeCap: null,
    docFeeTypicalRange: [7500, 17500],
    docFeeNotes:
      "New York has no legal doc fee cap. Typical range is $75-$175.",
    highFeeWarningThreshold: 20000,
  },
  IL: {
    state: "IL",
    stateName: "Illinois",
    docFeeCap: null,
    docFeeTypicalRange: [10000, 30000],
    docFeeNotes:
      "Illinois has no doc fee cap. Dealers typically charge $100-$300.",
    highFeeWarningThreshold: 30000,
  },
  GA: {
    state: "GA",
    stateName: "Georgia",
    docFeeCap: null,
    docFeeTypicalRange: [40000, 69900],
    docFeeNotes: "Georgia has no doc fee cap. Typical range is $400-$699.",
    highFeeWarningThreshold: 70000,
  },
  AZ: {
    state: "AZ",
    stateName: "Arizona",
    docFeeCap: null,
    docFeeTypicalRange: [40000, 59900],
    docFeeNotes: "Arizona has no doc fee cap. Typical range is $400-$599.",
    highFeeWarningThreshold: 60000,
  },
  WA: {
    state: "WA",
    stateName: "Washington",
    docFeeCap: null,
    docFeeTypicalRange: [15000, 20000],
    docFeeNotes:
      "Washington has no hard doc fee cap. Typical range is $150-$200.",
    highFeeWarningThreshold: 25000,
  },
  PA: {
    state: "PA",
    stateName: "Pennsylvania",
    docFeeCap: null,
    docFeeTypicalRange: [30000, 38900],
    docFeeNotes: "Pennsylvania has no doc fee cap. Typical is around $389.",
    highFeeWarningThreshold: 50000,
  },
  NC: {
    state: "NC",
    stateName: "North Carolina",
    docFeeCap: null,
    docFeeTypicalRange: [50000, 59900],
    docFeeNotes: "North Carolina has no doc fee cap. Typical is around $599.",
    highFeeWarningThreshold: 60000,
  },
  MI: {
    state: "MI",
    stateName: "Michigan",
    docFeeCap: null,
    docFeeTypicalRange: [15000, 30000],
    docFeeNotes:
      "Michigan has no hard doc fee cap. Typical range is $150-$300.",
    highFeeWarningThreshold: 35000,
  },
  CO: {
    state: "CO",
    stateName: "Colorado",
    docFeeCap: null,
    docFeeTypicalRange: [50000, 70000],
    docFeeNotes: "Colorado has no doc fee cap. Typical range is $500-$700.",
    highFeeWarningThreshold: 70000,
  },
  TN: {
    state: "TN",
    stateName: "Tennessee",
    docFeeCap: null,
    docFeeTypicalRange: [40000, 50000],
    docFeeNotes: "Tennessee has no doc fee cap. Typical is around $500.",
    highFeeWarningThreshold: 60000,
  },
  NV: {
    state: "NV",
    stateName: "Nevada",
    docFeeCap: null,
    docFeeTypicalRange: [45000, 59900],
    docFeeNotes: "Nevada has no doc fee cap. Typical is around $599.",
    highFeeWarningThreshold: 60000,
  },
  OR: {
    state: "OR",
    stateName: "Oregon",
    docFeeCap: null,
    docFeeTypicalRange: [10000, 11500],
    docFeeNotes: "Oregon has no hard cap. Typical range is $100-$115.",
    highFeeWarningThreshold: 15000,
  },
  MN: {
    state: "MN",
    stateName: "Minnesota",
    docFeeCap: null,
    docFeeTypicalRange: [7500, 10000],
    docFeeNotes: "Minnesota has no hard cap. Typical range is $75-$100.",
    highFeeWarningThreshold: 15000,
  },
  MA: {
    state: "MA",
    stateName: "Massachusetts",
    docFeeCap: null,
    docFeeTypicalRange: [30000, 39500],
    docFeeNotes: "Massachusetts has no doc fee cap. Typical is around $395.",
    highFeeWarningThreshold: 50000,
  },
  MD: {
    state: "MD",
    stateName: "Maryland",
    docFeeCap: null,
    docFeeTypicalRange: [40000, 50000],
    docFeeNotes: "Maryland has no doc fee cap. Typical is around $500.",
    highFeeWarningThreshold: 60000,
  },
  VA: {
    state: "VA",
    stateName: "Virginia",
    docFeeCap: null,
    docFeeTypicalRange: [50000, 59900],
    docFeeNotes: "Virginia has no doc fee cap. Typical is around $599.",
    highFeeWarningThreshold: 60000,
  },
  // Default for states not explicitly listed
  _DEFAULT: {
    state: "_DEFAULT",
    stateName: "Your State",
    docFeeCap: null,
    docFeeTypicalRange: [20000, 50000],
    docFeeNotes:
      "Doc fee rules vary by state. Typical US range is $200-$500. Always negotiable.",
    highFeeWarningThreshold: 50000,
  },
};

// All 50 states + DC, for the calculator dropdown. Keeps a single source of
// truth so the selector and analysis layer never drift apart.
export const US_STATES: Array<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

export function getStateFeeRules(state: string): StateFeeRules {
  return STATE_FEE_RULES[state] ?? STATE_FEE_RULES._DEFAULT;
}

// ─── Part C — Fee analysis ────────────────────────────────────────────────────

// The canonical verdict enum returned by analysis. `REJECT` covers both pure
// markup and doc fees above a state legal cap; the `illegal` flag distinguishes
// the latter so the UI can surface a brighter "ILLEGAL" badge.
export type Verdict = "REQUIRED" | "LEGITIMATE" | "NEGOTIATE" | "REJECT";

export interface FeeAnalysisResult {
  feeTypeId: string;
  displayName: string;
  category: FeeCategory;
  amountCents: number;
  verdict: Verdict;
  /** True only when the amount exceeds a state's legal doc fee cap. */
  illegal: boolean;
  negotiable: boolean;
  /** Plain-language, state-aware explanation of what this fee is. */
  explanation: string;
  /** What the buyer should do / say. */
  tip: string;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

// Detect a fee type from the free-text name a buyer copies off the dealer
// worksheet. Matches against displayName + commonNames, case-insensitively.
export function detectFeeType(name: string): FeeType | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;

  // Exact alias / display-name match first.
  for (const fee of FEE_TYPES) {
    if (fee.displayName.toLowerCase() === needle) return fee;
    if (fee.commonNames.some((n) => n.toLowerCase() === needle)) return fee;
  }
  // Substring match (e.g. "dealer doc fee" → doc_fee). Prefer the longest
  // matching alias so "additional dealer markup" beats a stray "dealer".
  let best: { fee: FeeType; len: number } | null = null;
  for (const fee of FEE_TYPES) {
    for (const alias of fee.commonNames) {
      const a = alias.toLowerCase();
      if (needle.includes(a) && (!best || a.length > best.len)) {
        best = { fee, len: a.length };
      }
    }
  }
  return best?.fee ?? null;
}

export function analyzeDocFee(
  amountCents: number,
  state: string,
): FeeAnalysisResult {
  const rules = getStateFeeRules(state);
  const docFeeType = FEE_TYPES.find((f) => f.id === "doc_fee")!;

  let verdict: Verdict;
  let illegal = false;
  let tip: string;

  if (rules.docFeeCap !== null && amountCents > rules.docFeeCap) {
    verdict = "REJECT";
    illegal = true;
    tip =
      `This fee is above ${rules.stateName}'s legal cap of ` +
      `${dollars(rules.docFeeCap)}. That is not legal — refuse to pay the ` +
      `amount over the cap and ask for a corrected worksheet.`;
  } else if (amountCents > rules.highFeeWarningThreshold) {
    verdict = "NEGOTIATE";
    tip =
      `This is above the typical range in ${rules.stateName}. Ask for it to ` +
      `be reduced or removed before you sign.`;
  } else {
    verdict = "LEGITIMATE";
    tip =
      `This is within the typical range for ${rules.stateName}. It's still ` +
      `worth asking the dealer to reduce or waive it.`;
  }

  return {
    feeTypeId: docFeeType.id,
    displayName: docFeeType.displayName,
    category: docFeeType.category,
    amountCents,
    verdict,
    illegal,
    negotiable: docFeeType.universalNegotiable,
    explanation: `${docFeeType.description} ${rules.docFeeNotes}`,
    tip,
  };
}

// Map a fee type's universal verdict (everything except doc fees, which are
// state-driven) onto the canonical Verdict enum.
function verdictFromUniversal(v: UniversalVerdict): Verdict {
  switch (v) {
    case "required":
      return "REQUIRED";
    case "legitimate":
      return "LEGITIMATE";
    case "negotiate":
      return "NEGOTIATE";
    case "reject":
      return "REJECT";
    case "varies":
      // Only doc_fee uses "varies"; callers route it through analyzeDocFee.
      return "NEGOTIATE";
  }
}

function tipForVerdict(fee: FeeType, verdict: Verdict): string {
  switch (verdict) {
    case "REQUIRED":
      return "This is a government fee set by your state. It's not negotiable — but confirm the amount matches your state's published rate.";
    case "REJECT":
      return fee.category === "pure_markup"
        ? "This is pure dealer markup with no real value. Ask to have it removed entirely. If the dealer won't budge, walk — another dealer will."
        : "This charge isn't worth what they're asking. Push to have it removed.";
    case "NEGOTIATE":
      return "This is negotiable and usually overpriced at the dealer. Get an outside quote first, or buy it later for less. Ask for it to be reduced or removed.";
    case "LEGITIMATE":
      return "This is within a normal range. It's still worth asking the dealer to reduce or waive it.";
  }
}

export function analyzeFee(
  feeTypeId: string,
  amountCents: number,
  state: string,
): FeeAnalysisResult {
  if (feeTypeId === "doc_fee") {
    return analyzeDocFee(amountCents, state);
  }

  const fee = FEE_TYPES.find((f) => f.id === feeTypeId);
  if (!fee) {
    // Unknown fee — treat conservatively as something to question.
    return {
      feeTypeId: "unknown",
      displayName: "Unrecognized Fee",
      category: "negotiable",
      amountCents,
      verdict: "NEGOTIATE",
      illegal: false,
      negotiable: true,
      explanation:
        "We couldn't match this to a known dealer fee. Ask the dealer to explain exactly what it covers in writing before agreeing to pay it.",
      tip: "Any fee you don't recognize should be itemized and explained. If they can't justify it, ask for it to be removed.",
    };
  }

  const verdict = verdictFromUniversal(fee.universalVerdict);

  return {
    feeTypeId: fee.id,
    displayName: fee.displayName,
    category: fee.category,
    amountCents,
    verdict,
    illegal: false,
    negotiable: fee.universalNegotiable,
    explanation: fee.description,
    tip: tipForVerdict(fee, verdict),
  };
}

// Aggregate totals for the results summary. "Removable" = anything the buyer
// could legitimately push to drop (negotiable and not a required state fee).
export interface FeeTotals {
  totalCents: number;
  nonNegotiableCents: number;
  removableCents: number;
}

export function summarizeFees(results: FeeAnalysisResult[]): FeeTotals {
  let totalCents = 0;
  let nonNegotiableCents = 0;
  let removableCents = 0;
  for (const r of results) {
    totalCents += r.amountCents;
    if (r.verdict === "REQUIRED" || !r.negotiable) {
      nonNegotiableCents += r.amountCents;
    } else if (r.verdict === "REJECT" || r.verdict === "NEGOTIATE") {
      removableCents += r.amountCents;
    }
  }
  return { totalCents, nonNegotiableCents, removableCents };
}

export const formatCents = dollars;
