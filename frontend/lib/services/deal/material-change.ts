// lib/services/deal/material-change.ts
// §10a — what counts as a material change, and what the buyer is shown.
//
// A PURE MODULE ON PURPOSE. This holds no database access and no I/O, because the seven rules
// below are the business rule this phase exists to enforce and they deserve to be provable
// without a database, a fixture buyer, or a running server. `dealer-reaffirmation.service.ts`
// supplies the two snapshots; everything here is a comparison.
//
// §10a, quoted, because the list is exhaustive and paraphrasing it is how a rule goes missing:
//
//   "Buyer approval is required for any of: an out-the-door increase; a different VIN; any new
//    fee or add-on; any change to APR, term, or payment; odometer more than 500 miles above the
//    confirmed offer; delivery more than seven days later than confirmed; or the loss of a
//    required year, trim, condition, drivetrain, or feature.
//
//    A **lower** out-the-door amount with everything else unchanged applies automatically in the
//    buyer's favor. A change that pushes the deal above the approved ceiling cannot be accepted
//    at all."
//
// THREE OUTCOMES, NOT TWO, and the difference is the whole design:
//
//   AUTO_APPLY   a lower OTD with everything else unchanged. Applied in the buyer's favour with
//                no screen and no decision. "Everything else unchanged" is load-bearing — a
//                $400 discount arriving beside a different VIN is not a discount, it is a
//                different car at a lower price, and that is the buyer's call.
//   REFUSE       any proposal whose OTD exceeds the buyer's approved ceiling. Not shown as a
//                choice, because §10a says it "cannot be accepted at all" — offering it as an
//                accept/reject would put a button in front of a buyer that must never be pressed.
//   DECIDE       everything else. Side by side, confirmed versus proposed, one accept, one reject.
//
// ORDER MATTERS. REFUSE is evaluated before AUTO_APPLY and before DECIDE, so an above-ceiling
// proposal is refused even when it also happens to lower some other figure.
//
// WHY EACH DIFFERENCE CARRIES ITS OWN LABEL AND DIRECTION. §10a's screen has to make the
// difference "unmissable" — the failure mode is a buyer accepting a change they did not notice,
// and no later screen recovers it. A renderer needs to know not just THAT the VIN changed but
// that this is the vehicle's identity changing, so the row can be weighted accordingly. Colour
// alone cannot carry that (WCAG AA, and `severity` is what the UI uses for text and iconography
// as well as tint).

/** Miles above the confirmed odometer that stop being ordinary lot movement. §10a. */
export const ODOMETER_TOLERANCE_MILES = 500;
/** Days later than the confirmed delivery that stop being a scheduling detail. §10a. */
export const DELIVERY_TOLERANCE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ChangeSeverity = "IDENTITY" | "MONEY" | "TERMS" | "TIMING" | "SPECIFICATION";

export interface MaterialDifference {
  /** Stable key, used as the React key and asserted in tests. */
  field: string;
  /** What the buyer reads as the row heading. */
  label: string;
  severity: ChangeSeverity;
  /** What the dealership confirmed at offer time, already formatted for display. */
  confirmed: string;
  /** What the dealership now proposes, already formatted for display. */
  proposed: string;
  /** One sentence naming the consequence, not the mechanism. */
  consequence: string;
}

export interface ReaffirmationSnapshot {
  otdCents: number | null;
  vin: string | null;
  odometer: number | null;
  aprRate: number | null;
  termMonths: number | null;
  monthlyPaymentCents: number | null;
  deliveryDate: Date | null;
  vehicleYear: number | null;
  vehicleTrim: string | null;
  vehicleCondition: string | null;
  drivetrain: string | null;
  /** Fee line items, `{ label, amountCents }`. */
  feeItems: FeeLike[];
  /** Optional products and add-ons, `{ label, amountCents }`. */
  addOnItems: FeeLike[];
  /** Required features the offer matched, by name. */
  requiredFeatures: string[];
}

export interface FeeLike {
  label: string;
  amountCents: number | null;
}

export type MaterialChangeOutcome =
  | { outcome: "NONE"; differences: [] }
  | { outcome: "AUTO_APPLY"; differences: MaterialDifference[]; newOtdCents: number; savingCents: number }
  | { outcome: "REFUSE"; differences: MaterialDifference[]; ceilingCents: number; proposedOtdCents: number }
  | { outcome: "DECIDE"; differences: MaterialDifference[] };

