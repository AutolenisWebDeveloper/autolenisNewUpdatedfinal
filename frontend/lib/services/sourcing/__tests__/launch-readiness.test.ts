// §Stage 7 — launch readiness, and the ordering that keeps an auction from launching half-ready.
//
// Two things are under test and they are different claims:
//
//   `evaluateReadiness` — the eight entry items §7 lists, each with the EXACT missing
//     prerequisite and an owner. It is pure with respect to the auction: a surface can render
//     the checklist without creating or sending anything, which is why the buyer-facing and
//     admin-facing screens can both call it.
//
//   `launchFromCase` — the sequence S7-07 requires: create the auction PENDING, write the
//     invitations QUEUED against it, and flip to ACTIVE with `endsAt` in ONE transaction and
//     only when at least one invitation row can be READ BACK. "The auction never launches
//     half-ready" is that last clause, and the most valuable test in this file is the one that
//     proves a zero-invitation launch stays PENDING — because the alternative is a buyer who
//     paid $99 watching a live auction nobody was invited to.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/sourcing/__tests__/launch-readiness.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  /** The settled-deposit predicate's answer (S7-01b). */
  deposit: { id: string } | null;
  /** What `recheckApproval` reports (S7-02). */
  approval: { ok: boolean; reason?: string; approvedAmountCents: number | null };
  request: Record<string, unknown> | null;
  candidates: Array<Record<string, unknown>>;
  checkpoints: Array<{ name: string; completed: boolean; order: number }>;
  suppressed: Set<string>;
  /** Throw from the suppression lookup, to prove readiness fails closed. */
  suppressionThrows: boolean;
  auctions: Array<{ id: string; depositId: string; status: string }>;
  auctionCreates: Array<Record<string, unknown>>;
  auctionUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  /** Invitations `issueInvitations` reports, and the count readable inside the txn. */
  issuedCount: number;
  liveInvitationCount: number;
  transitions: Array<Record<string, unknown>>;
  exceptions: Array<Record<string, unknown>>;
  /** The order the launch did things in, so the S7-07 sequence is asserted, not assumed. */
  sequence: string[];
  /** The status the real `transitionCase` will read back — its compare-and-set runs for real. */
  caseStatusInDb: string;
  /** True when `launchFromCase` asked for the notices to be deferred past the ACTIVE flip. */
  deferRequested: boolean;
  /** `skipped` entries `issueInvitations` returns — WRITE_FAILED must hold the launch. */
  issueSkipped: Array<{ rooftopId: string; reason: string }>;
  /** Invitation ids whose notice could not be queued. */
  dispatchFailures: string[];
  dispatched: number;
}
let ctrl: Ctrl;

const CASE = {
  id: "case_1",
  vehicleRequestId: "vr_1",
  status: "READY_TO_LAUNCH",
  band: "100",
  coverageCount: 6,
  authorizedRadiusMiles: null as number | null,
  limitedAuctionApprovedAt: null as Date | null,
  openedAt: new Date("2026-09-01T00:00:00Z"),
  lastExpandedAt: null,
  invitationsSentAt: null,
};

function readyCandidate(i: number, distance = 10) {
  return {
    rooftopId: `rt_${i}`,
    distanceMiles: distance,
    servedCandidateIds: ["inv_1"],
    validation: { invitationReady: true, contactEmail: `s${i}@ex.com`, contactName: "Sales" },
    excludedReason: null,
    rooftop: { displayName: `Rooftop ${i}`, dealers: [] },
  };
}

beforeEach(() => {
  ctrl = {
    deposit: { id: "dep_1" },
    approval: { ok: true, approvedAmountCents: 4_000_000 },
    request: { buyerId: "buyer_1", makePreference: "Toyota", modelPreference: "Camry", yearMin: 2020, yearMax: 2024 },
    candidates: [1, 2, 3, 4, 5, 6].map((i) => readyCandidate(i, 10 + i)),
    checkpoints: [{ name: "Identity verified", completed: true, order: 1 }],
    suppressed: new Set(),
    suppressionThrows: false,
    auctions: [],
    auctionCreates: [],
    auctionUpdates: [],
    issuedCount: 6,
    liveInvitationCount: 6,
    transitions: [],
    exceptions: [],
    sequence: [],
    caseStatusInDb: "READY_TO_LAUNCH",
    deferRequested: false,
    issueSkipped: [],
    dispatchFailures: [],
    dispatched: 0,
  };
});

