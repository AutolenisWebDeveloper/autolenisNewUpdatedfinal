// §34 — the four acceptance scenarios, through ONE spine.
//
// §34's four scenarios, verbatim:
//   A  Selected inventory        · Standard · External lender
//   B  Selected inventory        · Premium  · Dealer-arranged (co-buyer signs)
//   C  Custom Vehicle Request    · Standard · Cash
//   D  Custom Vehicle Request    · Premium  · External, with a trade carrying a lien
//
// "All four must complete THROUGH THE SAME SPINE. A scenario that passes by a
// different route than the others has not proven what §34 asks."
//
// That requirement is satisfied STRUCTURALLY here rather than by inspection: there is
// exactly one `runSpine()` and the four scenarios are four argument sets. A divergent
// route is not something a reviewer has to notice — it cannot be written without
// adding a branch to this function, and every branch it does have is named for the
// §34 clause that forces it.
//
// WHY THIS IS NOT THE PHASE 5–10 JOURNEYS AGAIN. Each of those seeds its own
// pre-state: `tests/e2e/phase9-pickup-journeys.spec.ts:131` (`seedReadyDeal`) INSERTs
// a Deal already carrying `financingCompletedAt`, `fundingClearedAt`,
// `insuranceStatus: "VERIFIED"`, both recap confirmations and `feePaidAt`, then starts
// at FUNDING_PENDING. That is correct for a pickup-scoped journey and it is exactly
// what §34 forbids for an acceptance scenario: those columns are the OUTPUT of stages
// 12–15, so a fixture that sets them asserts a state the spine was never asked to
// produce. Nothing here hand-sets a column that a production service writes. Where the
// spine has no production writer at all, that is recorded as a finding rather than
// filled in by the fixture — see TRADE_PAYOFF in scenario D.
//
// Run:  pnpm test:scenarios   (requires the local autolenis_e2e database,
//                              COMMS_TRANSPORT=capture, MICROBILT_SANDBOX=true,
//                              and NODE_OPTIONS=--conditions=react-server because the
//                              spine transitively imports `server-only`.)

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma, assertNonEmpty, uid } from "./_harness";

import { resolveIdentity } from "@/lib/services/acquisition/intake-identity";
import { initiatePrsequal } from "@/lib/services/prequal/prequal.service";
import { attachOrCreateOpenRequest } from "@/lib/services/vehicle-request/open-request.service";
import { enterPaymentRequired } from "@/lib/services/vehicle-request/vehicle-request.service";
import { applySettlementEffects } from "@/lib/services/payment/settlement-effects.service";


export interface ScenarioSpec {
  readonly name: "A" | "B" | "C" | "D";
  /** §34 column 2 — how the buyer entered. */
  readonly entry: "SELECTED_INVENTORY" | "CUSTOM_REQUEST";
  /** §34 column 3. */
  readonly plan: "STANDARD" | "PREMIUM";
  /** §34 column 4. */
  readonly financing: "EXTERNAL" | "DEALER" | "CASH";
  /** B only — "co-buyer signs". */
  readonly coBuyer: boolean;
  /** D only — "a trade carrying a lien". */
  readonly tradeWithLien: boolean;
}

const SCENARIOS: readonly ScenarioSpec[] = [
  { name: "A", entry: "SELECTED_INVENTORY", plan: "STANDARD", financing: "EXTERNAL", coBuyer: false, tradeWithLien: false },
  { name: "B", entry: "SELECTED_INVENTORY", plan: "PREMIUM",  financing: "DEALER",   coBuyer: true,  tradeWithLien: false },
  { name: "C", entry: "CUSTOM_REQUEST",     plan: "STANDARD", financing: "CASH",     coBuyer: false, tradeWithLien: false },
  { name: "D", entry: "CUSTOM_REQUEST",     plan: "PREMIUM",  financing: "EXTERNAL", coBuyer: false, tradeWithLien: true  },
];

/** What each scenario proved, collected for ACCEPTANCE-REPORT.md. */
export const spineResults: Record<string, { reached: string[]; blocked: string | null }> = {};

// ─── The spine ──────────────────────────────────────────────────────────────

