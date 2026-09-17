// WHO MAY RELEASE, AND WITH WHAT CREDENTIAL — the two actors of §Stage 18, and the carve-out.
//
// THE DEFECT THIS PINS. §8.2 defect (4) collapsed five Deal-completion writers into
// `pickup-completion.service.ts`, and the journey routes moved onto it through
// `completeJourneyPickup`. That wrapper had no code to present, so it passed `rawToken: ""` —
// and `consumeReleaseToken` hashes whatever it is given and compares, so an empty string matches
// no row, returns false, and the release refused with `code_already_spent`. The admin path could
// no longer complete a pickup AT ALL. A capability that had worked for every prior phase would
// have disappeared behind a refactor whose whole purpose was to preserve it, and the guard that
// counts admin completion paths would still have read green, because the route was still there —
// it just could not finish.
//
// THE RULE THAT REPLACED THE EMPTY STRING. The code is the DEALERSHIP's credential: §Stage 18
// has the dealer scan what the buyer presents, and the point of hashing it is that possession of
// the code proves the buyer is at the counter. An Operations-recorded release is a different act
// with a different proof — role gate, stated reason, awaited audit row (pinned in
// `lib/__tests__/role-boundary-frozen.test.ts`) — and it has no code to present. So the input is
// a UNION: a scanned release carries `rawToken` and an Operations release may not carry one at
// all. `rawToken: ""` no longer type-checks in either arm, which is the real repair — the runtime
// branch below is what that union buys.
//
// AND IT REVOKES RATHER THAN CONSUMES. Consuming records "a handover happened on this
// credential", which would be false. Revoking records "it will not happen on this credential",
// which is exactly true once Operations has recorded the release.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/pickup/__tests__/pickup-completion-actors.test.ts"

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { hashToken } from "@/lib/services/dealer-recruitment/account-claim.service";

/** The code the buyer holds, in this fixture. */
const LIVE_CODE = "AL-7Q2K-9XTB";

/** §Stage 20's thirteenth precondition. Operations supplies what it observed at the handover. */
const EVIDENCE = { odometerAtPossession: 14, conditionAsDelivered: "Clean, as described." };

interface Ctrl {
  dealStatus: string;
  /** The pickup row's stored credential — a REAL hash, so a wrong or empty code really misses. */
  storedHash: string | null;
  tokenConsumedAt: Date | null;
  tokenRevokedAt: Date | null;
  consumeAttempts: Array<string | undefined>;
  revokeCalls: string[];
  /**
   * THE PICKUP ROW, MUTABLE, because §Stage 20's ordering depends on it. `confirmPossession`
   * writes the buyer's evidence and THEN evaluates the fourteen, three of which that write
   * satisfies. A static fixture would either carry the evidence already — hiding the ordering —
   * or never carry it, so nothing could ever complete. This row starts without it and the
   * update below merges into it, so the ordering is exercised rather than assumed.
   */
  pickupRow: Record<string, unknown>;
  obligations: Array<Record<string, unknown>>;
  /** Set to make one of the fourteen false, to prove the gate is wired. */
  dealOverrides: Record<string, unknown>;
  statusHistory: Array<Record<string, unknown>>;
  pickupUpdates: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
  exceptions: Array<Record<string, unknown>>;
  completionEvents: string[];
  /** Open §26 queue items on this deal, which §Stage 20's fourteenth precondition reads. */
  openQueueItems: Array<Record<string, unknown>>;
  resolutions: Array<Record<string, unknown>>;
  /** Raw `SELECT … FOR UPDATE` statements issued inside a transaction. */
  rowLocks: string[];
}
let ctrl: Ctrl;

const PAST = new Date("2026-02-01T00:00:00Z");
const VIN = "1HGCM82633A004352";

/**
 * A deal on which all fourteen of §Stage 20's preconditions hold — EXCEPT the three the buyer's
 * own confirmation supplies, which arrive when `tx.pickup.update` merges them in.
 */