mock.module("server-only", { namedExports: {}, defaultExport: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});
mock.module("@/lib/prisma", { namedExports: { prisma: {} } });

mock.module("@/lib/services/payment/fulfillment-gate", {
  namedExports: {
    settledDepositForRequest: async () => ctrl.deposit,
    isRequestFulfillmentUnlocked: async () => ctrl.deposit !== null,
  },
});

mock.module("@/lib/services/prequal/approval-recheck", {
  namedExports: {
    recheckApproval: async () => ctrl.approval,
  },
});

mock.module("@/lib/supabase-service", { namedExports: { getServiceSupabase: () => ({}) } });

mock.module("@/lib/services/suppression.service", {
  namedExports: {
    SuppressionService: {
      isEmailSuppressed: async (_sb: unknown, email: string) => {
        if (ctrl.suppressionThrows) throw new Error("suppression store unreachable");
        return ctrl.suppressed.has(email);
      },
    },
  },
});

mock.module("@/lib/services/auction/auction-invitation.service", {
  namedExports: {
    // `deferDispatch` is the fix for the PENDING-window defect: the ROWS are written while the
    // auction is PENDING (S7-07) and the NOTICES are enqueued after it goes ACTIVE, because the
    // §27 send-time recheck refuses while the auction is not ACTIVE and a refusal is terminal.
    // The fake records both steps separately so the ORDER can be asserted rather than assumed.
    issueInvitations: async (
      _auctionId: string,
      field: unknown[],
      _db: unknown,
      _now: Date,
      options?: { deferDispatch?: boolean },
    ) => {
      ctrl.sequence.push(options?.deferDispatch ? "write-rows" : "invite");
      ctrl.deferRequested = options?.deferDispatch === true;
      return {
        issued: ctrl.issuedCount,
        skipped: ctrl.issueSkipped,
        invitationIds: Array.from({ length: ctrl.issuedCount }, (_, i) => `inv_${i}`),
        pendingDispatch: Array.from({ length: ctrl.issuedCount }, (_, i) => ({ invitationId: `inv_${i}` })),
        auctionId: _auctionId,
      };
    },
    dispatchInvitations: async (notices: unknown[]) => {
      ctrl.sequence.push("dispatch");
      ctrl.dispatched = notices.length - ctrl.dispatchFailures.length;
      return { dispatched: ctrl.dispatched, failed: ctrl.dispatchFailures };
    },
  },
});

// `sourcing-case.service` is deliberately NOT mocked. `transitionCase` takes the db as a
// parameter and needs only two `sourcingCase` calls, and `effectiveRadiusMiles` is pure — so the
// REAL transition matrix and the REAL radius arithmetic run here. Re-implementing either in a
// mock would be the same duplicate-derivation mistake this file's distance test exists to catch.

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Record<string, unknown>) => {
      ctrl.exceptions.push(input);
      return { queueItemId: "q1", created: true };
    },
  },
});

mock.module("@/lib/services/shortlist/candidate.service", {
  namedExports: {
    promoteShortlistToCandidates: async () => {
      ctrl.sequence.push("promote");
      return { created: ["cand_1"], existing: 0, skipped: [] };
    },
  },
});