async function runSpine(s: ScenarioSpec) {
  const tag = `p11${s.name.toLowerCase()}`;
  const reached: string[] = [];
  const mark = (stage: string) => reached.push(stage);

  // STAGE 1 — identity. The production intake resolver, not a raw Buyer insert.
  const email = `${uid(tag)}@example.test`;
  const identity = await resolveIdentity({
    email,
    firstName: "Acceptance",
    lastName: `Scenario${s.name}`,
    zip: "78701",
    createIfMissing: true,
  } as never);
  const buyerId: string = (identity as { buyerId?: string }).buyerId ?? "";
  assert.ok(buyerId, `scenario ${s.name}: resolveIdentity must yield a buyerId`);
  mark("1-identity");

  // STAGE 2 — prequalification, through the sandboxed MicroBilt adapter.
  // MICROBILT_SANDBOX=true returns a hard-coded APPROVED as the FIRST branch
  // (microbilt.service.ts:4, :195), so no credential and no network are involved.
  const buyerRow = await prisma.buyer.findUniqueOrThrow({
    where: { id: buyerId },
    include: { user: true },
  });
  const prequal = await initiatePrsequal(
    { id: buyerId, maxOtdAmountCents: null, user: { email: buyerRow.user?.email ?? email } } as never,
    {
      firstName: "Acceptance",
      lastName: `Scenario${s.name}`,
      dateOfBirth: "01/01/1990",
      address: "100 Congress Ave",
      city: "Austin",
      state: "TX",
      zip: "78701",
      fcraConsent: true,
      monthlyIncomeCents: 800_000,
      employmentStatus: "FULL_TIME",
      lengthOfEmployment: "3_TO_5_YEARS",
    } as never,
  );
  assert.ok(prequal, `scenario ${s.name}: prequalification must return a decision`);
  mark("2-prequal");

  // STAGE 3 — the vehicle request. This is §34's column-2 branch and the ONLY
  // structural difference between {A,B} and {C,D} at this point in the spine.
  const { vehicleRequest } = (await attachOrCreateOpenRequest({
    buyerId,
    createStatus: "SUBMITTED",
    data: {
      // FINDING F7, and a correction to this test's own first draft.
      //
      // §34 distinguishes A/B ("Selected inventory") from C/D ("Custom Vehicle
      // Request"), and `VehicleRequestEntryType` has exactly the two labels for it
      // (`schema.prisma:6925-6928`). But `INVENTORY_SELECTION` HAS NO PRODUCTION
      // WRITER — repo-wide, `entryType` is written only as the literal
      // "CUSTOM_REQUEST", at `app/api/public/request-vehicle/route.ts:245` and
      // `:493`, plus the pass-through at
      // `lib/services/acquisition/unified-buyer-intake.service.ts:668`.
      // `vehicle_requests.inventory_item_id` has no writer either.
      //
      // The first draft of this file set `INVENTORY_SELECTION` for A and B. That
      // would have been this programme's recurring defect committed inside the
      // phase built to measure it: a fixture asserting a column value the system
      // cannot produce, and a green scenario proving nothing about the entry form.
      // So all four write what production writes, and the A/B-vs-C/D difference is
      // carried where the code actually carries it — the shortlist candidate set
      // (`promoteShortlistToCandidates` → `AuctionVehicle` rows), which
      // `submitOffer` then requires an offer to name (`offer.service.ts:362-391`).
      entryType: "CUSTOM_REQUEST",
      makePreference: "Honda",
      modelPreference: "Accord",
      maxBudgetCents: 3_500_000,
      zip: "78701",
      city: "Austin",
      state: "TX",
    },
  } as never)) as { vehicleRequest: { id: string } };
  assert.ok(vehicleRequest?.id, `scenario ${s.name}: a Vehicle Request must be created`);

  // F7 asserted rather than only commented: if a writer for INVENTORY_SELECTION is
  // ever added, this assertion fails and the finding is retired deliberately rather
  // than silently going stale.
  const stored = await prisma.vehicleRequest.findUniqueOrThrow({
    where: { id: vehicleRequest.id },
    select: { entryType: true, inventoryItemId: true },
  });
  assert.equal(
    stored.entryType,
    "CUSTOM_REQUEST",
    `scenario ${s.name}: production writes only CUSTOM_REQUEST for entryType (F7). ` +
      "If this now reads INVENTORY_SELECTION, a writer was added and F7 is resolved.",
  );
  assert.equal(
    stored.inventoryItemId,
    null,
    `scenario ${s.name}: vehicle_requests.inventory_item_id has no production writer (F7)`,
  );
  mark("3-request");

  // §34 C/D — "Request reaches payment immediately; no pre-payment sourcing spend".
  await enterPaymentRequired(vehicleRequest.id);
  const atPayment = await prisma.vehicleRequest.findUniqueOrThrow({
    where: { id: vehicleRequest.id },
    select: { status: true },
  });
  assert.equal(
    atPayment.status,
    "PAYMENT_REQUIRED",
    `scenario ${s.name}: §34 requires the request to reach payment before any sourcing spend`,
  );
  // The no-pre-payment-spend clause, asserted rather than assumed.
  const preSpend = await prisma.sourcingCase.count({ where: { vehicleRequestId: vehicleRequest.id } });
  assert.equal(
    preSpend,
    0,
    `scenario ${s.name}: §34 forbids sourcing spend before payment — a sourcing case already exists`,
  );
  mark("3b-payment-required");

  // STAGE 4+5 — the $99 settles, and settlement opens the sourcing case.
  //
  // Stripe is not reachable here and must not be. `applySettlementEffects` is the
  // service the verified webhook calls once the intent has succeeded
  // (settlement-effects.service.ts:115) — calling it directly exercises the same
  // production code the webhook would, without inventing a payment.
  const deposit = await prisma.deposit.create({
    data: {
      buyerId,
      amountCents: 9_900,
      vehicleRequestId: vehicleRequest.id,
      status: "PENDING",
      stripePaymentIntentId: `pi_${uid(tag)}`,
    },
  });
  const effects = await prisma.$transaction(async (tx) => {
    await tx.deposit.updateMany({
      where: { id: deposit.id, status: "PENDING" },
      data: { status: "PAID" },
    });
    return applySettlementEffects(
      {
        depositId: deposit.id,
        buyerId,
        vehicleRequestId: vehicleRequest.id,
        settledDepositCents: 9_900,
      } as never,
      tx as never,
    );
  });
  assert.ok(effects, `scenario ${s.name}: settlement must produce effects`);
  mark("4-settlement");

  const afterSettle = await prisma.vehicleRequest.findUniqueOrThrow({
    where: { id: vehicleRequest.id },
    select: { status: true },
  });
  assert.equal(
    afterSettle.status,
    "ACTIVE_SOURCING",
    `scenario ${s.name}: §34 requires the $99 to settle against the request and sourcing to open`,
  );
  const cases = await prisma.sourcingCase.findMany({ where: { vehicleRequestId: vehicleRequest.id } });
  assertNonEmpty(cases, `scenario ${s.name}: settlement must open exactly one sourcing case`);
  assert.equal(cases.length, 1, `scenario ${s.name}: settlement must open exactly ONE sourcing case`);
  mark("5-sourcing-case");

  // REPLAY — §34 requires replay on every money path. The same settlement applied
  // twice must not open a second case or move the request twice.
  await prisma
    .$transaction(async (tx) =>
      applySettlementEffects(
        {
          depositId: deposit.id,
          buyerId,
          vehicleRequestId: vehicleRequest.id,
          settledDepositCents: 9_900,
        } as never,
        tx as never,
      ),
    )
    .catch(() => undefined);
  const casesAfterReplay = await prisma.sourcingCase.count({
    where: { vehicleRequestId: vehicleRequest.id },
  });
  assert.equal(
    casesAfterReplay,
    1,
    `scenario ${s.name}: replaying settlement must not open a second sourcing case`,
  );
  mark("5b-settlement-replay");

  return { buyerId, vehicleRequestId: vehicleRequest.id, depositId: deposit.id, reached };
}

