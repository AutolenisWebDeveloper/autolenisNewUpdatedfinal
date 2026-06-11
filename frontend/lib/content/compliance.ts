// Phase C2 — Compliance validator for generated buying-guide content.
//
// AutoLenis content is marketing copy for a regulated, money-adjacent space, so
// every generated article must clear a hard compliance bar before it can be
// auto-published. The rules mirror the skill spec:
//
//   ✅ Allowed: "dealers compete for your best price", "8 dealers, 48-hour
//      auction", factual fee mechanics, state fee caps stated as fact.
//   ❌ Never:   specific dollar/percent *savings* claims, guarantees, fake
//      testimonials, or "beat any price" style promises.
//
// A violation never hard-fails generation — it routes the article to
// REVIEW_NEEDED so a human checks it. This file is pure (no I/O) so it is unit
// testable without the model or the database.

export interface ComplianceViolation {
  rule: string;
  match: string;
  detail: string;
}

export interface ComplianceResult {
  passed: boolean;
  violations: ComplianceViolation[];
}

interface ComplianceRule {
  id: string;
  detail: string;
  patterns: RegExp[];
}

// Strip HTML tags so detection runs on prose, not markup, and collapse the
// whitespace the tag removal leaves behind.
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// "Guaranteed asset protection" is the legal name for GAP insurance and is a
// legitimate fee term — strip it before testing for guarantee language so it
// doesn't trip the guarantee rule.
function neutralizeAllowedPhrases(text: string): string {
  return text.replace(/guaranteed\s+asset\s+protection/gi, "GAP insurance");
}

const RULES: ComplianceRule[] = [
  {
    id: "dollar_savings_claim",
    detail:
      "States a specific dollar savings amount. Use factual mechanics instead (e.g. 'dealers compete for your best price').",
    patterns: [
      // savings/discount language followed by a dollar figure
      /\b(sav(?:e|es|ed|ing|ings)|discount(?:ed)?|slash(?:ed)?|knock(?:ed)?\s+off|cut)\b[^.<\n]{0,30}\$\s?\d[\d,]*/i,
      // a dollar figure followed by savings language
      /\$\s?\d[\d,]*[^.<\n]{0,25}\b(in\s+savings|off\s+(?:msrp|sticker|invoice)|saved|discount|less\s+than\s+(?:msrp|sticker))\b/i,
    ],
  },
  {
    id: "percent_savings_claim",
    detail:
      "States a specific percentage savings/discount. Avoid quantifying savings.",
    patterns: [
      /\b(sav(?:e|es|ed|ing|ings)|discount|off|below)\b[^.<\n]{0,20}\d{1,3}\s?%/i,
      /\d{1,3}\s?%[^.<\n]{0,20}\b(off|savings|discount|below\s+(?:msrp|invoice|sticker))\b/i,
    ],
  },
  {
    id: "guarantee_claim",
    detail:
      "Makes a guarantee. AutoLenis never guarantees price, savings, or outcomes.",
    patterns: [
      /\bguarantee(?:d|s|ing)?\b/i,
      /\bwe\s+promise\b/i,
      /\bpromised\b/i,
      /\bassure(?:d|s)?\b/i,
    ],
  },
  {
    id: "price_promise_claim",
    detail:
      "Makes an unverifiable lowest/beat-any-price promise. Frame as competition, not a promise.",
    patterns: [
      /\bbeat\s+any\s+(?:price|offer|deal|quote)\b/i,
      /\bunbeatable\s+(?:price|deal|offer)\b/i,
      /\bprice[-\s]?match\s+guarantee\b/i,
      /\b(?:lowest|cheapest|best)\s+price\s+(?:guaranteed|promise|promised|in\s+town)\b/i,
    ],
  },
  {
    id: "testimonial_claim",
    detail:
      "Contains a fake testimonial, customer quote, or star rating. AutoLenis content uses no testimonials.",
    patterns: [
      /"[^"]{0,80}\bI\s+(?:saved|got|paid|scored)\b[^"]{0,80}"/i,
      /\b\d(?:\.\d)?\s*(?:out\s+of\s+5|\/\s?5|stars?)\b/i,
      /★/,
    ],
  },
  {
    // AutoLenis represents the BUYER — never a dealer, seller, or lender. Copy
    // must not frame AutoLenis as selling cars or financing loans.
    id: "buyer_misrepresentation",
    detail:
      "Frames AutoLenis as a dealer, seller, or lender. AutoLenis represents the buyer — dealers compete for the buyer's business; AutoLenis never sells or finances vehicles.",
    patterns: [
      /\b(?:we|autolenis)\s+(?:sell|sells|finance|finances|lend|lends|loan|loans)\b/i,
      /\bour\s+(?:dealership|dealerships|lot|inventory\s+of\s+cars\s+for\s+sale|financing|loans?)\b/i,
      /\b(?:as|we\s+are)\s+your\s+(?:dealer|dealership|lender)\b/i,
      /\bautolenis\s+(?:is\s+a|,?\s+a)\s+(?:dealer|dealership|lender|car\s+dealer)\b/i,
    ],
  },
  {
    // Canonical pricing language: the $99 is a NON-REFUNDABLE Auction Access
    // Fee, NOT a deposit. AI must never reintroduce "refundable deposit".
    id: "pricing_language",
    detail:
      'Misstates the $99 pricing. It is a one-time, non-refundable Auction Access Fee — never a "deposit" and never "refundable". Use the canonical phrasing.',
    patterns: [
      // "refundable deposit" / "refundable $99" — but NOT "non-refundable …".
      /(?<!non[-\s])\brefundable\s+deposit\b/i,
      /\$\s?99[^.<\n]{0,30}\bdeposit\b/i,
      /\bdeposit\b[^.<\n]{0,30}\$\s?99/i,
      /(?<!non[-\s])\brefundable\s+\$\s?99\b/i,
      /\$\s?99[^.<\n]{0,30}(?<!non[-\s])\brefundable\b/i,
    ],
  },
];

// Validate a block of generated text (HTML or plain). Returns every violation
// found so reviewers see the full picture, not just the first hit.
export function validateCompliance(content: string): ComplianceResult {
  const text = neutralizeAllowedPhrases(stripHtml(content));
  const violations: ComplianceViolation[] = [];

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const m = text.match(pattern);
      if (m) {
        violations.push({
          rule: rule.id,
          match: m[0].trim().slice(0, 120),
          detail: rule.detail,
        });
        break; // one violation per rule is enough to flag it
      }
    }
  }

  return { passed: violations.length === 0, violations };
}