const dealRow = () => ({
  id: "deal_1",
  status: ctrl.dealStatus,
  buyerId: "buyer_1",
  completedAt: null,
  coBuyerId: null,
  coBuyer: null,
  vehicleRequestId: "vr_1",
  vehicleRequest: { id: "vr_1" },
  depositId: "dep_1",
  deposit: { id: "dep_1", status: "PAID" },
  auctionId: "auc_1",
  auction: { id: "auc_1", sourcingCaseId: "sc_1", vehicleRequestId: "vr_1" },
  offerId: "off_1",
  vehicleRequestOfferId: null,
  vehicleRequestOffer: null,
  dealerId: "dlr_1",
  dealer: { id: "dlr_1" },
  vin: VIN,
  vehicleYear: 2021,
  vehicleMake: "Honda",
  vehicleModel: "Accord",
  recapConfirmedByBuyerAt: PAST,
  recapConfirmedByDealerAt: PAST,
  financingCompletedAt: PAST,
  fundingClearedAt: PAST,
  feePaidAt: PAST,
  feeAmountCents: 49900,
  insuranceStatus: "VERIFIED",
  dealerExecutedContractId: "cv_1",
  holdReason: null,
  frozenAt: null,
  buyer: { id: "buyer_1", firstName: "Ada", lastName: "Byron", user: { email: "ada@example.com" } },
  offer: { id: "off_1", dealerId: "dlr_1", auctionId: "auc_1", dealer: { dealershipName: "North Motors", user: { email: "sales@north.example" } } },
  dealerReaffirmations: [{ status: "CONFIRMED", confirmedVin: VIN, decidedAt: PAST }],
  contractVersions: [{ id: "cv_1", version: 3 }],
  eSignEnvelopes: [{ signerKind: "BUYER", status: "COMPLETED", documentVersionId: "cv_1" }],
  pickup: ctrl.pickupRow,
  // §Stage 21's two CONDITIONAL obligations read these. No trade and no due-bill items here, so
  // completion opens exactly one — title and registration. The conditional pair is proved in
  // `post-completion-obligations.test.ts`.
  tradeInSubmissions: [],
  queueItems: ctrl.openQueueItems,
  ...ctrl.dealOverrides,
});

const tx = {
  deal: {
    findUnique: async () => dealRow(),
    updateMany: async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
      if (where.status !== ctrl.dealStatus) return { count: 0 };
      ctrl.dealStatus = data.status;
      return { count: 1 };
    },
  },
  pickup: {
    update: async (args: Record<string, unknown>) => {
      ctrl.pickupUpdates.push(args);
      Object.assign(ctrl.pickupRow, args.data as Record<string, unknown>);
      return {};
    },
    // THE TOKEN SERVICE IS NOT MOCKED. `consumeReleaseToken` and `revokeReleaseToken` are a hash
    // and a conditional `updateMany`, and mocking them to return `true` is precisely how the
    // empty-string defect stayed invisible: a stub that answers "spent" for any input cannot tell
    // `""` from the buyer's code. This models the ROW, and lets the real comparison run.
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (ctrl.tokenConsumedAt || ctrl.tokenRevokedAt) return { count: 0 };
      if ("tokenHash" in where && typeof where.tokenHash === "string") {
        ctrl.consumeAttempts.push(where.tokenHash);
        if (where.tokenHash !== ctrl.storedHash) return { count: 0 };
        ctrl.tokenConsumedAt = data.tokenConsumedAt as Date;
        return { count: 1 };
      }
      // The revoke shape: `tokenHash: { not: null }`.
      if (!ctrl.storedHash) return { count: 0 };
      ctrl.revokeCalls.push(String(where.dealId));
      ctrl.tokenRevokedAt = data.tokenRevokedAt as Date;
      return { count: 1 };
    },
  },
  dealStatusHistory: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.statusHistory.push(data); return {}; } },
  buyerActivityEvent: { create: async () => ({}) },
  // Read by the real `signatureProgress`, which §Stage 20's tenth precondition uses and this
  // file does not mock — see `completion-preconditions.test.ts`.
  eSignEnvelope: { findMany: async () => [{ signerKind: "BUYER", status: "COMPLETED" }] },
  // §Stage 21 opens obligations INSIDE the completion transaction, so they are part of what
  // this file exercises rather than a separate concern.
  postCompletionObligation: {
    findFirst: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.obligations.push(data); return data; },
  },
  // `SELECT … FOR UPDATE` on the deal row, taken by the completion transaction to serialize two
  // concurrent confirmations. Recorded so the lock is asserted rather than assumed.
  $queryRaw: async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    ctrl.rowLocks.push(strings.join("?") + "|" + vals.join(","));
    return [];
  },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      ...tx,
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  },
});

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Record<string, unknown>) => { ctrl.outbox.push(input); return { queued: true }; },
  },
});

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Record<string, unknown>) => { ctrl.exceptions.push(input); return {}; },
    listOpen: async (filter: Record<string, unknown>) =>
      ctrl.openQueueItems.filter(
        (q) => !filter.exceptionCode || q.exceptionCode === filter.exceptionCode,
      ),
    resolve: async (input: Record<string, unknown>) => {
      ctrl.resolutions.push(input);
      ctrl.openQueueItems = ctrl.openQueueItems.filter((q) => q.id !== input.queueItemId);
      return {};
    },
  },
});

