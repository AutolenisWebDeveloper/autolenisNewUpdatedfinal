// Ruling B (owner, 2026-09-13) — an invited OUTSIDE rooftop that claims a dealer account.
//
// THE GAP. Stage 7 invites outside dealerships as `auction_invitations` rows carrying a
// `rooftop_id` and a NULL `dealer_id`. Every dealer-portal action scopes on `dealer_id`.
// So a rooftop that is invited, then claims an account, still cannot act on the auction it
// was invited to: the session is authorised, but no row connects it to the invitation.
//
// THE RULING. Make the DATA match the authorisation that already exists — write `dealerId`
// onto the EXISTING invitation row at claim time — rather than widening the server to accept
// a rooftop match wherever it scopes on `dealer_id`. Widening is an authorisation change and
// wants §13-D37's security batch; this needs neither.
//
// WHY THIS COULD NOT SHIP BEFORE MIGRATION 110. Writing `dealer_id` onto a row is exactly the
// insert-shaped collision the status-blind `(auction_id, dealer_id)` unique produced: a
// REPLACED sibling from contact replacement occupied the slot. 110 made both uniques partial
// on `status <> 'REPLACED'`, so the only remaining collision is the real one — the dealer
// already holds a LIVE invitation to that same auction — which this service must SKIP rather
// than let abort the dealer's claim.
//
// Run: pnpm test (this directory is in the base glob)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Row {
  id: string;
  auctionId: string;
  rooftopId: string | null;
  dealerId: string | null;
  status: string;
  isRegisteredDealer: boolean;
  expiresAt: Date | null;
  auctionStatus: string;
}

interface Ctrl {
  rows: Row[];
  /** Raw SQL the service issued — the savepoint proof. */
  raw: string[];
  /** `currentAuctionLoad` deltas applied per dealer, so the +1 can be proven paired. */
  load: Record<string, number>;
}
let ctrl: Ctrl;

const NOW = new Date("2026-09-13T12:00:00Z");
const SOON = new Date("2026-09-15T12:00:00Z");
const PAST = new Date("2026-09-12T12:00:00Z");

function row(over: Partial<Row> = {}): Row {
  return {
    id: "inv_1",
    auctionId: "auc_1",
    rooftopId: "rt_1",
    dealerId: null,
    status: "SENT",
    isRegisteredDealer: false,
    expiresAt: SOON,
    auctionStatus: "ACTIVE",
    ...over,
  };
}

beforeEach(() => {
  ctrl = { rows: [row()], raw: [], load: {} };
});

mock.module("server-only", { namedExports: {}, defaultExport: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});
// The service module imports the real client at load time. Nothing here uses it: every call
// below passes its own `db`, which is the same injection the claim transaction uses.
mock.module("@/lib/prisma", { namedExports: { prisma: {} } });

/** Applies the `where` the service actually sends, so a dropped clause fails a test. */
function selectRows(where: Record<string, unknown>): Row[] {
  const st = (where.status as { in?: string[] } | undefined)?.in;
  const auctionIn = (
    (where.auction as { status?: { in?: string[] } } | undefined)?.status?.in
  );
  const or = where.OR as Array<Record<string, unknown>> | undefined;
  return ctrl.rows.filter((r) => {
    if (where.rooftopId !== undefined && r.rooftopId !== where.rooftopId) return false;
    if (where.dealerId === null && r.dealerId !== null) return false;
    if (st && !st.includes(r.status)) return false;
    if (auctionIn && !auctionIn.includes(r.auctionStatus)) return false;
    if (or) {
      const live = or.some((clause) => {
        if ("expiresAt" in clause && clause.expiresAt === null) return r.expiresAt === null;
        const gt = (clause.expiresAt as { gt?: Date } | undefined)?.gt;
        return gt ? r.expiresAt !== null && r.expiresAt > gt : false;
      });
      if (!live) return false;
    }
    return true;
  });
}

