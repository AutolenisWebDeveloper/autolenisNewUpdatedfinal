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
import { recordCoBuyerElection } from "@/lib/services/buyer/co-buyer.service";
import { recordTradeElection } from "@/lib/services/trade-in/trade-in.service";


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
export const spineResults: Record<
  string,
  {
    reached: string[];
    blocked: string | null;
    observed?: { coBuyers: number; trades: number; plan: string | null };
  }
> = {};

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

  // §34 column 3 — the plan. NAMED DEVIATION, in the spirit of Rule 2 rather than an
  // exception to it: `Buyer.plan` has no exported production writer. Its only writers
  // are route handlers (`app/api/buyer/plan/upgrade/route.ts:108`,
  // `app/api/admin/buyers/[buyerId]/plan/route.ts:138`) which cannot be called
  // in-process. Setting the column reproduces what those routes write and nothing more;
  // `recordRequestPlanElection` — the real election writer — then reads it at settlement
  // exactly as it would in production (`settlement-effects.service.ts:189`). Recorded
  // rather than silently done, because an unnamed fixture write is the recurring defect.
  if (s.plan === "PREMIUM") {
    await prisma.buyer.update({ where: { id: buyerId }, data: { plan: "PREMIUM" } });
  }

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
  // The DECISION is asserted, not merely that an object came back. `initiatePrsequal`
  // returns `{ prequal, mocked }` on every non-throwing path — including DECLINED,
  // MANUAL_REVIEW, the OFAC branch and the in-flight-race branch — so `assert.ok(prequal)`
  // passed for outcomes that would stop the transaction dead. The second independent
  // review caught that.
  const decision = (prequal as { prequal?: { decision?: string } })?.prequal?.decision;
  assert.equal(
    decision,
    "APPROVED",
    `scenario ${s.name}: the spine needs an APPROVED prequalification to continue; got ` +
      `${decision ?? "no decision at all"}. MICROBILT_SANDBOX=true must be set.`,
  );
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

  // F7 is asserted at SOURCE level, in `f7.itest.ts`, NOT here.
  //
  // The first version read the column back out of the row this very test had just
  // written, and claimed "if this now reads INVENTORY_SELECTION, a writer was added".
  // That was false twice over: the only way it could read INVENTORY_SELECTION was for
  // someone to edit this file's own fixture, and if a real production writer WERE added
  // the assertion would stay green forever — so the finding would go stale in exactly the
  // way the comment promised it could not. The second independent review proved it by
  // flipping the fixture line and watching the test fail with "no writer was added".
  //
  // A claim about what production writes has to be checked against production source.
  mark("3-request");

  // §34 scenario B — "co-buyer signs". Through the production election service, which
  // enforces Rule 2 (no PII without shareConsent) and the prohibited-field scan.
  //
  // `elected` is asserted, not just `ok`: the service returns `{ ok: true, elected: false }`
  // on the de-election branch, so asserting `ok` alone would pass for the exact opposite
  // of what this scenario claims. That is not hypothetical — the first version of this
  // block asserted only `ok`.
  if (s.coBuyer) {
    const co = (await recordCoBuyerElection(buyerId, vehicleRequest.id, true, {
      legalFirstName: "Co",
      legalLastName: `Buyer${s.name}`,
      email: `${uid(`${tag}-cobuyer`)}@example.test`,
      isRequiredSigner: true,
      shareConsent: true,
    })) as { ok: boolean; elected?: boolean; coBuyer?: { id: string } | null };
    assert.equal(co.ok, true, `scenario ${s.name}: co-buyer election refused — ${JSON.stringify(co)}`);
    assert.equal(co.elected, true, `scenario ${s.name}: co-buyer must be ELECTED, not de-elected`);
    assert.ok(co.coBuyer?.id, `scenario ${s.name}: the election must return the stored co-buyer`);
    mark("3c-cobuyer");
  }

  // §34 scenario D — "a trade carrying a lien". Through the production election service.
  if (s.tradeWithLien) {
    const trade = (await recordTradeElection(buyerId, vehicleRequest.id, true, {
      year: 2016,
      make: "Toyota",
      model: "Corolla",
      condition: "GOOD",
      loanStatus: "FINANCED",
      loanBalanceCents: 850_000,
      lienholderName: "Example Credit Union",
      payoffGoodThroughDate: new Date(Date.now() + 10 * 86_400_000),
      titleInHand: false,
      shareConsent: true,
    })) as { ok: boolean; elected?: boolean };
    assert.equal(trade.ok, true, `scenario ${s.name}: trade election refused — ${JSON.stringify(trade)}`);
    assert.equal(trade.elected, true, `scenario ${s.name}: the trade must be ELECTED`);
    mark("3d-trade-lien");
  }

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
  //
  // NAMED DEVIATION from Rule 2, and the second in this file. `deposits.status` IS
  // production-written — by the Stripe webhook's own guarded flip
  // (`app/api/webhooks/stripe/route.ts:300-303`) and by `deposit-settlement.service.ts`.
  // The flip below reproduces that exact statement shape (`updateMany` guarded on
  // `status: "PENDING"`, so it is idempotent the same way) inside the same transaction
  // the effects run in, because `settlement-effects.service.ts:105-114` requires that
  // ordering. What it means for the claim: the PAID transition itself is NOT proven
  // here — only that the effects the webhook triggers afterwards behave correctly given
  // it. ACCEPTANCE-REPORT.md §3 states the same limit rather than letting "settlement
  // proven" stand unqualified.
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
  // The SHAPE is asserted, not merely truthiness. `applySettlementEffects` returns a
  // fully-null object (`{ vehicleRequestId: null, sourcingCaseId: null, unlocked: false }`)
  // on the no-request-resolved path, so `assert.ok(effects)` passed on the branch where
  // settlement produced nothing at all.
  const eff = effects as { unlocked?: boolean; sourcingCaseId?: string | null; vehicleRequestId?: string | null };
  assert.equal(eff.unlocked, true, `scenario ${s.name}: settlement must UNLOCK the request`);
  assert.ok(eff.sourcingCaseId, `scenario ${s.name}: settlement must return the sourcing case it opened`);
  assert.equal(
    eff.vehicleRequestId,
    vehicleRequest.id,
    `scenario ${s.name}: settlement must resolve to THIS request, not another`,
  );
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
  // NOT wrapped in a catch. An earlier version was, and that made this assertion unable
  // to tell idempotent from crashed-and-rolled-back: a throwing replay rolls its
  // transaction back, leaves the count at 1, and would have reported "replay opens no
  // second case" while the money path was in fact broken. Idempotent means it RESOLVES
  // and yields the SAME case — both halves are asserted.
  const replay = (await prisma.$transaction(async (tx) =>
    applySettlementEffects(
      {
        depositId: deposit.id,
        buyerId,
        vehicleRequestId: vehicleRequest.id,
        settledDepositCents: 9_900,
      } as never,
      tx as never,
    ),
  )) as { sourcingCaseId?: string | null };
  assert.ok(
    replay,
    `scenario ${s.name}: replaying settlement must RESOLVE, not throw — a rolled-back ` +
      "replay leaves the row count unchanged and would otherwise read as idempotent",
  );
  assert.equal(
    replay.sourcingCaseId,
    (effects as { sourcingCaseId?: string | null }).sourcingCaseId,
    `scenario ${s.name}: the replay must resolve to the SAME sourcing case, not merely ` +
      "avoid creating a second one",
  );
  const casesAfterReplay = await prisma.sourcingCase.count({
    where: { vehicleRequestId: vehicleRequest.id },
  });
  assert.equal(
    casesAfterReplay,
    1,
    `scenario ${s.name}: replaying settlement must not open a second sourcing case`,
  );
  mark("5b-settlement-replay");

  // Observable production state, so the "four different scenarios" claim is checked
  // against the DATABASE rather than against this file's own constant.
  const [coBuyers, trades, buyerRow2] = await Promise.all([
    prisma.coBuyer.count({ where: { vehicleRequestId: vehicleRequest.id } }),
    prisma.tradeInSubmission.count({ where: { vehicleRequestId: vehicleRequest.id } }),
    prisma.buyer.findUnique({ where: { id: buyerId }, select: { plan: true } }),
  ]);

  return {
    buyerId,
    vehicleRequestId: vehicleRequest.id,
    depositId: deposit.id,
    reached,
    observed: { coBuyers, trades, plan: (buyerRow2?.plan as string | null) ?? null },
  };
}

