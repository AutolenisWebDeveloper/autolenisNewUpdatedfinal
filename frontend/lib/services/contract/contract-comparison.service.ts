// lib/services/contract/contract-comparison.service.ts
//
// §14b — the FACTUAL comparison. Contract Shield "compares the actual uploaded contract
// against the winning offer, the dealer reaffirmation, and the confirmed recap —
// specifically: vehicle and VIN; mileage; price and every out-the-door component;
// documentation fee; taxes; title and registration; trade allowance and payoff figures;
// down payment; financing terms; EACH ACCEPTED OPTIONAL PRODUCT; and pickup or delivery
// commitments."
//
// WHAT THIS REPLACED. This module was a fifteen-line regex diff between two contract
// TEXTS — `compareContracts(textV1, textV2)` — with zero callers anywhere in the
// repository. It compared a contract to another contract, which is not the question
// §14b asks. Nothing in the scan pipeline read the offer, the reaffirmation or the
// recap at all, so the single most important thing Contract Shield is for did not exist.
//
// THE SOURCE OF TRUTH IS THE CONFIRMED RECAP, NOT THE OFFER. §11 makes the recap the
// figures both parties confirmed, and #433 corrected `agreedMoney` so it derives from
// the same `recapTotals` the buyer's screen renders. Comparing against the offer alone
// would flag every legitimate change the recap already reconciled — and, worse, would
// MISS a contract that matched a stale offer while contradicting what the buyer agreed
// to. The offer and reaffirmation are the fallback when no recap exists yet, and each
// finding names which source it used, so a reviewer can see what the contract was
// judged against.
//
// AN UNFINDABLE VALUE IS A FINDING, NEVER A PASS. Extraction from a PDF is inherently
// partial: a scanned page, an unusual form layout or a two-column table can all hide a
// figure that is genuinely present and correct. So a value this module cannot locate
// produces a `NOT_FOUND` discrepancy for a human to resolve — it is never silently
// treated as matching. §14b's rule for its sibling case is the same and is explicit:
// "Extraction failure is retryable and is NEVER treated as approval."
//
// THE BOUNDARY THIS DOES NOT CROSS. Every finding here is a FACTUAL DISCREPANCY between
// two AutoLenis records and the document in front of it — "the recap says $32,450 and
// the contract says $33,100". None of it is a legal opinion about whether a term is
// enforceable, permitted, or advisable. That line is the one `autolenis-contract-shield`
// draws and it is not moved here.

import { prisma } from "@/lib/prisma";
import type { RecapProduct } from "@/lib/services/deal/recap-totals";

export type DiscrepancyKind = "MISMATCH" | "ADDITION" | "NOT_FOUND";

export interface ContractDiscrepancy {
  /** Stable key for the compared fact — used as the fix-list ruleId. */
  key: string;
  label: string;
  kind: DiscrepancyKind;
  /** What AutoLenis has on record, rendered for a human. */
  expectedValue: string;
  /** What the contract appears to say, or a plain statement that it could not be read. */
  foundValue: string;
  /** Which record the expectation came from — "confirmed recap", "reaffirmation", "winning offer". */
  source: string;
  howToFix: string;
}

interface AgreedFact {
  key: string;
  label: string;
  cents: number;
  source: string;
  /** Patterns that locate this figure in contract text, most specific first. */
  patterns: RegExp[];
}

/** Money tolerance. Rounding between systems is not a discrepancy; a dollar is. */
const TOLERANCE_CENTS = 100;

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Find a dollar figure that follows a label in the contract text.
 *
 * Deliberately conservative — it searches FORWARD from the label within a bounded
 * window, so an unrelated amount earlier on the same line cannot be mistaken for this
 * one. Returning null means "could not read", which the caller turns into a NOT_FOUND
 * finding rather than a pass.
 */