/** A top-level-client fake: it HAS `$transaction`, so no savepoint is issued. */
function topLevelDb() {
  return {
    $transaction: async () => {},
    dealer: {
      update: async (args: { where: { id: string }; data: { currentAuctionLoad?: { increment?: number } } }) => {
        const by = args.data.currentAuctionLoad?.increment ?? 0;
        ctrl.load[args.where.id] = (ctrl.load[args.where.id] ?? 0) + by;
        return {};
      },
    },
    auctionInvitation: {
      findMany: async (args: { where: Record<string, unknown> }) =>
        selectRows(args.where).map((r) => ({ id: r.id, auctionId: r.auctionId })),
      updateMany: async (args: {
        where: { id: string; dealerId: null };
        data: Record<string, unknown>;
      }) => {
        const target = ctrl.rows.find((r) => r.id === args.where.id)!;
        const nextDealer = args.data.dealerId as string;
        // The real partial unique: one LIVE row per (auction_id, dealer_id). A REPLACED
        // sibling does NOT occupy the slot — that is migration 110.
        const clash = ctrl.rows.some(
          (r) =>
            r.id !== target.id &&
            r.auctionId === target.auctionId &&
            r.dealerId === nextDealer &&
            r.status !== "REPLACED",
        );
        if (clash) throw Object.assign(new Error("unique"), { code: "P2002" });
        // The compare-and-set: `dealerId: null` is part of the predicate, so a row another
        // run already linked matches nothing and is not written or counted again.
        if (args.where.dealerId === null && target.dealerId !== null) return { count: 0 };
        Object.assign(target, args.data);
        return { count: 1 };
      },
    },
  };
}

/** A transaction-client fake: NO `$transaction`, so `withSavepoint` must wrap each write. */
function txDb() {
  const base = topLevelDb() as Record<string, unknown>;
  delete base.$transaction;
  base.$executeRawUnsafe = async (sql: string) => {
    ctrl.raw.push(sql.split(" ").slice(0, 2).join(" "));
    return 0;
  };
  return base;
}

async function link(db: unknown, rooftopId = "rt_1", dealerId = "dlr_1") {
  const { linkRooftopInvitationsToDealer } = await import(
    "@/lib/services/auction/auction-invitation.service"
  );
  return linkRooftopInvitationsToDealer(
    rooftopId,
    dealerId,
    db as Parameters<typeof linkRooftopInvitationsToDealer>[2],
    NOW,
  );
}

test("a live outside invitation for the rooftop gains the claiming dealer's id", async () => {
  const res = await link(topLevelDb());
  assert.deepEqual(res, { linked: 1, alreadyInvited: 0 });
  assert.equal(ctrl.rows[0]!.dealerId, "dlr_1");
});

test("it writes ONLY dealerId — the outside-dealership provenance is not rewritten", async () => {
  // `isRegisteredDealer` records what the invitation WAS when it was issued. Nothing reads it,
  // and flipping it would silently restate history for no functional gain.
  await link(topLevelDb());
  assert.equal(ctrl.rows[0]!.isRegisteredDealer, false);
  assert.equal(ctrl.rows[0]!.status, "SENT");
});

test("another rooftop's invitation is never touched", async () => {
  ctrl.rows = [row({ id: "inv_other", rooftopId: "rt_2" })];
  const res = await link(topLevelDb());
  assert.deepEqual(res, { linked: 0, alreadyInvited: 0 });
  assert.equal(ctrl.rows[0]!.dealerId, null);
});

test("a row that already carries a dealerId is left as it is", async () => {
  ctrl.rows = [row({ dealerId: "someone_else" })];
  const res = await link(topLevelDb());
  assert.deepEqual(res, { linked: 0, alreadyInvited: 0 });
  assert.equal(ctrl.rows[0]!.dealerId, "someone_else");
});

for (const status of ["DECLINED", "RESPONDED", "OFFER_SUBMITTED", "EXPIRED", "REPLACED", "BOUNCED"]) {
  test(`a ${status} invitation is not linked — the dealership already answered or the row is dead`, async () => {
    ctrl.rows = [row({ status })];
    const res = await link(topLevelDb());
    assert.deepEqual(res, { linked: 0, alreadyInvited: 0 });
    assert.equal(ctrl.rows[0]!.dealerId, null);
  });
}

