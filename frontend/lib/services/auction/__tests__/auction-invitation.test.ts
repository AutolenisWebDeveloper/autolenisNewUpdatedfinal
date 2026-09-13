// Phase 5 — the unified invitation service, and the regression tests for defects 3, 4 and 5.
//
// Separate from `phase5-defect-regressions.test.ts` because `mock.module` is once-per-specifier
// per FILE: the Prisma fake this service needs (auctions, invitations, firewall entries, a
// reminder sweep) is a different shape from the one the messaging and email tests need, and
// trying to serve both from one fake makes each test's setup invisible.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/auction/__tests__/auction-invitation.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface InvRow {
  id: string;
  auctionId: string;
  rooftopId: string | null;
  dealerId: string | null;
  email: string | null;
  status: string;
  tokenHash: string | null;
  candidateIds: string[];
  distanceMiles: number | null;
  invitationScore: number | null;
  reminder50SentAt: Date | null;
  reminder90SentAt: Date | null;
  declinedAt: Date | null;
  offerSubmittedAt: Date | null;
  respondedAt: Date | null;
  bouncedAt: Date | null;
  dealershipName: string | null;
  contactName: string | null;
  phone: string | null;
  expiresAt: Date | null;
}

interface Ctrl {
  auction: { id: string; status: string; endsAt: Date | null; startedAt: Date | null; vehicleRequestId: string | null } | null;
  invitations: InvRow[];
  firewallEntries: Array<{ auctionId: string; rooftopId: string }>;
  enqueued: Array<Record<string, unknown>>;
  cancelled: Array<string>;
  exceptions: Array<Record<string, unknown>>;
  nextId: number;
  /** Rooftop ids whose INSERT loses a unique race — see the note in the `create` fake. */
  createRaisesP2002For: Set<string>;
  /** What the winning writer left behind, for the loser to re-read. */
  rowsWrittenByTheWinner: InvRow[];
}
let ctrl: Ctrl;

const NOW = new Date("2026-09-11T12:00:00Z");

beforeEach(() => {
  ctrl = {
    auction: {
      id: "a1",
      status: "PENDING",
      endsAt: new Date("2026-09-13T12:00:00Z"),
      startedAt: new Date("2026-09-11T12:00:00Z"),
      vehicleRequestId: "vr1",
    },
    invitations: [],
    firewallEntries: [],
    enqueued: [],
    cancelled: [],
    exceptions: [],
    nextId: 1,
    createRaisesP2002For: new Set<string>(),
    rowsWrittenByTheWinner: [],
  };
});

mock.module("server-only", { namedExports: {}, defaultExport: {} });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

mock.module("@/lib/prisma-savepoint", {
  namedExports: { withSavepoint: async (_db: unknown, fn: () => Promise<unknown>) => fn() },
});

// A token minter with a stable output, so an assertion can be about the SHAPE of what is stored
// (a hash, never the raw token) rather than about randomness.
mock.module("@/lib/services/dealer-recruitment/invitation-token.service", {
  namedExports: {
    issueInvitationToken: () => ({
      rawToken: "RAW_TOKEN_VALUE",
      tokenHash: "HASHED_TOKEN_VALUE",
      expiresAt: new Date("2026-10-11T12:00:00Z"),
    }),
  },
});