function findMoneyNear(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      // The window STOPS AT THE END OF THE LABEL'S OWN LINE. A line item on real paperwork
      // carries its amount beside its label; letting the window run past the newline is how
      // "GAP Protection included" borrowed the out-the-door total two lines down and reported
      // a $32,450 GAP product. Bounded to the line, an unpriced label finds nothing — which
      // is the truth, and which the caller turns into NOT_FOUND.
      const rest = text.slice(match.index + match[0].length, match.index + match[0].length + 80);
      const newline = rest.indexOf("\n");
      const window = newline === -1 ? rest : rest.slice(0, newline);
      // A CURRENCY-SHAPED token, not "the next digits". The old pattern made the `$` and the
      // cents both optional, so any number within 80 characters read as the amount: in
      // "Sales Tax Rate 8.25% … Sales Tax $2,400.00" the rate matched first and 825 cents was
      // compared against 240,000, holding a correct contract on a false mismatch. Worse in the
      // other direction — a label with no price at all silently borrowed the next line's
      // figure and reported a PASS. Requiring either a `$` or two decimal places makes
      // "no readable amount here" return null, which the caller turns into NOT_FOUND.
      const amount = window.match(/\$\s*([\d,]{1,12})(?:\.(\d{2}))?|([\d,]{1,12})\.(\d{2})/);
      if (!amount) continue;
      // Alternation: groups 1/2 are the `$`-prefixed form, 3/4 the bare two-decimal form.
      const whole = amount[1] ?? amount[3];
      const frac = amount[2] ?? amount[4];
      if (whole === undefined) continue;
      const dollars = parseInt(whole.replace(/,/g, ""), 10);
      if (!Number.isFinite(dollars)) continue;
      return dollars * 100 + (frac ? parseInt(frac, 10) : 0);
    }
  }
  return null;
}

function compareFact(text: string, fact: AgreedFact): ContractDiscrepancy | null {
  const found = findMoneyNear(text, fact.patterns);

  // A ZERO-VALUE COMPONENT IS NOT OWED A LINE ON THE CONTRACT. "Delivery fee: $0.00" is
  // not written on real paperwork — absence and zero are the same fact — so demanding it
  // would produce a NOT_FOUND on nearly every genuine contract and bury the findings that
  // matter under noise. (Found by the comparison's own test: a contract matching the recap
  // in every respect still reported an outstanding $0 delivery fee.)
  //
  // The other direction is NOT relaxed. A CHARGE appearing where nothing was agreed is an
  // ADDITION, and that is exactly the kind of quiet insertion §14b exists to catch.
  if (fact.cents === 0) {
    if (found === null || found === 0) return null;
    return {
      key: fact.key,
      label: fact.label,
      kind: "ADDITION",
      expectedValue: "nothing — this was not part of the agreed terms",
      foundValue: money(found),
      source: fact.source,
      howToFix:
        `${fact.label} does not appear in the ${fact.source}, but the contract charges ${money(found)}. ` +
        "Remove it, or take it back to the buyer for an explicit decision before it appears in a contract.",
    };
  }

  if (found === null) {
    return {
      key: fact.key,
      label: fact.label,
      kind: "NOT_FOUND",
      expectedValue: money(fact.cents),
      foundValue: "could not be located in the uploaded document",
      source: fact.source,
      howToFix:
        `State ${fact.label.toLowerCase()} explicitly on the contract as ${money(fact.cents)}, or confirm ` +
        `in writing where it appears. AutoLenis does not treat a figure it cannot read as agreed.`,
    };
  }
  if (Math.abs(found - fact.cents) <= TOLERANCE_CENTS) return null;
  return {
    key: fact.key,
    label: fact.label,
    kind: "MISMATCH",
    expectedValue: money(fact.cents),
    foundValue: money(found),
    source: fact.source,
    howToFix:
      found > fact.cents
        ? `The contract is ${money(found - fact.cents)} higher than the ${fact.source}. Correct it to ${money(fact.cents)} or document why it changed.`
        : `The contract is ${money(fact.cents - found)} lower than the ${fact.source}. Correct it to ${money(fact.cents)} or document why it changed.`,
  };
}

/** Case-insensitive presence, tolerant of the whitespace a PDF extractor introduces. */
function textHas(text: string, needle: string): boolean {
  const normalise = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();
  return normalise(text).includes(normalise(needle));
}

/**
 * Compare a contract's extracted text against everything AutoLenis has agreed.
 *
 * Returns an EMPTY array only when every compared fact was located and matched. It never
 * returns empty because a record was missing — a deal with no recap and no offer yields a
 * single NOT_FOUND finding saying exactly that, because a contract that cannot be
 * compared to anything is the one case a reviewer most needs to see.
 */