function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function normaliseLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Line items keyed by normalised label, so "Doc Fee" and "  doc   fee " are one item.
 *
 * THE DISPLAY LABEL IS CARRIED ALONGSIDE THE KEY, not derived from it. Matching needs a normalised
 * key; the BUYER needs the dealership's own words. Rendering the key would show "reconditioning"
 * where the dealership wrote "Reconditioning" — small, but this screen is the one place a buyer
 * decides whether a changed deal is still theirs, and a fee that does not look like the fee on
 * their paperwork is a fee they have to think twice about.
 */
function byLabel(items: FeeLike[]): Map<string, { cents: number; display: string }> {
  const m = new Map<string, { cents: number; display: string }>();
  for (const it of items) {
    if (!it || typeof it.label !== "string") continue;
    const key = normaliseLabel(it.label);
    if (!key) continue;
    const prior = m.get(key);
    m.set(key, {
      cents: (prior?.cents ?? 0) + (it.amountCents ?? 0),
      // First spelling wins, so a duplicated line does not flip the label mid-comparison.
      display: prior?.display ?? it.label.trim(),
    });
  }
  return m;
}

/**
 * Compare the confirmed offer against what the dealership now proposes.
 *
 * `ceilingCents` is the buyer's APPROVED amount read server-side from the prequalification —
 * never a client-supplied figure, and never the buyer's stated budget. Pass null only where the
 * approval genuinely carries no amount, in which case REFUSE cannot be evaluated and the
 * proposal falls through to DECIDE rather than being waved past.
 */