function db() {
  return {
    vehicleRequest: { findUnique: async () => ctrl.request },
    sourcingCandidate: { findMany: async () => ctrl.candidates },
    vehicleRequestDueDiligenceCheckpoint: { findMany: async () => ctrl.checkpoints },
    auction: {
      findFirst: async ({ where }: { where: { depositId: string } }) =>
        ctrl.auctions.find((a) => a.depositId === where.depositId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        ctrl.sequence.push(`create:${String(data.status)}`);
        ctrl.auctionCreates.push(data);
        const row = { id: "auc_1", depositId: String(data.depositId), status: String(data.status) };
        ctrl.auctions.push(row);
        return { id: row.id };
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        ctrl.sequence.push(`activate:${String(args.data.status)}`);
        ctrl.auctionUpdates.push(args);
        const target = ctrl.auctions.find((a) => a.id === args.where.id && a.status === args.where.status);
        if (!target) return { count: 0 };
        target.status = String(args.data.status);
        return { count: 1 };
      },
    },
    auctionInvitation: {
      count: async () => {
        ctrl.sequence.push("count");
        return ctrl.liveInvitationCount;
      },
    },
    // What the real `transitionCase` reads and writes. The compare-and-set is honoured, so an
    // illegal or lost transition behaves here exactly as it does in production.
    sourcingCase: {
      findUnique: async () => ({ status: ctrl.caseStatusInDb }),
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (args.where.status !== ctrl.caseStatusInDb) return { count: 0 };
        ctrl.sequence.push(`transition:${String(args.data.status)}`);
        ctrl.transitions.push(args.data);
        ctrl.caseStatusInDb = String(args.data.status);
        return { count: 1 };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db()),
  } as never;
}

async function evaluate() {
  const { evaluateReadiness } = await import("@/lib/services/sourcing/launch-readiness.service");
  return evaluateReadiness("vr_1", CASE as never, db(), new Date("2026-09-11T00:00:00Z"));
}