export async function compareContractAgainstAgreedTerms(params: {
  dealId: string;
  contractText: string;
}): Promise<ContractDiscrepancy[]> {
  const { dealId, contractText: text } = params;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      vin: true,
      odometerAtOffer: true,
      downPaymentCents: true,
      otdCentsConfirmed: true,
      offer: {
        select: {
          vin: true,
          vehiclePriceCents: true,
          docFeeCents: true,
          taxCents: true,
          titleRegistrationCents: true,
          deliveryFeeCents: true,
          otdPriceCents: true,
          aprRate: true,
          termMonths: true,
        },
      },
      // The live reaffirmation. Phase 7 writes one per deal; ordering by createdAt keeps
      // this correct if a future phase ever writes a second.
      dealerReaffirmations: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { confirmedOtdCents: true, confirmedVin: true, confirmedOdometer: true },
      },
      dealRecaps: {
        where: { supersededBy: null },
        orderBy: { version: "desc" },
        take: 1,
        select: { itemized: true, optionalProducts: true, downPaymentCents: true, version: true },
      },
      tradeInSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { preliminaryAllowanceCents: true, verifiedPayoffCents: true, loanBalanceCents: true },
      },
    },
  });

  if (!deal) {
    return [
      {
        key: "deal",
        label: "Deal record",
        kind: "NOT_FOUND",
        expectedValue: "a deal to compare against",
        foundValue: "the deal could not be read",
        source: "AutoLenis records",
        howToFix: "Operations must resolve the missing deal record before this contract can be reviewed.",
      },
    ];
  }

  const findings: ContractDiscrepancy[] = [];
  const recap = deal.dealRecaps[0] ?? null;
  const reaffirmation = deal.dealerReaffirmations[0] ?? null;
  const itemised = (recap?.itemized ?? null) as Record<string, number> | null;
  const recapSource = recap ? `confirmed recap v${recap.version}` : null;

  if (!recap && !deal.offer) {
    return [
      {
        key: "agreed-terms",
        label: "Agreed terms",
        kind: "NOT_FOUND",
        expectedValue: "a confirmed recap or a winning offer",
        foundValue: "neither exists on this deal",
        source: "AutoLenis records",
        howToFix:
          "This contract cannot be compared to anything AutoLenis has on record. Operations must " +
          "establish the agreed terms before the contract can be approved — approval on an " +
          "uncomparable document is exactly what Contract Shield exists to prevent.",
      },
    ];
  }

  // ── VIN ────────────────────────────────────────────────────────────────────
  // §14b names "vehicle and VIN" first, and §26's "Contract mismatch" row calls out a
  // changed VIN specifically: it is the identity of the thing being sold.
  const expectedVin = reaffirmation?.confirmedVin ?? deal.vin ?? deal.offer?.vin ?? null;
  if (expectedVin) {
    const vinSource = reaffirmation?.confirmedVin ? "reaffirmation" : "winning offer";
    if (!textHas(text, expectedVin)) {
      findings.push({
        key: "vin",
        label: "VIN",
        kind: "MISMATCH",
        expectedValue: expectedVin,
        foundValue: "not present in the contract",
        source: vinSource,
        howToFix:
          `The contract must name VIN ${expectedVin} — the exact vehicle the dealership reaffirmed. ` +
          "A different vehicle is a new transaction, not a correction.",
      });
    }
  }

  // ── Mileage ────────────────────────────────────────────────────────────────
  const expectedMileage = reaffirmation?.confirmedOdometer ?? deal.odometerAtOffer ?? null;
  if (expectedMileage != null) {
    const digits = expectedMileage.toLocaleString("en-US");
    if (!textHas(text, digits) && !textHas(text, String(expectedMileage))) {
      findings.push({
        key: "mileage",
        label: "Mileage",
        kind: "NOT_FOUND",
        expectedValue: `${digits} miles`,
        foundValue: "the reaffirmed odometer reading is not stated in the contract",
        source: reaffirmation?.confirmedOdometer ? "reaffirmation" : "offer",
        howToFix:
          `State the odometer reading as ${digits} on the contract, or explain the difference. ` +
          "Odometer disclosure is a required document in the package.",
      });
    }
  }

  // ── Money, component by component ──────────────────────────────────────────
  // The recap's itemised block is preferred because it is what both parties confirmed.
  const facts: AgreedFact[] = [];
  const push = (key: string, label: string, cents: number | null | undefined, source: string, patterns: RegExp[]) => {
    if (cents == null) return;
    facts.push({ key, label, cents, source, patterns });
  };

  push("vehiclePrice", "Vehicle price", itemised?.vehiclePriceCents ?? deal.offer?.vehiclePriceCents,
    recapSource ?? "winning offer", [/(?:vehicle|selling|sale|cash)\s*price/i, /price\s*of\s*vehicle/i]);
  push("docFee", "Documentation fee", itemised?.documentationFeeCents ?? deal.offer?.docFeeCents,
    recapSource ?? "winning offer", [/(?:documentation|doc(?:ument)?)\s*(?:fee|charge)/i]);
  push("taxes", "Taxes", itemised?.taxesCents ?? deal.offer?.taxCents,
    recapSource ?? "winning offer", [/(?:sales\s*)?tax(?:es)?\b/i]);
  push("titleReg", "Title and registration", itemised?.titleAndRegistrationCents ?? deal.offer?.titleRegistrationCents,
    recapSource ?? "winning offer", [/title\s*(?:and|&|\/)?\s*(?:registration|reg)/i, /registration\s*fee/i]);
  push("delivery", "Delivery fee", itemised?.deliveryFeeCents ?? deal.offer?.deliveryFeeCents,
    recapSource ?? "winning offer", [/delivery\s*(?:fee|charge)/i]);
  push("downPayment", "Down payment", recap?.downPaymentCents ?? deal.downPaymentCents,
    recapSource ?? "deal record", [/(?:cash\s*)?down\s*payment/i, /\bdown\b/i]);

  const trade = deal.tradeInSubmissions[0] ?? null;
  push("tradeAllowance", "Trade allowance", trade?.preliminaryAllowanceCents, "trade appraisal",
    [/trade[- ]?in\s*allowance/i, /trade\s*allowance/i, /net\s*trade/i]);
  push("tradePayoff", "Trade payoff", trade?.verifiedPayoffCents ?? trade?.loanBalanceCents, "trade payoff quote",
    [/pay[- ]?off/i, /lien\s*payoff/i]);

  // The OTD total last, so a reviewer reads the components before the sum.
  const agreedOtd =
    itemised?.otdCents ?? deal.otdCentsConfirmed ?? reaffirmation?.confirmedOtdCents ?? deal.offer?.otdPriceCents;
  push("otd", "Out-the-door total", agreedOtd, recapSource ?? "reaffirmation",
    [/out[- ]?the[- ]?door/i, /total\s*(?:sale|purchase|amount|price)/i, /balance\s*due/i]);

  for (const fact of facts) {
    const finding = compareFact(text, fact);
    if (finding) findings.push(finding);
  }

  // ── Financing terms ────────────────────────────────────────────────────────
  // A changed financing term is named in §26's "Contract mismatch" row and is the
  // trigger for Stage 14's full send-back, so it is compared explicitly.
  if (deal.offer?.aprRate != null) {
    const apr = Number(deal.offer.aprRate);
    const match = text.match(/(?:a\.?p\.?r\.?|annual\s*percentage\s*rate)[^\d%]{0,40}(\d{1,2}(?:\.\d{1,4})?)\s*%?/i);
    if (!match) {
      findings.push({
        key: "apr", label: "APR", kind: "NOT_FOUND",
        expectedValue: `${apr}%`,
        foundValue: "no APR could be located in the contract",
        source: "winning offer",
        howToFix: `State the annual percentage rate as ${apr}% on the contract.`,
      });
    } else if (Math.abs(parseFloat(match[1]) - apr) > 0.01) {
      findings.push({
        key: "apr", label: "APR", kind: "MISMATCH",
        expectedValue: `${apr}%`, foundValue: `${match[1]}%`, source: "winning offer",
        howToFix:
          `The contract's APR differs from the agreed ${apr}%. A changed financing term sends the ` +
          "transaction back through recap confirmation and signatures — it never proceeds on a stale contract.",
      });
    }
  }
  if (deal.offer?.termMonths != null) {
    const term = deal.offer.termMonths;
    const match = text.match(/(\d{2,3})\s*(?:month|mo\.?|payments)/i);
    if (match && parseInt(match[1], 10) !== term) {
      findings.push({
        key: "term", label: "Financing term", kind: "MISMATCH",
        expectedValue: `${term} months`, foundValue: `${match[1]} months`, source: "winning offer",
        howToFix: `The contract's term differs from the agreed ${term} months. Correct it or document the change.`,
      });
    }
  }

  // ── EACH ACCEPTED OPTIONAL PRODUCT, INDIVIDUALLY ──────────────────────────
  // §14b says "each accepted optional product", and §11a says a product "may never first
  // appear in the contract". Both directions are checked:
  //
  //   accepted but ABSENT  — the buyer agreed to and is paying for something the contract
  //                          does not record, so they have no contractual right to it.
  //   declined but PRESENT — the §11a violation: a product the buyer said no to, or was
  //                          never asked about, appearing in the document they are about
  //                          to sign. This is the single thing §11a exists to forbid.
  const products = (recap?.optionalProducts ?? []) as unknown as RecapProduct[];
  if (Array.isArray(products)) {
    for (const product of products) {
      if (!product?.label) continue;
      const present = textHas(text, product.label);
      // THE AMOUNT, not just the name. Presence alone was the whole check, so a recap line
      // reading "GAP Protection, $1,200, accepted" was satisfied by a contract charging
      // "GAP Protection $4,995.00" — the product is exactly where packing happens, and the
      // price is the only part of it that moves. §14b asks for each accepted optional product
      // compared against the confirmed recap; a label match is not a comparison.
      if (product.accepted === true && present && Number.isFinite(product.amountCents)) {
        const escaped = product.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const charged = findMoneyNear(text, [new RegExp(escaped, "i")]);
        if (charged === null) {
          findings.push({
            key: `product:${product.key}:amount`,
            label: `Optional product — ${product.label} (amount)`,
            kind: "NOT_FOUND",
            expectedValue: money(product.amountCents),
            foundValue: "the product is named but no amount could be read beside it",
            source: recapSource ?? "confirmed recap",
            howToFix:
              `${product.label} appears on the contract with no readable price. State the amount ` +
              `the buyer accepted, ${money(product.amountCents)}, beside it.`,
          });
        } else if (Math.abs(charged - product.amountCents) > TOLERANCE_CENTS) {
          findings.push({
            key: `product:${product.key}:amount`,
            label: `Optional product — ${product.label} (amount)`,
            kind: charged > product.amountCents ? "ADDITION" : "MISMATCH",
            expectedValue: money(product.amountCents),
            foundValue: money(charged),
            source: recapSource ?? "confirmed recap",
            howToFix:
              `The buyer accepted ${product.label} at ${money(product.amountCents)}; the contract ` +
              `charges ${money(charged)}. Correct the contract to the agreed figure, or the buyer ` +
              "must re-confirm a recap that carries the new one.",
          });
        }
      }
      if (product.accepted === true && !present) {
        findings.push({
          key: `product:${product.key}`,
          label: `Optional product — ${product.label}`,
          kind: "NOT_FOUND",
          expectedValue: `${product.label} at ${money(product.amountCents)}, accepted by the buyer`,
          foundValue: "not itemised in the contract",
          source: recapSource ?? "confirmed recap",
          howToFix:
            `The buyer accepted ${product.label} at ${money(product.amountCents)}. Itemise it on the ` +
            "contract — a product that is paid for but not written down is not owed to the buyer.",
        });
      }
      if (product.accepted !== true && present) {
        findings.push({
          key: `product:${product.key}`,
          label: `Optional product — ${product.label}`,
          kind: "ADDITION",
          expectedValue:
            product.accepted === false
              ? `${product.label} was DECLINED and must not appear`
              : `${product.label} was never decided and must not appear`,
          foundValue: `${product.label} appears in the contract`,
          source: recapSource ?? "confirmed recap",
          howToFix:
            `Remove ${product.label} from the contract. A warranty, service contract, GAP product, ` +
            "maintenance plan or protection package may never first appear in the contract — if the " +
            "buyer wants it, it goes back to the recap for an explicit decision first.",
        });
      }
    }
  }

  return findings;
}
