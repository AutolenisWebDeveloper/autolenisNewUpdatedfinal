// §25.1 / §13-D22 — a BUILD-FAILING guard that no dealer surface reads buyer identity without
// passing through the firewall predicate.
//
// Run with:  npx tsx --test lib/services/deal/__tests__/identity-firewall-dealer-surfaces.test.ts
//
// WHY A SCANNER AND NOT A BEHAVIOUR TEST. §13-D22 asks whether "the identity-firewall lift covers
// EVERY dealer surface". That is a question about a set of files, not about one code path, and the
// answer has to stay true as files are added. A behaviour test proves the surfaces that exist
// today are gated; this proves the next one will be too, because the build fails if it is not.
//
// The enumeration at the start of Phase 7 found SIX surfaces releasing buyer identity, the
// ceiling, or the trade packet, and §8.4 named only three of them. That gap is exactly what a
// hand-maintained list produces, and it is why this is derived from the tree instead.
//
// WHAT COUNTS AS "READING BUYER IDENTITY": a Prisma selection of the buyer relation, or of the
// co-buyer, or of the trade packet, inside a file under a dealer-facing root. A file that does
// that must ALSO reference the firewall predicate. The pairing is deliberately crude — it catches
// the file, and a human reads why — because a scanner that tried to prove the gate actually guards
// the right branch would be an interpreter, and an interpreter is a thing that can be wrong
// quietly.
//
// THE ALLOWLIST IS NAMED, SMALL AND JUSTIFIED. Each entry says why it is exempt; a stale entry
// fails, exactly as the `credit_applications` freeze guard does, so the list cannot rot into a
// permanent exemption.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceFiles, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();

/** Every tree a dealership can reach. */
const DEALER_ROOTS = ["app/api/dealer", "app/dealer", "lib/services/dealer"] as const;