mock.module("@/lib/services/dealer-recruitment/unsubscribe-token.service", {
  namedExports: {
    buildUnsubscribeUrl: (email: string) =>
      email === "no-optout@example.com" ? null : `https://app.example/api/public/dealer-unsubscribe?token=${email}`,
  },
});

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Record<string, unknown>) => {
      ctrl.enqueued.push(input);
      return { enqueued: true, id: `ob${ctrl.enqueued.length}`, dedupKey: String(input.idempotencyKey) };
    },
    cancelByKey: async (key: string) => {
      ctrl.cancelled.push(key);
      return { cancelled: 1 };
    },
  },
});

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Record<string, unknown>) => {
      ctrl.exceptions.push(input);
      return { queueItemId: "q1", created: true };
    },
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: {
        findUnique: async () => ctrl.auction,
        findMany: async () => (ctrl.auction && ctrl.auction.status === "ACTIVE" ? [ctrl.auction] : []),
      },
      auctionInvitation: {
        findMany: async (args: { where?: Record<string, unknown> }) => {
          const w = (args?.where ?? {}) as Record<string, unknown>;
          return ctrl.invitations.filter((i) => {
            if (w.auctionId && i.auctionId !== w.auctionId) return false;
            const st = w.status as { in?: string[]; notIn?: string[] } | undefined;
            if (st?.notIn && st.notIn.includes(i.status)) return false;
            if (st?.in && !st.in.includes(i.status)) return false;
            if (w.declinedAt === null && i.declinedAt !== null) return false;
            if (w.offerSubmittedAt === null && i.offerSubmittedAt !== null) return false;
            if (w.respondedAt === null && i.respondedAt !== null) return false;
            if (w.bouncedAt === null && i.bouncedAt !== null) return false;
            return true;
          });
        },
        findFirst: async (args: { where?: Record<string, unknown> }) => {
          const w = (args?.where ?? {}) as Record<string, unknown>;
          return (
            ctrl.invitations.find(
              (i) =>
                i.auctionId === w.auctionId &&
                (w.rooftopId === undefined || i.rooftopId === w.rooftopId) &&
                (w.dealerId === undefined || i.dealerId === w.dealerId),
            ) ?? null
          );
        },
        findUnique: async (args: { where: { id: string } }) =>
          ctrl.invitations.find((i) => i.id === args.where.id) ?? null,
        create: async (args: { data: Record<string, unknown> }) => {
          const d = args.data;
          // THE RACE, SIMULATED. `createRaisesP2002For` makes the INSERT lose to a concurrent
          // writer even though the pre-read saw nothing — which is the only way to reach the
          // create-then-catch-P2002 branch, because `issueInvitations` pre-filters on an in-memory
          // set and would otherwise never attempt the insert. `rowsWrittenByTheWinner` is what the
          // losing writer then re-reads.
          if (d.rooftopId && ctrl.createRaisesP2002For.has(String(d.rooftopId))) {
            for (const row of ctrl.rowsWrittenByTheWinner) {
              if (!ctrl.invitations.some((i) => i.id === row.id)) ctrl.invitations.push(row);
            }
            throw Object.assign(new Error("unique"), { code: "P2002" });
          }
          // The real partial unique: one live invitation per (auction, rooftop).
          if (
            d.rooftopId &&
            ctrl.invitations.some((i) => i.auctionId === d.auctionId && i.rooftopId === d.rooftopId)
          ) {
            throw Object.assign(new Error("unique"), { code: "P2002" });
          }
          const row: InvRow = {
            id: `inv${ctrl.nextId++}`,
            auctionId: String(d.auctionId),
            rooftopId: (d.rooftopId as string | null) ?? null,
            dealerId: (d.dealerId as string | null) ?? null,
            email: (d.email as string | null) ?? null,
            status: String(d.status ?? "QUEUED"),
            tokenHash: (d.tokenHash as string | null) ?? null,
            candidateIds: (d.candidateIds as string[]) ?? [],
            distanceMiles: (d.distanceMiles as number | null) ?? null,
            invitationScore: (d.invitationScore as number | null) ?? null,
            reminder50SentAt: null,
            reminder90SentAt: null,
            declinedAt: null,
            offerSubmittedAt: null,
            respondedAt: null,
            bouncedAt: null,
            dealershipName: (d.dealershipName as string | null) ?? null,
            contactName: (d.contactName as string | null) ?? null,
            phone: (d.phone as string | null) ?? null,
            expiresAt: (d.expiresAt as Date | null) ?? null,
          };
          ctrl.invitations.push(row);
          return { id: row.id };
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = ctrl.invitations.find((i) => i.id === args.where.id);
          if (row) Object.assign(row, args.data);
          return row ?? {};
        },
        // HONOURS ITS `where`. It used to return `ctrl.invitations.length` regardless, so
        // `countReachedInvitations`' `status: { notIn: ["REPLACED","BOUNCED","EXPIRED"] }` — the
        // clause its own doc comment calls load-bearing, because a bounced invitation reached
        // nobody — could be deleted without failing a test. Found by the independent review.
        count: async (args?: { where?: { status?: { notIn?: string[] } } }) => {
          const notIn = args?.where?.status?.notIn ?? [];
          return ctrl.invitations.filter((i) => !notIn.includes(String(i.status))).length;
        },
      },
      outsideAuctionInvite: { count: async () => 0 },
      identityFirewallEntry: {
        upsert: async (args: { create: Record<string, unknown> }) => {
          ctrl.firewallEntries.push({
            auctionId: String(args.create.auctionId),
            rooftopId: String(args.create.rooftopId),
          });
          return {};
        },
      },
      vehicleRequest: {
        findUnique: async () => ({
          makePreference: "Toyota",
          modelPreference: "Camry",
          yearMin: 2021,
          yearMax: 2023,
          maxMileage: 60000,
          requiredFeatures: ["Apple CarPlay"],
          preferredFeatures: ["Sunroof"],
          city: "Dallas",
          state: "TX",
          zip: "75201",
          tradeElected: true,
          deliveryPreference: "PICKUP",
        }),
      },
    },
  },
});