mock.module("@/lib/services/deal/deal-completion-event.service", {
  namedExports: {
    emitDealCompletionEvent: async (dealId: string) => { ctrl.completionEvents.push(dealId); },
  },
});

const service = () => import("../pickup-completion.service");

beforeEach(() => {
  ctrl = {
    dealStatus: "PICKUP_SCHEDULED",
    storedHash: hashToken(LIVE_CODE),
    tokenConsumedAt: null,
    tokenRevokedAt: null,
    consumeAttempts: [],
    revokeCalls: [],
    pickupRow: {
      dealerReleasedAt: null,
      releasedBy: null,
      identityVerifiedAt: null,
      buyerConfirmedAt: null,
      vinMatch: null,
      odometerAtPossession: null,
      conditionAtPossession: null,
      possessionDiscrepancy: null,
    },
    dealOverrides: {},
    obligations: [],
    statusHistory: [],
    pickupUpdates: [],
    outbox: [],
    openQueueItems: [],
    resolutions: [],
    rowLocks: [],
    exceptions: [],
    completionEvents: [],
  };
});

test("an Operations-recorded release needs no code, and drives the journey route to COMPLETED", async () => {
  // THE REGRESSION. Before the union, this wrapper passed `rawToken: ""`, the consume matched no
  // row, and the release refused — so the admin journey route could not complete a pickup at all.
  const out = await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.deepEqual(out, { ok: true }, "the admin journey path must still be able to complete a pickup");
  assert.equal(ctrl.dealStatus, "COMPLETED");
  assert.deepEqual(
    ctrl.consumeAttempts,
    [],
    "an Operations release presents no code — it must not try to spend one, and must not fail when it cannot"
  );
  assert.deepEqual(ctrl.revokeCalls, ["deal_1"], "the live code must be RETIRED, not consumed: no handover happened on it");
});

test("the release and the completion are recorded as ADMIN acts, not as the dealer's or the buyer's", async () => {
  await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.deepEqual(
    ctrl.statusHistory.map((h) => [h.fromStatus, h.toStatus, h.actorRole, h.actorId]),
    [
      ["PICKUP_SCHEDULED", "HANDOVER_PENDING", "ADMIN", "admin_1"],
      ["HANDOVER_PENDING", "COMPLETED", "ADMIN", "admin_1"],
    ],
    "§Stage 19: an admin-recorded possession that reads as the buyer's makes the history lie about who was at the car"
  );
});

test("a DEALER release still has to present a code that matches — the carve-out is not a bypass", async () => {
  const out = await (await service()).recordDealerRelease({
    dealId: "deal_1",
    dealerId: "dlr_1",
    pickupId: "pu_1",
    rawToken: "not-the-right-code",
    identityVerified: true,
  });

  assert.deepEqual(out, { ok: false, reason: "code_already_spent" });
  assert.deepEqual(
    ctrl.consumeAttempts,
    [hashToken("not-the-right-code")],
    "the dealer path must still attempt the spend, against the hash of what was presented"
  );
  assert.equal(ctrl.dealStatus, "PICKUP_SCHEDULED", "a refused code must leave the deal where it was");
  assert.deepEqual(ctrl.revokeCalls, [], "a failed dealer scan must not retire the buyer's live code");
});