/** A Prisma read of something §25.1 protects. */
const IDENTITY_READ = /\b(buyer|coBuyer|tradeInSubmissions)\s*:\s*\{/;

/** Evidence the file consulted the firewall. */
const FIREWALL = /dealerIdentityVisible|secureHandoffPacket|identityWithheldReason/;

/**
 * Exempt, with the reason. NOT a convenience list — each of these reads a protected relation for
 * something other than showing it to a dealership.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: "app/api/dealer/offers/route.ts",
    why: "reads buyer firstName/email ONLY to address a lifecycle email to the BUYER (`scheduleLifecycleWorkload`); nothing from that read reaches the dealer response, which is projected through DEALER_OFFER_SELECT",
  },
  {
    file: "app/api/dealer/messages/route.ts",
    why: "reads the buyer's USER ID to add them as a thread participant; the response carries the message, not the buyer, and the route's own copy tells the dealership identity is released at reaffirmation",
  },
  {
    file: "app/api/dealer/pickup/scan/route.ts",
    why: "Stage 18 handover — after the lift by construction, and the release is the point of the scan",
  },
  {
    file: "app/dealer/opportunities/page.tsx",
    why: "reads the buyer relation ONLY to reach `vehicleRequests` — the vehicle criteria §25.1 explicitly gives invited dealerships (\"complete vehicle criteria, general location, distance, and trade indication\"). It renders `vehicle_requests.max_budget_cents`, the buyer's own STATED budget, which is not the prequalification ceiling and is not coarsened by `bucketBudgetCents`; the owner ruled at STOP 1 that this stays, because a dealership needs some sense of range to bid. No name, email, phone or address is read",
  },
  {
    file: "lib/services/dealer/dealer-deals.service.ts",
    why: "this file IS the gate — it calls dealerIdentityVisible and returns buyer: null when closed; matched by FIREWALL and listed here only so its dual role is explicit",
  },
];

function dealerFiles(): string[] {
  const files = sourceFiles(ROOT, [...DEALER_ROOTS]);
  // NON-VACUITY FLOOR. A scanner that finds nothing passes, and a passing guard that enforces
  // nothing reads as evidence. The dealer trees held well over 80 files when this was written.
  assertScanned(files, 60, "identity-firewall-dealer-surfaces");
  return files;
}

test("§13-D22 — every dealer surface that reads buyer identity consults the firewall", () => {
  const allowed = new Set(ALLOWLIST.map((a) => a.file));
  const offenders: string[] = [];

  for (const file of dealerFiles()) {
    const src = readFileSync(`${ROOT}/${file}`, "utf8");
    if (!IDENTITY_READ.test(src)) continue;
    if (FIREWALL.test(src)) continue;
    if (allowed.has(file)) continue;
    offenders.push(file);
  }

  assert.deepEqual(
    offenders,
    [],
    "§25.1: buyer name, email, phone and exact address are released only at Stage 10, when that " +
      "dealership has won AND REAFFIRMED. These dealer-facing files read a protected relation " +
      "without consulting `dealerIdentityVisible`. Gate it, or add an allowlist entry saying why " +
      `the read never reaches a dealership. Offenders: ${offenders.join(", ")}`,
  );
});

test("every allowlist entry still reads a protected relation — a stale entry fails", () => {
  const stale: string[] = [];
  for (const entry of ALLOWLIST) {
    let src: string;
    try {
      src = readFileSync(`${ROOT}/${entry.file}`, "utf8");
    } catch {
      stale.push(`${entry.file} (missing)`);
      continue;
    }
    if (!IDENTITY_READ.test(src)) stale.push(`${entry.file} (no longer reads one)`);
  }
  assert.deepEqual(
    stale,
    [],
    `A stale exemption silently widens the rule. Remove it. Stale: ${stale.join(", ")}`,
  );
});

test("every allowlist entry says why, in more than a word", () => {
  for (const entry of ALLOWLIST) {
    assert.ok(
      entry.why.length > 40,
      `${entry.file}: an exemption from §25.1 needs a reason a reviewer can check, not a label`,
    );
  }
});

test("the ceiling never reaches a dealer surface as an exact figure", () => {
  // `lib/utils/buyer-budget.ts` states the platform's own rule: "never expose maxOtdAmountCents to
  // dealers directly", which is why every dealer surface coarsens it through `bucketBudgetCents`.
  //
  // Phase 6 started writing `offers.disqualified_reason`, whose text embeds that exact figure, and
  // `GET /api/dealer/offers/[offerId]` returned the whole row — so the value the codebase says must
  // never reach a dealership reached one, on their own offer id. This is the guard against the next
  // unprojected read.
  const offenders: string[] = [];
  for (const file of dealerFiles()) {
    const src = readFileSync(`${ROOT}/${file}`, "utf8");
    if (/maxOtdAmountCents/.test(src) && !/bucketBudgetCents/.test(src)) {
      offenders.push(`${file} (maxOtdAmountCents without bucketBudgetCents)`);
    }
    if (/disqualifiedReason/.test(src)) {
      offenders.push(`${file} (disqualifiedReason carries the buyer's approved amount as a dollar figure)`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `The buyer's approved ceiling must reach a dealership only as a 5k band. Offenders: ${offenders.join(", ")}`,
  );
});

test("no dealer-facing Prisma read of Offer is unprojected", () => {
  // The narrower form of the rule above. `include: { auction: true }` on an Offer returns
  // `disqualified_reason`, the rank columns AND `auction.buyerId`. Projection is the fix, and
  // `DEALER_OFFER_SELECT` is where the dealer-safe field list lives.
  const offenders: string[] = [];
  for (const file of dealerFiles()) {
    const src = readFileSync(`${ROOT}/${file}`, "utf8");
    if (!/prisma\.offer\.find/.test(src)) continue;
    // A read that neither projects through the shared select nor names its own fields.
    if (!/DEALER_OFFER_SELECT/.test(src) && !/select\s*:\s*\{/.test(src)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "A dealer-facing `prisma.offer.find*` must project — through DEALER_OFFER_SELECT or an explicit " +
      `select. Offenders: ${offenders.join(", ")}`,
  );
});