/** A complete `InvRow`, so a fixture cannot silently omit a column the code under test reads. */
function invRow(over: Partial<InvRow> = {}): InvRow {
  return {
    id: "inv_x", auctionId: "a1", rooftopId: "rt_x", dealerId: null, email: "sales@example.com",
    status: "SENT", tokenHash: "h", candidateIds: [], distanceMiles: 10, invitationScore: null,
    reminder50SentAt: null, reminder90SentAt: null, declinedAt: null, offerSubmittedAt: null,
    respondedAt: null, bouncedAt: null, dealershipName: "Example", contactName: "Sales",
    phone: null, expiresAt: null,
    ...over,
  };
}

function target(over: Partial<Record<string, unknown>> = {}) {
  return {
    rooftopId: "rt1",
    dealerId: null,
    dealershipName: "Example Motors",
    contactName: "Sales",
    email: "sales@example.com",
    phone: null,
    distanceMiles: 10,
    candidateIds: ["cand1"],
    invitationScore: 50,
    ...over,
  } as never;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFECT 4 — the cap and the deterministic order
// ─────────────────────────────────────────────────────────────────────────────
//
// FAILING-FIRST. `app/api/admin/buyers/[buyerId]/launch-auction/route.ts` validated `dealerIds`
// as `z.array(z.string().min(1)).min(1)` with NO `.max()` — while `outsideDealers` on the same
// schema was `.max(8)` — and then wrote the rows with a bare `prisma.auctionInvitation.createMany`.
// Its dealer lookup had no `orderBy`, so the order was database order. There was no service to
// hold a cap, which is why the cap could be missing from one pool and present on the other.

test("defect 4a: the field is capped at eight however many targets are handed over", async () => {
  const { issueInvitations, } = await import("@/lib/services/auction/auction-invitation.service");
  const targets = Array.from({ length: 14 }, (_, i) =>
    target({ rooftopId: `rt${i}`, email: `d${i}@example.com`, invitationScore: 100 - i }),
  );
  const r = await issueInvitations("a1", targets, undefined, NOW);
  assert.equal(r.issued, 8, "§6c's invitation budget is eight rooftops");
  assert.equal(r.skipped.filter((s) => s.reason === "FIELD_CAP_REACHED").length, 6);
});

test("defect 4b: the cap counts the EXISTING field, not just this call's batch", async () => {
  // A second round after a bounce replacement must not take the field past eight. A cap applied
  // per-call would have allowed 8 + 8.
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  await issueInvitations(
    "a1",
    Array.from({ length: 6 }, (_, i) => target({ rooftopId: `rt${i}`, email: `d${i}@example.com` })),
    undefined,
    NOW,
  );
  const second = await issueInvitations(
    "a1",
    Array.from({ length: 6 }, (_, i) => target({ rooftopId: `x${i}`, email: `x${i}@example.com` })),
    undefined,
    NOW,
  );
  assert.equal(second.issued, 2, "only two slots remained");
  assert.equal(ctrl.invitations.length, 8);
});

test("defect 4c: ordering is deterministic — the same eight, whatever order they arrive in", async () => {
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  const mk = () =>
    Array.from({ length: 12 }, (_, i) =>
      target({ rooftopId: `rt${String(i).padStart(2, "0")}`, email: `d${i}@example.com`, invitationScore: 50, distanceMiles: 10 }),
    );

  const forwards = mk();
  await issueInvitations("a1", forwards, undefined, NOW);
  const chosenForwards = ctrl.invitations.map((i) => i.rooftopId).sort();

  // Reset and feed the identical set in reverse. Identical score and distance means the only
  // separator is the id, which is exactly the tie-break defect 4 lacked.
  ctrl.invitations = [];
  ctrl.nextId = 1;
  const backwards = mk().reverse();
  await issueInvitations("a1", backwards, undefined, NOW);
  const chosenBackwards = ctrl.invitations.map((i) => i.rooftopId).sort();

  assert.deepEqual(chosenForwards, chosenBackwards, "input order must not change who is invited");
  assert.deepEqual(chosenForwards, ["rt00", "rt01", "rt02", "rt03", "rt04", "rt05", "rt06", "rt07"]);
});

test("defect 4d: a higher score wins a slot over a lower one", async () => {
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  const targets = [
    target({ rooftopId: "low", email: "low@example.com", invitationScore: 1 }),
    ...Array.from({ length: 8 }, (_, i) =>
      target({ rooftopId: `hi${i}`, email: `hi${i}@example.com`, invitationScore: 90 }),
    ),
  ];
  await issueInvitations("a1", targets, undefined, NOW);
  assert.ok(!ctrl.invitations.some((i) => i.rooftopId === "low"), "the lowest score loses the slot");
});

// ─────────────────────────────────────────────────────────────────────────────
// The invitation itself — tokenised, no buyer identity, real deadline
// ─────────────────────────────────────────────────────────────────────────────

test("S7-10: only the token HASH is persisted; the raw token goes in the link", async () => {
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  await issueInvitations("a1", [target()], undefined, NOW);
  const row = ctrl.invitations[0]!;
  assert.equal(row.tokenHash, "HASHED_TOKEN_VALUE");
  assert.ok(
    !JSON.stringify(row).includes("RAW_TOKEN_VALUE"),
    "the raw token must never be stored on the invitation row",
  );
  const html = String((ctrl.enqueued[0]!.payload as Record<string, unknown>).html);
  assert.ok(html.includes("RAW_TOKEN_VALUE"), "the emailed link carries the raw token");
});

test("S7-10: the token expires with the AUCTION, not on a recruitment TTL", async () => {
  // `OutsideAuctionInvite.expiresAt` was created to stop a stale link being replayed into a
  // reopened auction; an invitation that outlived its auction would reintroduce that.
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  await issueInvitations("a1", [target()], undefined, NOW);
  assert.equal(ctrl.invitations[0]!.expiresAt?.toISOString(), ctrl.auction!.endsAt!.toISOString());
});

test("S7-13 / §25.1: the invitation carries NO buyer identity", async () => {
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  await issueInvitations("a1", [target()], undefined, NOW);
  const payload = ctrl.enqueued[0]!.payload as Record<string, unknown>;
  const body = `${payload.subject} ${payload.html} ${payload.text}`;
  // The general location §25.1 permits IS present; identity is not.
  assert.ok(body.includes("Dallas"), "general location is permitted and expected");
  for (const forbidden of ["@buyer", "buyer@", "75201 Main", "Social", "SSN"]) {
    assert.ok(!body.includes(forbidden), `invitation must not contain ${forbidden}`);
  }
  // And the payload has no field that could carry one.
  assert.ok(!("buyerName" in payload) && !("buyerEmail" in payload) && !("buyerPhone" in payload));
});

test("25-10: issuing an invitation writes a WITHHELD firewall entry, and never a LIFTED one", async () => {
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  await issueInvitations("a1", [target()], undefined, NOW);
  assert.deepEqual(ctrl.firewallEntries, [{ auctionId: "a1", rooftopId: "rt1" }]);
});

test("defect 1: every dealer send declares the FULL suppression tier and a token opt-out", async () => {
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  await issueInvitations("a1", [target()], undefined, NOW);
  const payload = ctrl.enqueued[0]!.payload as Record<string, unknown>;
  assert.equal(payload.suppressionTier, "full");
  assert.ok(String(payload.listUnsubscribeUrl).includes("dealer-unsubscribe"));
  assert.ok(String(payload.html).includes("Stop receiving auction invitations"));
});

test("an invitation with no working opt-out is REFUSED rather than sent", async () => {
  // `buildUnsubscribeUrl` returns null when no signing secret is provisioned. Sending solicited
  // B2B mail to an address that never opted in, with no way to stop it, is the thing defect 1 is
  // about — so the honest failure is to refuse and let readiness name the blocker.
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  const r = await issueInvitations("a1", [target({ email: "no-optout@example.com" })], undefined, NOW);
  assert.equal(r.issued, 0);
  assert.equal(r.skipped[0]!.reason, "NO_UNSUBSCRIBE_CHANNEL");
  assert.equal(ctrl.enqueued.length, 0);
});

test("a target with neither rooftop nor dealer is refused — nothing would dedup it", async () => {
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  const r = await issueInvitations("a1", [target({ rooftopId: null, dealerId: null })], undefined, NOW);
  assert.equal(r.issued, 0);
  assert.equal(r.skipped[0]!.reason, "NO_DEDUP_KEY");
});

test("re-issuing for the same rooftop does NOT rotate the token already in the inbox", async () => {
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  await issueInvitations("a1", [target()], undefined, NOW);
  const firstHash = ctrl.invitations[0]!.tokenHash;
  const again = await issueInvitations("a1", [target()], undefined, NOW);
  assert.equal(again.issued, 0);
  assert.equal(again.skipped[0]!.reason, "ALREADY_INVITED");
  assert.equal(ctrl.invitations.length, 1);
  assert.equal(ctrl.invitations[0]!.tokenHash, firstHash);
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFECT 5 — one reminder schedule, and the cross-rail key collision
// ─────────────────────────────────────────────────────────────────────────────
//
// FAILING-FIRST, and this is the defect that needs the most care to state.
//
// Two legacy rails both called `sendDealerAuctionReminderEmail`, whose idempotency key is
// `dealer-auction-reminder-${auctionId}-${to}` (`resend.service.ts:1671`). The hourly
// `dealer-invitation-reminder` cron fired in a 5h–7h-to-deadline window and consumed that key;
// `auction-close`, running every five minutes over auctions ending within 2h, then got DUPLICATE
// (`:200-202`) on every attempt — and because DUPLICATE is a RESOLVED value rather than a
// rejection, the `.catch(() => {})` at `auction-close/route.ts:90` could not see it. The ≤2h
// "submit your offer" notice was never delivered to any dealer who received the 6h one.
//
// The assertion below is the structural property that makes that impossible: the two reminders
// carry DIFFERENT keys, and each key is scoped to the invitation rather than to the address.

test("defect 5a: the 50% and 90% reminders carry different, invitation-scoped keys", async () => {
  const { sweepInvitationReminders } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.auction = {
    id: "a1",
    status: "ACTIVE",
    startedAt: new Date("2026-09-11T00:00:00Z"),
    endsAt: new Date("2026-09-13T00:00:00Z"),
    vehicleRequestId: "vr1",
  };
  ctrl.invitations = [
    {
      id: "inv1", auctionId: "a1", rooftopId: "rt1", dealerId: null, email: "sales@example.com",
      status: "SENT", tokenHash: "h", candidateIds: [], distanceMiles: 10, invitationScore: null,
      reminder50SentAt: null, reminder90SentAt: null, declinedAt: null, offerSubmittedAt: null,
      respondedAt: null, bouncedAt: null, dealershipName: "Example", contactName: "Sales",
      phone: null, expiresAt: null,
    },
  ];

  // TWO TICKS, BECAUSE ONE REMINDER FIRES PER TICK.
  //
  // An earlier version of this test drove the sweep once at 95% elapsed and asserted BOTH
  // reminders went out together — which pinned a defect the independent review found: a cron that
  // missed two hours and resumed at 95% sent "Halfway — 3h left" and "Closing soon — 3h left"
  // seconds apart, one of them false. Past 90% the halfway reminder has nothing true to say.
  //
  // The test's real subject is the KEYS, and they are still proved: each is scoped to the
  // invitation rather than to the address (defect 5's collision was an auction-scoped key against
  // a globally unique `comms_outbox.dedup_key`), and the two are distinct so neither can suppress
  // the other.
  const at60 = new Date("2026-09-12T04:48:00Z"); // 60% elapsed
  const first = await sweepInvitationReminders(undefined, at60);
  assert.equal(first.enqueued50, 1);
  assert.equal(first.enqueued90, 0, "the 90% reminder is not due at 60%");

  // Carry the stamp forward the way the database would, then tick again past 90%.
  ctrl.invitations[0]!.reminder50SentAt = at60;
  const at95 = new Date("2026-09-12T21:36:00Z");
  const second = await sweepInvitationReminders(undefined, at95);
  assert.equal(second.enqueued90, 1);
  assert.equal(second.enqueued50, 0, "the 50% reminder is not re-sent");

  const keys = ctrl.enqueued.map((e) => String(e.idempotencyKey));
  assert.equal(new Set(keys).size, 2, "two distinct keys — neither can suppress the other");
  assert.ok(keys.every((k) => k.includes("inv1")), "each key is scoped to the invitation, not the address");
  assert.ok(keys.some((k) => k.includes("reminder_50")) && keys.some((k) => k.includes("reminder_90")));
});

test("past 90%, the halfway reminder is NOT sent — one reminder per tick, the later one wins", async () => {
  // The review's finding, pinned. A dealership must not be told the auction is halfway through
  // when it has 5% of its window left.
  const { sweepInvitationReminders } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.auction = {
    id: "a1", status: "ACTIVE",
    startedAt: new Date("2026-09-11T00:00:00Z"),
    endsAt: new Date("2026-09-13T00:00:00Z"),
    vehicleRequestId: "vr1",
  };
  ctrl.invitations = [
    {
      id: "inv1", auctionId: "a1", rooftopId: "rt1", dealerId: null, email: "sales@example.com",
      status: "SENT", tokenHash: "h", candidateIds: [], distanceMiles: 10, invitationScore: null,
      reminder50SentAt: null, reminder90SentAt: null, declinedAt: null, offerSubmittedAt: null,
      respondedAt: null, bouncedAt: null, dealershipName: "Example", contactName: "Sales",
      phone: null, expiresAt: null,
    },
  ];

  const r = await sweepInvitationReminders(undefined, new Date("2026-09-12T21:36:00Z"));
  assert.equal(r.enqueued90, 1);
  assert.equal(r.enqueued50, 0, "the halfway reminder fired on a 95%-elapsed auction");
  assert.equal(ctrl.enqueued.length, 1, "two reminders reached the outbox in one tick");
  assert.match(String(ctrl.enqueued[0]!.idempotencyKey), /reminder_90/);
});

test("defect 5b: reminders go to NONRESPONDERS only — respondedAt is honoured", async () => {
  // The legacy hourly cron SELECTED `respondedAt` (`:48`) and never used it (`:93-97` skipped only
  // on a SUBMITTED offer), so a dealership that had declined or bounced was chased anyway.
  const { sweepInvitationReminders } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.auction = {
    id: "a1", status: "ACTIVE",
    startedAt: new Date("2026-09-11T00:00:00Z"),
    endsAt: new Date("2026-09-13T00:00:00Z"),
    vehicleRequestId: "vr1",
  };
  const base = {
    auctionId: "a1", rooftopId: "rt", dealerId: null, email: "x@example.com", status: "SENT",
    tokenHash: "h", candidateIds: [], distanceMiles: 10, invitationScore: null,
    reminder50SentAt: null, reminder90SentAt: null, declinedAt: null, offerSubmittedAt: null,
    respondedAt: null, bouncedAt: null, dealershipName: "X", contactName: null, phone: null,
    expiresAt: null,
  };
  ctrl.invitations = [
    { ...base, id: "open", rooftopId: "rt_open" },
    { ...base, id: "declined", rooftopId: "rt_d", declinedAt: NOW },
    { ...base, id: "bid", rooftopId: "rt_b", offerSubmittedAt: NOW },
    { ...base, id: "responded", rooftopId: "rt_r", respondedAt: NOW },
    { ...base, id: "bounced", rooftopId: "rt_x", bouncedAt: NOW },
  ] as InvRow[];

  await sweepInvitationReminders(undefined, new Date("2026-09-12T01:00:00Z"));
  const reminded = ctrl.enqueued.map((e) => ((e.payload as Record<string, unknown>).invitationId));
  assert.deepEqual(reminded, ["open"], "only the dealership that has not answered is reminded");
});

test("defect 5c: a reminder is enqueued once — the stamp is the idempotency", async () => {
  const { sweepInvitationReminders } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.auction = {
    id: "a1", status: "ACTIVE",
    startedAt: new Date("2026-09-11T00:00:00Z"),
    endsAt: new Date("2026-09-13T00:00:00Z"),
    vehicleRequestId: "vr1",
  };
  ctrl.invitations = [
    {
      id: "inv1", auctionId: "a1", rooftopId: "rt1", dealerId: null, email: "sales@example.com",
      status: "SENT", tokenHash: "h", candidateIds: [], distanceMiles: 10, invitationScore: null,
      reminder50SentAt: null, reminder90SentAt: null, declinedAt: null, offerSubmittedAt: null,
      respondedAt: null, bouncedAt: null, dealershipName: "Example", contactName: null,
      phone: null, expiresAt: null,
    },
  ];
  const at60 = new Date("2026-09-12T04:00:00Z");
  await sweepInvitationReminders(undefined, at60);
  assert.equal(ctrl.enqueued.length, 1);
  // `reminder50SentAt` is now stamped — the columns Phase 1 provisioned and nothing ever wrote.
  assert.ok(ctrl.invitations[0]!.reminder50SentAt instanceof Date);
  // A second tick at the same point must add nothing.
  await sweepInvitationReminders(undefined, at60);
  assert.equal(ctrl.enqueued.length, 1, "the sweep is idempotent per invitation per threshold");
});

test("defect 5d: the reminder window is a FRACTION of the real auction, not a fixed offset", async () => {
  // All three legacy rails hard-coded hours (+24h/+42h, a 5h–7h window, ≤2h), so an auction whose
  // `endsAt` was overridden — the admin route accepts 1–168h — got reminders at the wrong moments
  // or not at all. A six-hour auction must still get its 50% reminder at three hours.
  const { sweepInvitationReminders } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.auction = {
    id: "a1", status: "ACTIVE",
    startedAt: new Date("2026-09-11T00:00:00Z"),
    endsAt: new Date("2026-09-11T06:00:00Z"), // a six-hour auction
    vehicleRequestId: "vr1",
  };
  ctrl.invitations = [
    {
      id: "inv1", auctionId: "a1", rooftopId: "rt1", dealerId: null, email: "s@example.com",
      status: "SENT", tokenHash: "h", candidateIds: [], distanceMiles: 1, invitationScore: null,
      reminder50SentAt: null, reminder90SentAt: null, declinedAt: null, offerSubmittedAt: null,
      respondedAt: null, bouncedAt: null, dealershipName: "E", contactName: null, phone: null,
      expiresAt: null,
    },
  ];
  // Two hours in — 33% elapsed — nothing is due.
  await sweepInvitationReminders(undefined, new Date("2026-09-11T02:00:00Z"));
  assert.equal(ctrl.enqueued.length, 0);
  // Three hours in — 50% — the first reminder is due.
  await sweepInvitationReminders(undefined, new Date("2026-09-11T03:00:00Z"));
  assert.equal(ctrl.enqueued.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bounce, replacement, decline
// ─────────────────────────────────────────────────────────────────────────────

test("S7-21: a bounce raises the Ops contact-replacement exception and cancels the reminders", async () => {
  const { handleInvitationBounce } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.invitations = [
    {
      id: "inv1", auctionId: "a1", rooftopId: "rt1", dealerId: null, email: "bad@example.com",
      status: "SENT", tokenHash: "h", candidateIds: [], distanceMiles: 10, invitationScore: null,
      reminder50SentAt: null, reminder90SentAt: null, declinedAt: null, offerSubmittedAt: null,
      respondedAt: null, bouncedAt: null, dealershipName: "Bad Address Motors", contactName: null,
      phone: null, expiresAt: null,
    },
  ];
  await handleInvitationBounce("inv1", undefined, NOW);
  assert.equal(ctrl.invitations[0]!.status, "BOUNCED");
  assert.equal(ctrl.exceptions.length, 1);
  assert.equal(ctrl.exceptions[0]!.code, "INVITATION_BOUNCED");
  assert.ok(ctrl.cancelled.some((k) => k.includes("rt1")), "outstanding reminders are cancelled");
});

test("S7-24: a decline is idempotent and stops the reminders", async () => {
  const { declineInvitation } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.invitations = [
    {
      id: "inv1", auctionId: "a1", rooftopId: "rt1", dealerId: "d1", email: "s@example.com",
      status: "SENT", tokenHash: "h", candidateIds: [], distanceMiles: 10, invitationScore: null,
      reminder50SentAt: null, reminder90SentAt: null, declinedAt: null, offerSubmittedAt: null,
      respondedAt: null, bouncedAt: null, dealershipName: "E", contactName: null, phone: null,
      expiresAt: null,
    },
  ];
  const first = await declineInvitation("inv1", undefined, NOW);
  assert.deepEqual(first, { ok: true, alreadyDeclined: false });
  assert.equal(ctrl.invitations[0]!.status, "DECLINED");
  assert.ok(ctrl.cancelled.length >= 1);

  const second = await declineInvitation("inv1", undefined, NOW);
  assert.deepEqual(second, { ok: true, alreadyDeclined: true }, "a second click is not an error");
});

test("S7-24: a dealer who already bid cannot 'decline' — that is a withdrawal, Phase 6's", async () => {
  const { declineInvitation } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.invitations = [
    {
      id: "inv1", auctionId: "a1", rooftopId: "rt1", dealerId: "d1", email: "s@example.com",
      status: "OFFER_SUBMITTED", tokenHash: "h", candidateIds: [], distanceMiles: 10,
      invitationScore: null, reminder50SentAt: null, reminder90SentAt: null, declinedAt: null,
      offerSubmittedAt: NOW, respondedAt: null, bouncedAt: null, dealershipName: "E",
      contactName: null, phone: null, expiresAt: null,
    },
  ];
  const r = await declineInvitation("inv1", undefined, NOW);
  assert.equal(r.ok, false);
  assert.equal(ctrl.invitations[0]!.status, "OFFER_SUBMITTED", "the offer stands");
});

test("S7-14b: delivery events are MONOTONIC — an out-of-order webhook cannot walk the status back", async () => {
  // Resend can deliver `email.opened` before `email.delivered`. A last-write-wins update would
  // move the invitation from OPENED back to DELIVERED and make the funnel lie.
  const { recordInvitationEvent } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.invitations = [
    {
      id: "inv1", auctionId: "a1", rooftopId: "rt1", dealerId: null, email: "s@example.com",
      status: "SENT", tokenHash: "h", candidateIds: [], distanceMiles: 10, invitationScore: null,
      reminder50SentAt: null, reminder90SentAt: null, declinedAt: null, offerSubmittedAt: null,
      respondedAt: null, bouncedAt: null, dealershipName: "E", contactName: null, phone: null,
      expiresAt: null,
    },
  ];
  const opened = await recordInvitationEvent("inv1", "OPENED", undefined, NOW);
  assert.equal(opened.statusAdvanced, true);
  assert.equal(ctrl.invitations[0]!.status, "OPENED");

  const late = await recordInvitationEvent("inv1", "DELIVERED", undefined, NOW);
  assert.equal(late.ok, true, "the event is still recorded — the fact happened");
  assert.equal(late.statusAdvanced, false);
  assert.equal(ctrl.invitations[0]!.status, "OPENED", "the status never goes backwards");
});

test("defect 6: a BOUNCED invitation is excluded from the reached count — it reached nobody", async () => {
  // The exclusion the doc comment calls load-bearing, now actually provable: the fake's `count`
  // honours its `where`. Deleting `status: { notIn: [...] }` from `countReachedInvitations` fails
  // here, which it previously did not.
  const { countReachedInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.invitations = [
    invRow({ id: "i1", rooftopId: "rt1", status: "SENT" }),
    invRow({ id: "i2", rooftopId: "rt2", status: "BOUNCED" }),
    invRow({ id: "i3", rooftopId: "rt3", status: "REPLACED" }),
    invRow({ id: "i4", rooftopId: "rt4", status: "EXPIRED" }),
    invRow({ id: "i5", rooftopId: "rt5", status: "OPENED" }),
  ];

  const counted = await countReachedInvitations("a1");
  assert.equal(
    counted.unified,
    2,
    "a bounced, replaced or expired invitation must not be counted as a dealership reached — " +
      "otherwise the buyer is told a dealership is competing that was never contacted",
  );
  assert.equal(counted.total, 2);
});

test("the P2002 losing writer re-reads the winner's row rather than failing the field", async () => {
  // THE CONCURRENCY PATH, PREVIOUSLY UNPROVEN. `issueInvitations` pre-filters on an in-memory
  // `alreadyInvited` set, so the fake's unique violation was unreachable and the
  // create-then-catch-P2002 branch — `withSavepoint` + re-read + `if (!won) throw err` — had no
  // test at all. A regression there (a savepoint that does not roll back, so the re-read throws
  // 25P02 on an aborted transaction) would have been caught by nothing. Found by the independent
  // review.
  //
  // The race is simulated the way it actually happens: the pre-read sees nothing, and the INSERT
  // loses to a concurrent writer.
  const { issueInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.invitations = [];
  ctrl.createRaisesP2002For = new Set(["rt_raced"]);
  ctrl.rowsWrittenByTheWinner = [invRow({ id: "inv_winner", rooftopId: "rt_raced", status: "QUEUED" })];

  const res = await issueInvitations("a1", [target({ rooftopId: "rt_raced" })], undefined, NOW);

  assert.equal(res.issued, 0, "the losing writer must not count the winner's row as its own issue");
  assert.deepEqual(
    res.skipped.map((s) => s.reason),
    ["ALREADY_INVITED_CONCURRENTLY"],
    "a lost race is a distinct, named outcome — not WRITE_FAILED and not silence",
  );
});