test("an unverified identity refuses before anything is spent or revoked", async () => {
  const out = await (await service()).recordDealerRelease({
    dealId: "deal_1",
    dealerId: "dlr_1",
    pickupId: "pu_1",
    rawToken: "code",
    identityVerified: false,
  });

  assert.deepEqual(out, { ok: false, reason: "identity_unverified" });
  assert.deepEqual(ctrl.consumeAttempts, [], "identity is a precondition — it is checked before the credential is touched");
  assert.deepEqual(ctrl.revokeCalls, []);
  assert.equal(ctrl.exceptions[0]?.code, "ID_MISMATCH_AT_HANDOVER", "§Stage 18 raises the §26 exception");
});

test("the journey wrapper refuses a deal that never reached a scheduled pickup", async () => {
  ctrl.dealStatus = "FUNDING_PENDING";

  const out = await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.deepEqual(out, {
    ok: false,
    code: "NOT_READY_FOR_PICKUP",
    message: "This deal has not reached a scheduled pickup, so there is no handover to record.",
  });
  assert.equal(ctrl.dealStatus, "FUNDING_PENDING");
  assert.deepEqual(ctrl.revokeCalls, [], "nothing is retired for a handover that was never reached");
});

test("the journey wrapper refuses BEFORE it releases when Operations supplied no evidence", async () => {
  // THE CALL THE ROUTES ACTUALLY MAKE. Both journey routes call `completeJourneyPickup(dealId,
  // adminId)` with TWO arguments — `app/api/admin/buyers/[buyerId]/journey/complete/route.ts`
  // and `.../complete-all/route.ts`. Every other test in this file passes EVIDENCE, so the
  // production call shape was the one shape nothing exercised.
  //
  // The refusal itself is intended: the journey tools collect no odometer and no condition, and
  // the wrapper cannot invent either, so §Stage 20's thirteenth precondition is outstanding and
  // saying so is correct. WHAT WAS NOT INTENDED IS THE ORDER. `recordDealerRelease` ran first,
  // so by the time the refusal was returned the deal had advanced to HANDOVER_PENDING, the
  // buyer's live code had been revoked, and the buyer had been queued a message reading "the
  // dealership has recorded that your vehicle was released to you". HANDOVER_PENDING has exactly
  // one exit — COMPLETED — so none of that could be walked back, and the admin saw only a 409.
  //
  // A refusal must cost nothing. Nothing irreversible may happen before it.
  const out = await (await service()).completeJourneyPickup("deal_1", "admin_1");

  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.code, "COMPLETION_BLOCKED");
  assert.match(
    out.ok === false ? out.message : "",
    /mileage/i,
    "§Stage 20 names the missing checkpoint and its owner, rather than 'could not be completed'",
  );

  assert.equal(ctrl.dealStatus, "PICKUP_SCHEDULED", "a refused completion does not advance the deal");
  assert.deepEqual(ctrl.revokeCalls, [], "and does not retire the code the buyer is still carrying");
  assert.deepEqual(
    ctrl.outbox.filter((m) => String(m.templateKey ?? m.template ?? "").toLowerCase().includes("release")),
    [],
    "and never tells the buyer their vehicle was released",
  );
  assert.deepEqual(ctrl.statusHistory, [], "no status history row for a handover that did not happen");
});

test("the journey wrapper still completes when Operations DID supply the evidence", async () => {
  // The guard above must refuse the empty call without breaking the call that carries the facts —
  // the capability-preservation half of the same fix.
  const out = await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.deepEqual(out, { ok: true });
  assert.equal(ctrl.dealStatus, "COMPLETED");
});

test("partial evidence is refused too — a condition with no odometer is not evidence", async () => {
  const out = await (await service()).completeJourneyPickup("deal_1", "admin_1", {
    conditionAsDelivered: "Clean, as described.",
  });

  assert.equal(out.ok === false && out.code, "COMPLETION_BLOCKED");
  assert.equal(ctrl.dealStatus, "PICKUP_SCHEDULED");
  assert.deepEqual(ctrl.revokeCalls, []);
});