export function classifyMaterialChange(
  confirmed: ReaffirmationSnapshot,
  proposed: ReaffirmationSnapshot,
  ceilingCents: number | null,
): MaterialChangeOutcome {
  const differences: MaterialDifference[] = [];

  // 1. VIN — the vehicle's identity.
  if (proposed.vin && confirmed.vin && proposed.vin !== confirmed.vin) {
    differences.push({
      field: "vin",
      label: "Vehicle identification number",
      severity: "IDENTITY",
      confirmed: confirmed.vin,
      proposed: proposed.vin,
      consequence: "This is a different vehicle from the one you chose.",
    });
  }

  // 2. Out-the-door amount.
  const otdChanged =
    proposed.otdCents != null && confirmed.otdCents != null && proposed.otdCents !== confirmed.otdCents;
  if (otdChanged) {
    const up = proposed.otdCents! > confirmed.otdCents!;
    differences.push({
      field: "otdCents",
      label: "Out-the-door price",
      severity: "MONEY",
      confirmed: money(confirmed.otdCents),
      proposed: money(proposed.otdCents),
      consequence: up
        ? `You would pay ${money(proposed.otdCents! - confirmed.otdCents!)} more than the offer you accepted.`
        : `You would pay ${money(confirmed.otdCents! - proposed.otdCents!)} less than the offer you accepted.`,
    });
  }

  // 3. New fees and new add-ons. A REMOVED fee is not a material change — §10a names "any NEW
  //    fee or add-on", and a dealership dropping a charge needs no permission. An INCREASED
  //    existing fee is a new charge by another name and is treated as one.
  for (const [kind, before, after, label] of [
    ["fee", byLabel(confirmed.feeItems), byLabel(proposed.feeItems), "fee"],
    ["addOn", byLabel(confirmed.addOnItems), byLabel(proposed.addOnItems), "optional product"],
  ] as const) {
    for (const [key, entry] of after) {
      const prior = before.get(key);
      if (prior === undefined) {
        differences.push({
          field: `${kind}:${key}`,
          label: `New ${label}: ${entry.display}`,
          severity: "MONEY",
          confirmed: "not on your offer",
          proposed: money(entry.cents),
          consequence: `A ${label} that was not part of the offer you accepted.`,
        });
      } else if (entry.cents > prior.cents) {
        differences.push({
          field: `${kind}:${key}`,
          label: `${entry.display} increased`,
          severity: "MONEY",
          confirmed: money(prior.cents),
          proposed: money(entry.cents),
          consequence: `This ${label} is ${money(entry.cents - prior.cents)} higher than on your offer.`,
        });
      }
    }
  }

  // 4. APR, term, payment.
  if (proposed.aprRate != null && confirmed.aprRate != null && proposed.aprRate !== confirmed.aprRate) {
    differences.push({
      field: "aprRate",
      label: "APR",
      severity: "TERMS",
      confirmed: `${confirmed.aprRate.toFixed(2)}%`,
      proposed: `${proposed.aprRate.toFixed(2)}%`,
      consequence: "The financing rate quoted with your offer has changed.",
    });
  }
  if (proposed.termMonths != null && confirmed.termMonths != null && proposed.termMonths !== confirmed.termMonths) {
    differences.push({
      field: "termMonths",
      label: "Loan term",
      severity: "TERMS",
      confirmed: `${confirmed.termMonths} months`,
      proposed: `${proposed.termMonths} months`,
      consequence: "The length of the loan quoted with your offer has changed.",
    });
  }
  if (
    proposed.monthlyPaymentCents != null &&
    confirmed.monthlyPaymentCents != null &&
    proposed.monthlyPaymentCents !== confirmed.monthlyPaymentCents
  ) {
    differences.push({
      field: "monthlyPaymentCents",
      label: "Monthly payment",
      severity: "TERMS",
      confirmed: `${money(confirmed.monthlyPaymentCents)}/mo`,
      proposed: `${money(proposed.monthlyPaymentCents)}/mo`,
      consequence: "The estimated monthly payment quoted with your offer has changed.",
    });
  }

  // 5. Odometer, with the 500-mile tolerance. Only ABOVE counts: a lower reading than the offer
  //    stated is the dealership correcting itself in the buyer's favour.
  if (proposed.odometer != null && confirmed.odometer != null) {
    const delta = proposed.odometer - confirmed.odometer;
    if (delta > ODOMETER_TOLERANCE_MILES) {
      differences.push({
        field: "odometer",
        label: "Mileage",
        severity: "SPECIFICATION",
        confirmed: `${confirmed.odometer.toLocaleString("en-US")} mi`,
        proposed: `${proposed.odometer.toLocaleString("en-US")} mi`,
        consequence: `${delta.toLocaleString("en-US")} miles more than the offer stated.`,
      });
    }
  }

  // 6. Delivery, with the seven-day tolerance. Only LATER counts.
  if (proposed.deliveryDate && confirmed.deliveryDate) {
    const deltaDays = (proposed.deliveryDate.getTime() - confirmed.deliveryDate.getTime()) / DAY_MS;
    if (deltaDays > DELIVERY_TOLERANCE_DAYS) {
      differences.push({
        field: "deliveryDate",
        label: "Delivery date",
        severity: "TIMING",
        confirmed: confirmed.deliveryDate.toDateString(),
        proposed: proposed.deliveryDate.toDateString(),
        consequence: `${Math.round(deltaDays)} days later than the offer stated.`,
      });
    }
  }

  // 7. Loss of a required year, trim, condition, drivetrain or feature. LOSS, not change: a
  //    trim the buyer did not require changing is not a material change, and §10a says "the
  //    loss of a REQUIRED ..." for exactly that reason.
  for (const [field, label, before, after] of [
    ["vehicleYear", "Model year", confirmed.vehicleYear, proposed.vehicleYear],
    ["vehicleTrim", "Trim", confirmed.vehicleTrim, proposed.vehicleTrim],
    ["vehicleCondition", "Condition", confirmed.vehicleCondition, proposed.vehicleCondition],
    ["drivetrain", "Drivetrain", confirmed.drivetrain, proposed.drivetrain],
  ] as const) {
    if (before != null && after != null && String(before) !== String(after)) {
      differences.push({
        field,
        label,
        severity: "SPECIFICATION",
        confirmed: String(before),
        proposed: String(after),
        consequence: `The ${label.toLowerCase()} you chose is not what is now being offered.`,
      });
    }
  }
  const stillMatched = new Set(proposed.requiredFeatures.map(normaliseLabel));
  for (const feature of confirmed.requiredFeatures) {
    if (!stillMatched.has(normaliseLabel(feature))) {
      differences.push({
        field: `feature:${normaliseLabel(feature)}`,
        label: `Missing: ${feature}`,
        severity: "SPECIFICATION",
        confirmed: "included",
        proposed: "not included",
        consequence: "A feature you told us you needed is not on this vehicle.",
      });
    }
  }

  if (differences.length === 0) return { outcome: "NONE", differences: [] };

  // REFUSE FIRST. §10a: above the approved ceiling "cannot be accepted at all", so it is never
  // offered as a choice — not even alongside a saving.
  if (ceilingCents != null && proposed.otdCents != null && proposed.otdCents > ceilingCents) {
    return {
      outcome: "REFUSE",
      differences,
      ceilingCents,
      proposedOtdCents: proposed.otdCents,
    };
  }

  // AUTO_APPLY only when the OTD fell and it is the ONLY difference.
  const onlyOtd = differences.length === 1 && differences[0]!.field === "otdCents";
  if (onlyOtd && proposed.otdCents != null && confirmed.otdCents != null && proposed.otdCents < confirmed.otdCents) {
    return {
      outcome: "AUTO_APPLY",
      differences,
      newOtdCents: proposed.otdCents,
      savingCents: confirmed.otdCents - proposed.otdCents,
    };
  }

  return { outcome: "DECIDE", differences };
}