for (const auctionStatus of ["CLOSED", "EXPIRED", "CANCELLED"]) {
  test(`an invitation whose auction is ${auctionStatus} is not linked`, async () => {
    ctrl.rows = [row({ auctionStatus })];
    const res = await link(topLevelDb());
    assert.deepEqual(res, { linked: 0, alreadyInvited: 0 });
    assert.equal(ctrl.rows[0]!.dealerId, null);
  });
}

test("a PENDING auction still links — the invitation is issued before launch", async () => {
  ctrl.rows = [row({ auctionStatus: "PENDING" })];
  const res = await link(topLevelDb());
  assert.deepEqual(res, { linked: 1, alreadyInvited: 0 });
});

test("an invitation past its OWN expiry is not linked, even while the auction is live", async () => {
  ctrl.rows = [row({ expiresAt: PAST })];
  const res = await link(topLevelDb());
  assert.deepEqual(res, { linked: 0, alreadyInvited: 0 });
  assert.equal(ctrl.rows[0]!.dealerId, null);
});

test("an invitation with no expiry set still links", async () => {
  ctrl.rows = [row({ expiresAt: null })];
  const res = await link(topLevelDb());
  assert.deepEqual(res, { linked: 1, alreadyInvited: 0 });
});

test("P2002 — the dealer already holds a live invitation to that auction — is skipped, not fatal", async () => {
  ctrl.rows = [
    row({ id: "inv_rooftop", auctionId: "auc_1" }),
    // The dealer's own registered invitation to the SAME auction occupies the slot.
    row({ id: "inv_registered", auctionId: "auc_1", rooftopId: null, dealerId: "dlr_1", isRegisteredDealer: true }),
    // A second auction, where nothing is in the way.
    row({ id: "inv_second", auctionId: "auc_2" }),
  ];
  const res = await link(topLevelDb());
  assert.deepEqual(res, { linked: 1, alreadyInvited: 1 });
  assert.equal(ctrl.rows[0]!.dealerId, null, "the colliding row must be left alone");
  assert.equal(ctrl.rows[2]!.dealerId, "dlr_1", "one collision must not abandon the rest");
});

test("a REPLACED sibling does NOT block the link — this is what migration 110 bought", async () => {
  ctrl.rows = [
    row({ id: "inv_rooftop", auctionId: "auc_1" }),
    row({ id: "inv_replaced", auctionId: "auc_1", rooftopId: null, dealerId: "dlr_1", status: "REPLACED" }),
  ];
  const res = await link(topLevelDb());
  assert.deepEqual(res, { linked: 1, alreadyInvited: 0 });
  assert.equal(ctrl.rows[0]!.dealerId, "dlr_1");
});

test("inside a transaction each write is savepointed, so a P2002 cannot abort the claim", async () => {
  ctrl.rows = [
    row({ id: "inv_rooftop", auctionId: "auc_1" }),
    row({ id: "inv_registered", auctionId: "auc_1", rooftopId: null, dealerId: "dlr_1" }),
  ];
  const res = await link(txDb());
  assert.deepEqual(res, { linked: 0, alreadyInvited: 1 });
  assert.ok(ctrl.raw.includes("SAVEPOINT al_sp_1") || ctrl.raw.some((s) => s.startsWith("SAVEPOINT")),
    "no SAVEPOINT was issued inside the transaction");
  assert.ok(ctrl.raw.some((s) => s.startsWith("ROLLBACK")),
    "the failed write was not rolled back to its savepoint — the transaction stays aborted");
});

test("no candidates means no writes and no error", async () => {
  ctrl.rows = [];
  const res = await link(topLevelDb());
  assert.deepEqual(res, { linked: 0, alreadyInvited: 0 });
});

// ── The two call sites, pinned in source ─────────────────────────────────────────────────────
//
// Both are silent when they regress: delete either and every gate stays green while an invited
// outside dealership quietly loses the auction it was invited to. There is no route-level test
// harness for `/api/dealer/claim` (Supabase admin + JWT + prisma), so the line itself is what
// gets pinned — the same idiom as `no-second-exception-writer.test.ts`.