test("a second journey completion is a no-op, not a second completion", async () => {
  await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);
  const before = { history: ctrl.statusHistory.length, events: ctrl.completionEvents.length };

  const again = await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.deepEqual(again, { ok: true });
  assert.equal(ctrl.statusHistory.length, before.history, "COMPLETED is terminal — no second history row");
  assert.equal(ctrl.completionEvents.length, before.events, "and no second completion event");
});

test("the buyer's own confirmation is still the normal path, and is recorded as the buyer's", async () => {
  ctrl.dealStatus = "HANDOVER_PENDING";
  // The dealership already released — §Stage 20's twelfth precondition. This test starts the
  // deal mid-ladder rather than walking it, so the release has to be on the row.
  Object.assign(ctrl.pickupRow, { dealerReleasedAt: PAST, releasedBy: "dlr_1" });

  const out = await (await service()).confirmPossession({
    dealId: "deal_1",
    buyerId: "buyer_1",
    vehicleReceived: true,
    vinMatch: true,
    odometerAtPossession: EVIDENCE.odometerAtPossession,
    conditionAsDelivered: EVIDENCE.conditionAsDelivered,
    keysAndAccessoriesReceived: true,
  });

  assert.equal(out.ok, true);
  assert.equal(ctrl.dealStatus, "COMPLETED");
  assert.deepEqual(
    ctrl.statusHistory.map((h) => [h.actorRole, h.actorId]),
    [["BUYER", "buyer_1"]],
    "the default actor is the buyer — the ADMIN carve-out must not become the default"
  );
});

test("§Stage 20 gates the completion, and names the checkpoint and the party", async () => {
  // THE GATE IS PROVED BY BREAKING ONE OF THE FOURTEEN — and the one chosen matters. Funding,
  // insurance and the executed contract are ALSO the three release gates, which `assertReleaseGates`
  // throws on earlier in the same transaction; breaking one of those proves the release gate, not
  // this one. The recap is a Stage 20 precondition and nothing else, so reaching COMPLETION_BLOCKED
  // through it can only be the fourteen.
  ctrl.dealOverrides = { recapConfirmedByDealerAt: null };

  const out = await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.code, "COMPLETION_BLOCKED");
  assert.match(out.ok === false ? out.message : "", /final recap confirmed by both parties/i);
  assert.match(out.ok === false ? out.message : "", /DEALERSHIP/);
  assert.notEqual(ctrl.dealStatus, "COMPLETED", "a deal missing a precondition must not complete");
});

test("a blocked completion still KEEPS the buyer's evidence, and does not write the pickup COMPLETED", async () => {
  // §Stage 19's report is a fact about a vehicle that already moved. Discarding it to punish the
  // dealership's missing paperwork would lose evidence and make the buyer re-enter it.
  ctrl.dealOverrides = { recapConfirmedByDealerAt: null };

  await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.equal(ctrl.pickupRow.buyerConfirmedAt instanceof Date, true, "the possession evidence must be committed");
  assert.equal(ctrl.pickupRow.odometerAtPossession, 14);
  assert.equal(ctrl.pickupRow.conditionAtPossession, "Clean, as described.");
  assert.notEqual(ctrl.pickupRow.status, "COMPLETED", "the pickup must not read COMPLETED on a blocked deal");
  assert.equal(ctrl.statusHistory.filter((h) => h.toStatus === "COMPLETED").length, 0);
});

test("the buyer's condition report no longer overwrites the dealership's", async () => {
  // The two used to share `condition_at_release`, so every completed handover destroyed the
  // dealership's record and relabelled the buyer's as the dealer's.
  await (await service()).recordDealerRelease({
    dealId: "deal_1",
    dealerId: "dlr_1",
    pickupId: "pu_1",
    rawToken: LIVE_CODE,
    identityVerified: true,
    conditionAtRelease: "Two stone chips on the bonnet.",
  });
  await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.equal(ctrl.pickupRow.conditionAtRelease, "Two stone chips on the bonnet.", "the DEALERSHIP's record must survive");
  assert.equal(ctrl.pickupRow.conditionAtPossession, "Clean, as described.", "the BUYER's record is its own column");
});