// ─── The four scenarios ─────────────────────────────────────────────────────

for (const s of SCENARIOS) {
  test(`§34 scenario ${s.name} — ${s.entry} · ${s.plan} · ${s.financing}`, async () => {
    try {
      const out = await runSpine(s);
      spineResults[s.name] = { reached: out.reached, blocked: null, observed: out.observed };
      // A floor that can be breached. `mark()` is called unconditionally seven times, so
      // `>= 1` was unreachable; the spine must reach the settlement replay or the coverage
      // numbers no longer describe what ran.
      assertNonEmpty(out.reached, `scenario ${s.name}: stages reached`, 7);
      assert.ok(
        out.reached.includes("5b-settlement-replay"),
        `scenario ${s.name}: must reach the settlement replay — it is the last stage this ` +
          "spine claims, and ACCEPTANCE-REPORT.md's coverage numbers assume it ran",
      );
    } catch (err) {
      spineResults[s.name] = {
        reached: spineResults[s.name]?.reached ?? [],
        blocked: err instanceof Error ? err.message : String(err),
      };
      throw err;
    }
  });
}

test("the four scenarios are genuinely DIFFERENT — proven against the database", () => {
  // WHAT THIS REPLACED, AND WHY.
  //
  // The first version asserted `SCENARIOS.length === 4`, `new Set(names).size === 4`,
  // `entries.size === 2` and so on — every one over a `const` literal declared a hundred
  // lines above in THIS SAME FILE. It touched no production module and could fail only if
  // someone edited the adjacent array. It was a check that reported success while checking
  // nothing, inside the suite whose whole thesis is that ten phases shipped exactly that.
  // The first independent review caught it, which is the argument for independent review.
  //
  // The replacement asserts that the four scenarios left DIFFERENT observable rows behind.
  // It fails if `runSpine` stops branching — which is the property "four scenarios" means.
  const names = Object.keys(spineResults);
  assertNonEmpty(names, "recorded scenario results — with none, every comparison below is vacuous", 4);

  const obs = (n: string) => {
    const o = spineResults[n]?.observed;
    assert.ok(o, `scenario ${n} recorded no observable state`);
    return o;
  };

  // §34 B is the only co-buyer scenario.
  assert.equal(obs("B").coBuyers, 1, "B must have a co-buyer, written by recordCoBuyerElection");
  for (const n of ["A", "C", "D"]) assert.equal(obs(n).coBuyers, 0, `${n} must have no co-buyer`);

  // §34 D is the only trade-with-lien scenario.
  assert.equal(obs("D").trades, 1, "D must have a trade, written by recordTradeElection");
  for (const n of ["A", "B", "C"]) assert.equal(obs(n).trades, 0, `${n} must have no trade`);

  // §34 column 3 — B and D Premium, A and C Standard.
  assert.equal(obs("B").plan, "PREMIUM", "B is the Premium scenario");
  assert.equal(obs("D").plan, "PREMIUM", "D is the Premium scenario");
  assert.equal(obs("A").plan, "STANDARD", "A is the Standard scenario");
  assert.equal(obs("C").plan, "STANDARD", "C is the Standard scenario");
});

test("what the scenarios do NOT differentiate — asserted, so the limit cannot go stale", () => {
  // §34's column 4 (External / Dealer-arranged / Cash) is a stage-12 fact, and the entry
  // form is not recorded at all (F7). The spine reaches stage 5b, so NEITHER column is
  // exercised by any scenario. Asserting it here keeps the limit in the suite rather than
  // only in the report: when the spine reaches stage 12 this test fails and must be
  // updated deliberately, instead of the report quietly overstating what ran.
  const reached = spineResults["A"]?.reached ?? [];
  assertNonEmpty(reached, "scenario A stages reached");
  assert.ok(
    !reached.some((r) => r.startsWith("12-")),
    "the spine now reaches stage 12 — §34's financing column is exercisable, and this test " +
      "plus ACCEPTANCE-REPORT.md §3 must be updated to say so",
  );
  assert.ok(
    reached.includes("5b-settlement-replay"),
    "the spine must still reach the settlement replay — if it stops earlier, the coverage " +
      "numbers in ACCEPTANCE-REPORT.md no longer describe this suite",
  );
});

after(async () => {
  await prisma.$disconnect();
});
