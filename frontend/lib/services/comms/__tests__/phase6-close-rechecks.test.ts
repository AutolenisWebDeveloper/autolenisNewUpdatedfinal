// §27 — THE PHASE 6 CLOSE RECHECKS, AND THE DUPLICATED PREDICATE THEY DEPEND ON.
//
// `state-recheck-registry.ts` deliberately re-expresses the qualified-offer predicate rather than
// importing `offer-validity.ts`: the registry is loaded by the outbox DRAIN, and importing the
// offer tree there would pull a request-path module into a background process for one `where`
// clause. The comment beside it says the duplication "is pinned by a test that reads both and
// asserts they agree". THIS IS THAT TEST — it did not exist when the claim was written, which is
// exactly the kind of gap a comment can hide.
//
// The two must agree because they answer the same question at two moments: the close counts
// qualified offers to choose the branch and to write the number into the subject line, and the
// drain re-counts them at send time to decide whether that number is still true. A drift makes the
// email say "3 offers ready" and the report show two.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/comms/__tests__/phase6-close-rechecks.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { qualifiedOfferWhere } from "@/lib/services/offer/offer-validity";

type Rec = Record<string, unknown>;

let offers: Rec[];

function matches(o: Rec, where: Rec): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      if (!(v as Rec[]).some((c) => matches(o, c))) return false;
      continue;
    }
    const actual = o[k];
    if (v !== null && typeof v === "object") {
      const cond = v as Rec;
      if ("gt" in cond && !(actual instanceof Date && actual.getTime() > (cond.gt as Date).getTime())) return false;
      continue;
    }
    if (actual !== v) return false;
  }
  return true;
}

const db = {
  offer: { count: async ({ where }: { where: Rec }) => offers.filter((o) => matches(o, where)).length },
} as unknown as Parameters<typeof import("../state-recheck-registry")["runStateRecheck"]>[0]["db"];

mock.module("@/lib/prisma", { namedExports: { prisma: db } });

const FUTURE = new Date(Date.now() + 72 * 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

function offer(over: Rec = {}): Rec {
  return { auctionId: "auc_1", status: "SUBMITTED", isDisqualified: false, expiresAt: FUTURE, ...over };
}

beforeEach(() => { offers = []; });

async function recheck(templateKey: string, auctionId: string | null = "auc_1") {
  const { runStateRecheck } = await import("../state-recheck-registry");
  return runStateRecheck({
    templateKey,
    triggerEvent: "auction.closed",
    vehicleRequestId: null,
    dealId: null,
    auctionId,
    recipientKind: "buyer",
    recipientId: "b1",
    payload: {},
    db,
  });
}

// ── the duplication, pinned ─────────────────────────────────────────────────────────────────────

test("the registry's inline predicate matches `qualifiedOfferWhere` condition for condition", () => {
  // Read as SOURCE, because that is the only way to compare a copy against its original without
  // importing the thing the copy exists to avoid importing.
  const src = readFileSync("lib/services/comms/state-recheck-registry.ts", "utf8");
  const fn = src.slice(src.indexOf("async function countQualifiedOffers"), src.indexOf("* \"Your offers are ready\""));

  const canonical = qualifiedOfferWhere(new Date());
  assert.equal(canonical.status, "SUBMITTED");
  assert.equal(canonical.isDisqualified, false);
  assert.equal((canonical.OR as unknown[]).length, 2);

  assert.match(fn, /status:\s*"SUBMITTED"/, "the copy no longer filters on status");
  assert.match(fn, /isDisqualified:\s*false/, "the copy no longer excludes disqualified offers");
  assert.match(fn, /expiresAt:\s*null/, "the copy no longer admits a legacy NULL expiry");
  assert.match(fn, /expiresAt:\s*\{\s*gt:/, "the copy no longer excludes lapsed offers");

  // The canonical predicate has exactly three conditions. A fourth added to `offer-validity.ts`
  // without being mirrored here is the drift this test exists to catch, and it fails on the count
  // rather than on any particular key.
  assert.equal(
    Object.keys(canonical).length,
    3,
    "qualifiedOfferWhere grew a condition — mirror it in state-recheck-registry.ts and update this test",
  );
});

// ── offers_ready ────────────────────────────────────────────────────────────────────────────────

test("offers_ready sends while qualified offers remain", async () => {
  offers = [offer()];
  assert.deepEqual(await recheck("offers_ready"), { proceed: true });
});

test("offers_ready is SKIPPED once the buyer has selected", async () => {
  offers = [offer({ status: "ACCEPTED" })];
  const d = await recheck("offers_ready");
  assert.equal(d.proceed, false);
  assert.match((d as { reason: string }).reason, /already selected/);
});

test("offers_ready is SKIPPED when the offers it counts have lapsed or been withdrawn", async () => {
  offers = [offer({ expiresAt: PAST }), offer({ status: "WITHDRAWN" }), offer({ isDisqualified: true })];
  const d = await recheck("offers_ready");
  assert.equal(d.proceed, false);
  assert.match((d as { reason: string }).reason, /no qualified offer/);
});

// ── auction_zero_offers ─────────────────────────────────────────────────────────────────────────

test("auction_zero_offers sends when nothing qualified arrived", async () => {
  assert.deepEqual(await recheck("auction_zero_offers"), { proceed: true });
});

test("auction_zero_offers is SKIPPED once a qualified offer arrives after the close", async () => {
  // Staff intake goes through `submitOffer` from Phase 6, so an offer that arrived by phone can be
  // entered after the window — and the operator entering it is the same one reading the queue row.
  offers = [offer()];
  const d = await recheck("auction_zero_offers");
  assert.equal(d.proceed, false);
  assert.match((d as { reason: string }).reason, /arrived after the close/);
});

test("auction_zero_offers is SKIPPED when an offer was SELECTED — the strongest refutation", async () => {
  // Selection moves the winner to ACCEPTED and the rest to DECLINED, so a bought-on auction has a
  // QUALIFIED count of zero. Without the accepted check the recheck would deliver "no dealership
  // submitted a qualified offer" to a buyer holding a Deal.
  offers = [offer({ status: "ACCEPTED" }), offer({ status: "DECLINED" })];
  const d = await recheck("auction_zero_offers");
  assert.equal(d.proceed, false);
  assert.match((d as { reason: string }).reason, /already selected/);
});

// ── fail-closed ─────────────────────────────────────────────────────────────────────────────────

test("both rechecks refuse a row with no auction reference rather than sending blind", async () => {
  for (const key of ["offers_ready", "auction_zero_offers"]) {
    const d = await recheck(key, null);
    assert.equal(d.proceed, false, key);
    assert.match((d as { reason: string }).reason, /no auction reference/);
  }
});