test("completing the deal opens §Stage 21's unconditional obligation, and does not touch the Deal to do it", async () => {
  await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.deepEqual(
    ctrl.obligations.map((o) => o.type),
    ["TITLE_AND_REGISTRATION"],
    "every vehicle purchase owes a title; the trade and due-bill obligations are conditional and this fixture has neither"
  );
  assert.equal(ctrl.obligations[0].ownerRole, "DEALERSHIP");
  assert.equal(ctrl.obligations[0].status, "PENDING");
});

test("a BLOCKED completion opens no obligations", async () => {
  // They are children of a completed deal. Opening one for a deal that did not complete would
  // make §Stage 21's tracker disagree with §Stage 20's gate about whether the sale happened.
  ctrl.dealOverrides = { recapConfirmedByDealerAt: null };

  await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.deepEqual(ctrl.obligations, []);
});

test("a buyer who does NOT have the vehicle can still report why, and a case is opened", async () => {
  // THE CASE WHERE THE REPORT MATTERS MOST. §Stage 19's form has two controls: "I have the
  // vehicle" and a free-text problem report whose button reads "Report a problem". A buyer at the
  // counter whose car is not there — wrong vehicle, still in detailing, keys withheld — leaves the
  // first unticked, types what happened, and presses it.
  //
  // `confirmPossession` returned on `!vehicleReceived` BEFORE it read the deal and before the
  // material-discrepancy branch, so nothing at all was written: no `possessionDiscrepancy`, no
  // DELIVERY_DISCREPANCY_REPORTED queue item. The buyer was then told "Tell us you have the
  // vehicle before we complete the deal. If something is wrong, report it here and we will open a
  // case." — which is what they had just done, and no case existed. The dealership had already
  // recorded a release, so the deal sat at HANDOVER_PENDING with an unrecorded dispute.
  ctrl.dealStatus = "HANDOVER_PENDING";

  const out = await (await service()).confirmPossession({
    dealId: "deal_1",
    buyerId: "buyer_1",
    vehicleReceived: false,
    vinMatch: false,
    keysAndAccessoriesReceived: false,
    discrepancy: { material: true, note: "They scanned the code but the car isn't ready and they won't give me the keys." },
  });

  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.reason, "not_received_reported", "the outcome must be distinguishable from a silent refusal");

  const ex = ctrl.exceptions.find((e) => e.code === "DELIVERY_DISCREPANCY_REPORTED");
  assert.ok(ex, "§Stage 19: a reported problem opens an Operations case");
  assert.match(String(ex.detail), /keys/, "the buyer's own words are the case detail");

  assert.ok(ctrl.pickupRow.possessionDiscrepancy, "the report is recorded on the pickup, not only in the queue");

  // AND THE RECORD MUST NOT CLAIM A CONFIRMATION THAT DID NOT HAPPEN. `buyerConfirmedAt` means
  // "the buyer confirmed possession". Stamping it here to reuse the existing branch would
  // manufacture evidence about a vehicle the buyer just said they do not have — the same thing
  // the sibling admin schema refuses to do with a substituted odometer reading.
  assert.equal(ctrl.pickupRow.buyerConfirmedAt ?? null, null, "a buyer without the vehicle has confirmed nothing");
  assert.equal(ctrl.dealStatus, "HANDOVER_PENDING", "and the deal is certainly not complete");
});

test("no vehicle and NO report is still a plain refusal that writes nothing", async () => {
  // The unticked box on its own is a truthful answer to the form, not a dispute. It must stay a
  // refusal — the fix above must not turn every mis-click into an Operations case.
  ctrl.dealStatus = "HANDOVER_PENDING";

  const out = await (await service()).confirmPossession({
    dealId: "deal_1",
    buyerId: "buyer_1",
    vehicleReceived: false,
    vinMatch: true,
    keysAndAccessoriesReceived: false,
  });

  assert.deepEqual(out, { ok: false, reason: "not_received" });
  assert.deepEqual(ctrl.exceptions, [], "no case is opened for a buyer who reported nothing");
  assert.equal(ctrl.pickupRow.possessionDiscrepancy ?? null, null);
});