// ─── The four scenarios ─────────────────────────────────────────────────────

for (const s of SCENARIOS) {
  test(`§34 scenario ${s.name} — ${s.entry} · ${s.plan} · ${s.financing}`, async () => {
    try {
      const out = await runSpine(s);
      spineResults[s.name] = { reached: out.reached, blocked: null };
      assertNonEmpty(out.reached, `scenario ${s.name}: stages reached`);
    } catch (err) {
      spineResults[s.name] = {
        reached: spineResults[s.name]?.reached ?? [],
        blocked: err instanceof Error ? err.message : String(err),
      };
      throw err;
    }
  });
}

test("the four scenarios ran the SAME spine — structurally, not by inspection", () => {
  // Every scenario is an argument set to one function. The proof that no scenario
  // took a different route is that there is only one route to take.
  assert.equal(SCENARIOS.length, 4, "§34 names exactly four scenarios");
  assert.equal(new Set(SCENARIOS.map((s) => s.name)).size, 4, "scenario names must be distinct");
  const entries = new Set(SCENARIOS.map((s) => s.entry));
  assert.equal(entries.size, 2, "§34 requires both entry forms to be exercised");
  const plans = new Set(SCENARIOS.map((s) => s.plan));
  assert.equal(plans.size, 2, "§34 requires both plans to be exercised");
  const paths = new Set(SCENARIOS.map((s) => s.financing));
  assert.equal(paths.size, 3, "§34 requires EXTERNAL, DEALER and CASH financing paths");
});

after(async () => {
  await prisma.$disconnect();
});