const REPO_ROOT = process.cwd();

test("the account-claim route still links the rooftop's invitations", async () => {
  const { read } = await import("@/lib/testing/source-scan");
  const src = read(REPO_ROOT, "app/api/dealer/claim/route.ts");
  assert.match(
    src,
    /linkRooftopInvitationsToDealer\(\s*dealer\.rooftopId,\s*dealer\.id\s*\)/,
    "the claim route no longer links the rooftop's outside invitations to the claiming dealer",
  );
  assert.match(
    src,
    /rooftopId:\s*true/,
    "the claim route stopped selecting rooftopId, so the link can never fire",
  );
});

test("the daily rooftop-resolution pass still links what it just resolved", async () => {
  const { read } = await import("@/lib/testing/source-scan");
  const src = read(REPO_ROOT, "lib/services/dealer-recruitment/dealer-contact-backfill.service.ts");
  assert.match(
    src,
    /await link\(rid,\s*d\.id,\s*prisma\)/,
    "Phase 0 stopped linking a newly-resolved dealer's outside invitations — a dealer who " +
      "claims before this pass runs would never get the id the portal scopes on",
  );
});

// ── The auction-load pairing ─────────────────────────────────────────────────────────────────
//
// `releaseAuctionLoad` decrements `currentAuctionLoad` for EVERY invitation on a closing
// auction that names a dealer, and `processAuctionClose` calls it for every auction whatever
// rail issued the invitation. A link with no matching +1 is therefore a guaranteed -1 at close,
// and the dealer drifts below their true load — permanently under-loaded to the capacity gate.

test("a linked invitation increments the dealer's auction load, once per row", async () => {
  ctrl.rows = [row({ id: "inv_a", auctionId: "auc_1" }), row({ id: "inv_b", auctionId: "auc_2" })];
  const res = await link(topLevelDb());
  assert.equal(res.linked, 2);
  assert.equal(ctrl.load.dlr_1, 2, "one increment per invitation the dealer now holds");
});

test("a SKIPPED collision leaves the load untouched — no orphan +1", async () => {
  ctrl.rows = [
    row({ id: "inv_rooftop", auctionId: "auc_1" }),
    row({ id: "inv_registered", auctionId: "auc_1", rooftopId: null, dealerId: "dlr_1" }),
  ];
  const res = await link(topLevelDb());
  assert.deepEqual(res, { linked: 0, alreadyInvited: 1 });
  assert.equal(ctrl.load.dlr_1 ?? 0, 0, "the collision must not leave a load increment behind");
});

test("nothing linked means no load write at all", async () => {
  ctrl.rows = [row({ status: "DECLINED" })];
  await link(topLevelDb());
  assert.deepEqual(ctrl.load, {});
});

// ── The compare-and-set ──────────────────────────────────────────────────────────────────────
//
// The daily pass has no overlap claim (unlike `processAuctionClose`'s `postCloseProcessedAt`),
// so two ticks can both read the same row as a candidate. The `dealerId: null` predicate is what
// stops the loser writing — and, more importantly, incrementing the load a second time.

test("a row linked by a concurrent run is neither re-counted nor re-incremented", async () => {
  ctrl.rows = [row({ id: "inv_x" })];
  const db = topLevelDb();
  const { linkRooftopInvitationsToDealer } = await import(
    "@/lib/services/auction/auction-invitation.service"
  );
  type Db = Parameters<typeof linkRooftopInvitationsToDealer>[2];
  // First run links it.
  const first = await linkRooftopInvitationsToDealer("rt_1", "dlr_1", db as unknown as Db, NOW);
  assert.deepEqual(first, { linked: 1, alreadyInvited: 0 });
  assert.equal(ctrl.load.dlr_1, 1);

  // Second run, holding a candidate list read before the first committed.
  const second = await linkRooftopInvitationsToDealer("rt_1", "dlr_1", db as unknown as Db, NOW);
  assert.deepEqual(second, { linked: 0, alreadyInvited: 0 }, "the row is no longer a candidate");
  assert.equal(ctrl.load.dlr_1, 1, "the load must not be incremented twice");
});