test("a release CLOSES the PICKUP_MISSED its own sweep raised, instead of stranding the deal", async () => {
  // THE TRAP THIS PHASE BUILT FOR ITSELF. `flagSuspectedNoShows` raises PICKUP_MISSED when an
  // appointment is more than four hours old with no recorded release — and the same file says
  // plainly that handovers run late for ordinary reasons ("paperwork, a delayed valet, a queue")
  // and that the sweep "does not decide that anything was missed". §Stage 20's FOURTEENTH
  // precondition then reads `queueItems` where status is OPEN and blocks on ANY of them.
  //
  // So: a 10:00 appointment, a handover at 15:10, the 15:00 cron in between. The dealership
  // scans, the buyer confirms, and completion refuses with "1 open exception(s) must be resolved:
  // PICKUP_MISSED". PICKUP_MISSED has exactly one writer in this repository and NO resolver — not
  // in `app/`, not in `lib/` — so the buyer has the car and the deal is stuck until an Operations
  // admin closes the item by hand, on a suspicion the release itself disproves.
  //
  // CLOSED rather than RESOLVED: §26's vocabulary is "RESOLVED = the condition was fixed, CLOSED
  // = it no longer applies". Nobody fixed a missed pickup. It was never missed.
  ctrl.openQueueItems = [{ id: "q_1", exceptionCode: "PICKUP_MISSED", status: "OPEN" }];

  const out = await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.deepEqual(out, { ok: true }, "a late handover still completes");
  const closed = ctrl.resolutions.find((r) => r.queueItemId === "q_1");
  assert.ok(closed, "the release must close the suspicion it disproves");
  assert.equal(closed.status, "CLOSED", "it no longer applies — it was not 'fixed'");
  assert.match(String(closed.resolution), /release/i, "the resolution says why it no longer applies");
  assert.equal(ctrl.dealStatus, "COMPLETED");
});

test("a release closes ONLY the missed-pickup suspicion, not every open exception", async () => {
  // The carve-out must not become a general amnesty. A real hold — an identity mismatch, a
  // delivery discrepancy — is exactly what precondition 14 exists to stop, and a recorded release
  // says nothing about either.
  ctrl.openQueueItems = [
    { id: "q_1", exceptionCode: "PICKUP_MISSED", status: "OPEN" },
    { id: "q_2", exceptionCode: "DELIVERY_DISCREPANCY_REPORTED", status: "OPEN" },
  ];

  const out = await (await service()).completeJourneyPickup("deal_1", "admin_1", EVIDENCE);

  assert.equal(out.ok, false, "an unrelated open exception still blocks completion");
  assert.equal(out.ok === false && out.code, "COMPLETION_BLOCKED");
  assert.deepEqual(
    ctrl.resolutions.map((r) => r.queueItemId),
    ["q_1"],
    "only the missed-pickup suspicion is closed",
  );
});

test("a possession confirmation serializes on the DEAL row before it reads or writes anything", async () => {
  // §Stage 20 is terminal and corrections are append-only (owner ruling Q4). Two confirmations
  // both read HANDOVER_PENDING; the second blocked on the PICKUP row inside `tx.pickup.update`,
  // and once the first committed it resumed and overwrote the completed deal's possession
  // evidence — then lost the CAS and returned `alreadyComplete: true`, so the overwrite was
  // silent. Locking the DEAL row first makes the loser block before it reads, and return
  // without writing.
  //
  // WHAT THIS PROVES AND WHAT IT DOES NOT. The unit harness runs the transaction body inline, so
  // it cannot interleave two of them: this asserts the lock is TAKEN, on the right table and the
  // right row, before any read. The interleaving itself needs a real Postgres and belongs with
  // the isolated-database concurrency suite.
  ctrl.dealStatus = "HANDOVER_PENDING";

  await (await service()).confirmPossession({
    dealId: "deal_1",
    buyerId: "buyer_1",
    vehicleReceived: true,
    vinMatch: true,
    odometerAtPossession: 14,
    conditionAsDelivered: "Clean, as described.",
    keysAndAccessoriesReceived: true,
  });

  const lock = ctrl.rowLocks.find((l) => /FOR UPDATE/.test(l));
  assert.ok(lock, "the completion transaction must serialize on a row, or two confirmations race");
  assert.match(lock, /FROM deals/, "the DEAL row is the one both confirmations contend for");
  assert.match(lock, /deal_1/, "and it must lock THIS deal, not take a table-wide lock");
});