async function launch(caseOverrides: Record<string, unknown> = {}) {
  const { launchFromCase } = await import("@/lib/services/sourcing/launch-readiness.service");
  return launchFromCase(
    "vr_1",
    { ...CASE, ...caseOverrides } as never,
    db(),
    new Date("2026-09-11T00:00:00Z"),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The eight entry items
// ─────────────────────────────────────────────────────────────────────────────

test("a complete case is ready, and every §7 item is accounted for", async () => {
  const r = await evaluate();
  assert.equal(r.ready, true, `blocked on: ${r.blockers.join(" | ")}`);
  assert.deepEqual(
    r.items.map((i) => i.key).sort(),
    [
      "APPROVAL_ATTACHED",
      "CONTACTS_SEND_SAFE",
      "CRITERIA_COMPLETE",
      "DEALER_COUNT",
      "DEPOSIT_SETTLED",
      "DUE_DILIGENCE_CHECKPOINTS",
      "REFERENCES_EXIST",
      "ROOFTOPS_IN_DISTANCE",
    ],
    "an item was added or dropped without this list being updated",
  );
  assert.equal(r.field.length, 6);
});

test("the deposit is read from the DEPOSIT, not from the case status", async () => {
  // S7-01b. `ACTIVE_SOURCING` is still written with no payment check by the progression
  // reconciler, so a status-derived gate would report a paid request for money that never
  // arrived. The case below is READY_TO_LAUNCH and the deposit is gone.
  ctrl.deposit = null;
  const r = await evaluate();
  const item = r.items.find((i) => i.key === "DEPOSIT_SETTLED")!;
  assert.equal(item.passed, false);
  assert.match(item.blocker!, /No settled, undisputed \$99 deposit/);
  assert.equal(item.owner, "BUYER");
  assert.equal(r.ready, false);
});

test("a valid approval with NO ceiling fails the item — offer validation needs the number", async () => {
  ctrl.approval = { ok: true, approvedAmountCents: null };
  const r = await evaluate();
  const item = r.items.find((i) => i.key === "APPROVAL_ATTACHED")!;
  assert.equal(item.passed, false);
  assert.match(item.blocker!, /no approved ceiling/);
});

test("an expired prequalification is the BUYER's to fix; an unapproved one is COMPLIANCE's", async () => {
  // §26 requires every blocker to name an owner, and these two have different return points:
  // the buyer can renew, but nobody can self-serve an approval decision.
  ctrl.approval = { ok: false, reason: "EXPIRED", approvedAmountCents: null };
  let item = (await evaluate()).items.find((i) => i.key === "APPROVAL_ATTACHED")!;
  assert.equal(item.owner, "BUYER");
  assert.match(item.blocker!, /expired/);

  ctrl.approval = { ok: false, reason: "NOT_APPROVED", approvedAmountCents: null };
  item = (await evaluate()).items.find((i) => i.key === "APPROVAL_ATTACHED")!;
  assert.equal(item.owner, "COMPLIANCE");
});

test("a limited field needs AUDITED approval — pending approval is not approval", async () => {
  // §6c's 3–4 row. The case status is the decision, and this item does not re-count the field.
  ctrl.candidates = [1, 2, 3].map((i) => readyCandidate(i));
  const { evaluateReadiness } = await import("@/lib/services/sourcing/launch-readiness.service");

  const pending = await evaluateReadiness(
    "vr_1",
    { ...CASE, status: "LIMITED_PENDING_APPROVAL", coverageCount: 3 } as never,
    db(),
    new Date("2026-09-11T00:00:00Z"),
  );
  const pendingItem = pending.items.find((i) => i.key === "DEALER_COUNT")!;
  assert.equal(pendingItem.passed, false);
  assert.match(pendingItem.blocker!, /audited Operations approval/);

  const approved = await evaluateReadiness(
    "vr_1",
    {
      ...CASE,
      status: "READY_TO_LAUNCH",
      coverageCount: 3,
      limitedAuctionApprovedAt: new Date("2026-09-10T00:00:00Z"),
    } as never,
    db(),
    new Date("2026-09-11T00:00:00Z"),
  );
  assert.equal(approved.items.find((i) => i.key === "DEALER_COUNT")!.passed, true);
});

test("a field below the limited minimum cannot launch even with an approval on file", async () => {
  ctrl.candidates = [1, 2].map((i) => readyCandidate(i));
  const { evaluateReadiness } = await import("@/lib/services/sourcing/launch-readiness.service");
  const r = await evaluateReadiness(
    "vr_1",
    { ...CASE, coverageCount: 2, limitedAuctionApprovedAt: new Date("2026-09-10T00:00:00Z") } as never,
    db(),
    new Date("2026-09-11T00:00:00Z"),
  );
  const item = r.items.find((i) => i.key === "DEALER_COUNT")!;
  assert.equal(item.passed, false);
  assert.match(item.blocker!, /the minimum field is 3 with approval, 5 without/);
});

test("send-safety is RE-CHECKED at launch, with the full store — not trusted from §6b", async () => {
  // Time has passed since validation, and a dealership's own one-click unsubscribe lands in the
  // full store. Readiness that trusted §6b would launch an auction with a field smaller than it
  // believed — defect 1, one layer up.
  ctrl.suppressed.add("s3@ex.com");
  const r = await evaluate();
  const item = r.items.find((i) => i.key === "CONTACTS_SEND_SAFE")!;
  assert.equal(item.passed, false);
  assert.match(item.blocker!, /Rooftop 3/);
});

test("a suppression-store outage HOLDS the launch rather than launching unverified", async () => {
  ctrl.suppressionThrows = true;
  const r = await evaluate();
  const item = r.items.find((i) => i.key === "CONTACTS_SEND_SAFE")!;
  assert.equal(item.passed, false, "an outage was read as send-safe");
  assert.equal(r.ready, false);
});

test("a rooftop beyond the permitted radius blocks the launch", async () => {
  // The buyer can narrow an authorisation between sourcing and launch, so the distance is a
  // launch-time question and not only a §6b one.
  ctrl.candidates = [readyCandidate(1, 10), readyCandidate(2, 400)];
  const r = await evaluate();
  const item = r.items.find((i) => i.key === "ROOFTOPS_IN_DISTANCE")!;
  assert.equal(item.passed, false);
  assert.match(item.blocker!, /beyond the permitted 100 miles/);
});

test("the AUTHORIZED band with no authorisation has no permitted edge, so the launch holds", async () => {
  // The state the ladder refuses to search in. There is no permitted distance, so no rooftop
  // can be inside one — reported as such rather than as "beyond NaN miles".
  const { evaluateReadiness } = await import("@/lib/services/sourcing/launch-readiness.service");
  const r = await evaluateReadiness(
    "vr_1",
    { ...CASE, band: "AUTHORIZED", authorizedRadiusMiles: null } as never,
    db(),
    new Date("2026-09-11T00:00:00Z"),
  );
  const item = r.items.find((i) => i.key === "ROOFTOPS_IN_DISTANCE")!;
  assert.equal(item.passed, false);
  assert.match(item.blocker!, /no permitted distance/);
  assert.equal(r.ready, false);
});

test("an authorisation SMALLER than the band's edge binds — min(band, authorized)", async () => {
  // A buyer asked for 250 and granted 180. The 250 band must check against 180.
  ctrl.candidates = [readyCandidate(1, 120), readyCandidate(2, 200)];
  const { evaluateReadiness } = await import("@/lib/services/sourcing/launch-readiness.service");
  const r = await evaluateReadiness(
    "vr_1",
    { ...CASE, band: "250", authorizedRadiusMiles: 180 } as never,
    db(),
    new Date("2026-09-11T00:00:00Z"),
  );
  const item = r.items.find((i) => i.key === "ROOFTOPS_IN_DISTANCE")!;
  assert.equal(item.passed, false);
  assert.match(item.blocker!, /beyond the permitted 180 miles/);
});

test("unseeded checkpoints and outstanding checkpoints are different blockers", async () => {
  ctrl.checkpoints = [];
  let item = (await evaluate()).items.find((i) => i.key === "DUE_DILIGENCE_CHECKPOINTS")!;
  assert.match(item.blocker!, /No due-diligence checkpoints were seeded/);

  ctrl.checkpoints = [
    { name: "Identity verified", completed: true, order: 1 },
    { name: "Insurance acknowledged", completed: false, order: 2 },
  ];
  item = (await evaluate()).items.find((i) => i.key === "DUE_DILIGENCE_CHECKPOINTS")!;
  assert.match(item.blocker!, /Insurance acknowledged/);
});

test("a candidate not marked invitation-ready is not in the field, whatever else it carries", async () => {
  ctrl.candidates = [
    readyCandidate(1),
    { ...readyCandidate(2), validation: { invitationReady: false, contactEmail: "s2@ex.com" } },
    { ...readyCandidate(3), validation: { invitationReady: true, contactEmail: null } },
  ];
  const r = await evaluate();
  assert.deepEqual(r.field.map((t) => t.rooftopId), ["rt_1"]);
});

test("the field is capped at eight and ordered nearest-first, deterministically", async () => {
  ctrl.candidates = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((i) => readyCandidate(i, i * 10));
  const r = await evaluate();
  assert.equal(r.field.length, 8);
  assert.deepEqual(
    r.field.map((t) => t.rooftopId),
    ["rt_1", "rt_2", "rt_3", "rt_4", "rt_5", "rt_6", "rt_7", "rt_8"],
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The launch sequence — S7-07
// ─────────────────────────────────────────────────────────────────────────────

test("the launch sequence is PENDING → rows → read back → ACTIVE → notices, in that order", async () => {
  // THE NOTICES COME AFTER THE FLIP, AND THAT IS THE WHOLE CORRECTION.
  //
  // S7-07 requires the invitation ROWS while the auction is PENDING and the flip only once one
  // can be read back. But `skipIfInvitationNoLongerSendable` — the §27 send-time recheck on
  // `dealer_invited` — refuses while the auction is not ACTIVE, and a refusal marks the outbox row
  // `skipped`, which is TERMINAL. The drain runs every minute, so enqueueing inside the PENDING
  // window meant a tick landing before the flip killed those notices permanently — and the auction
  // went ACTIVE anyway, because the ROWS existed, and the buyer was told N dealerships were
  // competing when none had been emailed. The order below is what closes that window, so it is
  // asserted as an ORDER and not as a set.
  const res = await launch();
  assert.equal(res.launched, true, `blocked on: ${res.blockers.join(" | ")}`);
  assert.equal(res.auctionId, "auc_1");
  assert.equal(res.invitationsIssued, 6);
  assert.equal(ctrl.deferRequested, true, "the notices were enqueued inside the PENDING window");
  assert.deepEqual(ctrl.sequence, [
    "create:PENDING",
    "promote",
    "write-rows",
    "count",
    "activate:ACTIVE",
    "dispatch",
    "transition:LAUNCHED",
  ]);
  assert.equal(ctrl.auctionUpdates[0].where.status, "PENDING", "the flip was not a compare-and-set");
  assert.equal(ctrl.dispatched, 6);
});

test("a row written but not completed HOLDS the launch — WRITE_FAILED is a blocker, not a log line", async () => {
  // `WRITE_FAILED` means the invitation row committed and its firewall entry or notice did not:
  // §25.1's evidence missing for a dealership that is nonetheless in the field. Launching anyway
  // would tell the buyer a dealership is competing that was never reached.
  ctrl.issueSkipped = [{ rooftopId: "rt_3", reason: "WRITE_FAILED" }];
  const res = await launch();
  assert.equal(res.launched, false);
  assert.ok(!ctrl.sequence.includes("activate:ACTIVE"), "the auction was activated with an incomplete invitation");
  assert.ok(!ctrl.sequence.includes("dispatch"));
  assert.match(res.blockers[0], /could not be completed/);
  assert.equal(ctrl.exceptions.length, 1);
});

test("a notice that cannot be queued raises an Operations task — the auction stays live", async () => {
  // The auction is ACTIVE and the rows exist, so unwinding it would be worse. But those
  // dealerships hold an invitation nobody told them about, which is a task and not a log line.
  ctrl.dispatchFailures = ["inv_2"];
  const res = await launch();
  assert.equal(res.launched, true, `blocked on: ${res.blockers.join(" | ")}`);
  assert.equal(ctrl.auctions[0].status, "ACTIVE");
  assert.equal(ctrl.exceptions.length, 1);
  assert.match(String(ctrl.exceptions[0].detail), /have not been contacted/);
});

test("THE ONE THAT MATTERS: zero invitation rows leaves the auction PENDING, never ACTIVE", async () => {
  // §Stage 7's "The auction never launches half-ready". A buyer who paid $99 and sees a live
  // auction nobody was invited to is the failure this refuses, and the count is re-read INSIDE
  // the transaction rather than taken from the issue result — a write that reported success is
  // still not a row until it is read back.
  ctrl.issuedCount = 3;
  ctrl.liveInvitationCount = 0;

  const res = await launch();
  assert.equal(res.launched, false);
  assert.equal(res.auctionId, "auc_1", "the auction row should still exist, PENDING");
  assert.ok(!ctrl.sequence.includes("activate:ACTIVE"), "the auction was activated with nobody invited");
  assert.equal(ctrl.auctions[0].status, "PENDING");
  assert.match(res.blockers[0], /stays PENDING rather than launching with nobody invited/);
  // And it is surfaced, not swallowed.
  assert.equal(ctrl.exceptions.length, 1);
  assert.equal(ctrl.exceptions[0].code, "LAUNCH_READINESS_BLOCKED");
});

test("endsAt is 48 hours out — §7's sealed window, set in the same transaction as ACTIVE", async () => {
  await launch();
  const data = ctrl.auctionUpdates[0].data as { endsAt: Date; startedAt: Date; status: string };
  assert.equal(data.status, "ACTIVE");
  assert.equal(
    data.endsAt.getTime() - new Date("2026-09-11T00:00:00Z").getTime(),
    48 * 3_600_000,
    "the auction window is not 48 hours",
  );
  assert.equal(data.startedAt.toISOString(), "2026-09-11T00:00:00.000Z");
});

test("a blocked readiness holds and raises ONE exception keyed to the blocker set", async () => {
  // The readiness check runs on every reconciler tick. One row per tick would bury the queue it
  // is meant to populate, so the key carries the failed item keys — a DIFFERENT blocker is a
  // new row because it needs a different action.
  ctrl.deposit = null;
  const res = await launch();
  assert.equal(res.launched, false);
  assert.equal(ctrl.auctionCreates.length, 0, "an auction was created for a request with no deposit");
  assert.equal(ctrl.exceptions.length, 1);
  assert.match(String(ctrl.exceptions[0].idempotencyKey), /^LAUNCH_READINESS_BLOCKED:case_1:/);
  assert.equal(ctrl.exceptions[0].ownerRole, "BUYER", "the blocker's owner was not carried to the queue");
});

test("an auction already ACTIVE for the deposit is not launched twice", async () => {
  // `Auction.depositId` is @unique, so the constraint is the idempotency — but a redelivered
  // launch must also not re-invite, which is why this returns before `issueInvitations`.
  ctrl.auctions = [{ id: "auc_existing", depositId: "dep_1", status: "ACTIVE" }];
  const res = await launch();
  assert.equal(res.launched, false);
  assert.equal(res.auctionId, "auc_existing");
  assert.equal(res.invitationsIssued, 0);
  assert.ok(!ctrl.sequence.includes("invite"), "a redelivered launch re-invited the field");
});

test("a PENDING auction from a partial prior run is reused, not duplicated", async () => {
  ctrl.auctions = [{ id: "auc_pending", depositId: "dep_1", status: "PENDING" }];
  const res = await launch();
  assert.equal(res.launched, true, `blocked on: ${res.blockers.join(" | ")}`);
  assert.equal(res.auctionId, "auc_pending");
  assert.equal(ctrl.auctionCreates.length, 0);
});

test("the case only reaches LAUNCHED when the auction actually went ACTIVE", async () => {
  ctrl.liveInvitationCount = 0;
  await launch();
  assert.ok(
    !ctrl.transitions.some((t) => t.status === "LAUNCHED"),
    "the case was marked LAUNCHED for an auction that stayed PENDING",
  );
});

// ── #422 review: the buyer-facing count (found by Copilot, confirmed, fixed) ──
//
// The §27 dispatch split closed the SILENCE — a failed dispatch raises an Operations task
// instead of vanishing. It did not close the MISSTATEMENT. `dispatchInvitations` returns the
// count that reached the outbox, and its own docstring says that exists "so the caller can tell
// 'eight invited' from 'eight rows, six emailed'" — and then `launchFromCase` returned
// `invitationsIssued: issued.issued` and dropped it, so `sourcing-driver` rendered the buyer's
// "N dealerships are competing" from ROWS WRITTEN. `dealershipsInvited` was asserted by no test
// in the repository, which is how it survived two reviews.

test("REPRODUCTION: a partial dispatch failure must not report the full field as contacted", async () => {
  ctrl.dispatchFailures = ["inv_2", "inv_4"];

  const res = await launch();

  assert.equal(res.launched, true, `blocked on: ${res.blockers.join(" | ")}`);
  assert.equal(res.invitationsIssued, 6, "six rows WERE written, and that stays true");
  assert.equal(res.noticesDispatched, 4, "but only four notices reached the outbox");
  assert.ok(
    ctrl.exceptions.length > 0,
    "and Operations is still told — this fix adds to that guard, it does not replace it",
  );
});

test("a clean launch reports the same number twice, so the distinction is invisible when it should be", async () => {
  ctrl.dispatchFailures = [];
  const res = await launch();
  assert.equal(res.launched, true);
  assert.equal(res.noticesDispatched, res.invitationsIssued,
    "nothing failed, so rows and notices agree and the buyer sees the whole field");
});

test("a launch held before dispatch reports zero notices, not the rows it wrote", async () => {
  // WRITE_FAILED holds the auction PENDING at step 2, so step 4 never runs. Returning the row
  // count as notices here would claim a dispatch that never happened.
  ctrl.issueSkipped = [{ rooftopId: "r_1", reason: "WRITE_FAILED" }];
  const res = await launch();
  assert.equal(res.launched, false);
  assert.equal(res.noticesDispatched, 0, "no dispatch ran, so no notice was queued");
});
