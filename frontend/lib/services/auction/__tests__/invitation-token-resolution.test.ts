// S7-10 / §13-D37 — resolving a tokenised invitation link.
//
// THE SECURITY-RELEVANT CLAIMS, each asserted rather than asserted-in-a-comment:
//
//   · Only the HASH is compared. `issueInvitations` persists `tokenHash` and never the raw
//     token, so a database read cannot produce a working link and a query log cannot leak one.
//     The test proves the lookup is by hash by handing the fake a raw token and asserting the
//     `where` clause never contains it.
//   · The resolver GRANTS NOTHING. D37's ruling is that the token binds the invitation and the
//     session authorises the portal; a resolver that returned an authorisation would be the
//     token-alone surface the owner declined to authorise.
//   · The resolver WRITES NOTHING. A resolver that stamped `openedAt` would record an open from
//     a link preview, a mail scanner, or a rejected attempt.
//   · The auction is the authority on the window, not the token — an admin closing an auction
//     early moves only the auction, and the link must die with it.
//   · An unknown token is null, not "expired". "Expired" asserts we once issued it.
//
// Run: pnpm test (this directory is in the base glob)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

interface Row {
  id: string;
  auctionId: string;
  rooftopId: string | null;
  dealerId: string | null;
  dealershipName: string | null;
  contactName: string | null;
  status: string;
  expiresAt: Date | null;
  declinedAt: Date | null;
  offerSubmittedAt: Date | null;
  tokenHash: string;
  auction: { status: string; endsAt: Date | null } | null;
}

interface Ctrl {
  rows: Row[];
  /** Every `where` clause the resolver issued, so the raw token can be proven absent. */
  wheres: Array<Record<string, unknown>>;
  /** Any write the resolver attempted. Must stay empty. */
  writes: string[];
}
let ctrl: Ctrl;

const NOW = new Date("2026-09-11T12:00:00Z");
const RAW = "a".repeat(64);
const HASH = createHash("sha256").update(RAW).digest("hex");

function row(over: Partial<Row> = {}): Row {
  return {
    id: "inv_1",
    auctionId: "auc_1",
    rooftopId: "rt_1",
    dealerId: null,
    dealershipName: "Example Motors",
    contactName: "Sales",
    status: "SENT",
    expiresAt: new Date("2026-09-13T00:00:00Z"),
    declinedAt: null,
    offerSubmittedAt: null,
    tokenHash: HASH,
    auction: { status: "ACTIVE", endsAt: new Date("2026-09-13T00:00:00Z") },
    ...over,
  };
}

beforeEach(() => {
  ctrl = { rows: [row()], wheres: [], writes: [] };
});

mock.module("server-only", { namedExports: {}, defaultExport: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auctionInvitation: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          ctrl.wheres.push(args.where);
          const hash = args.where.tokenHash;
          return ctrl.rows.find((r) => r.tokenHash === hash) ?? null;
        },
        update: async () => {
          ctrl.writes.push("auctionInvitation.update");
          return {};
        },
        findUnique: async () => null,
        count: async () => 0,
      },
      outsideAuctionInvite: { count: async () => 0 },
    },
  },
});

async function resolve(token: string) {
  const { resolveInvitationByToken } = await import(
    "@/lib/services/auction/auction-invitation.service"
  );
  return resolveInvitationByToken(token, undefined, NOW);
}

test("a live token resolves to its invitation with no rejection", async () => {
  const r = await resolve(RAW);
  assert.ok(r);
  assert.equal(r.invitationId, "inv_1");
  assert.equal(r.auctionId, "auc_1");
  assert.equal(r.rooftopId, "rt_1");
  assert.equal(r.rejection, null);
  assert.equal(r.alreadyBid, false);
});

test("only the HASH is compared — the raw token never reaches a query", async () => {
  await resolve(RAW);
  assert.equal(ctrl.wheres.length, 1);
  assert.equal(ctrl.wheres[0]!.tokenHash, HASH);
  const serialised = JSON.stringify(ctrl.wheres);
  assert.ok(!serialised.includes(RAW), "the raw token appeared in a query clause");
});

test("the resolver WRITES NOTHING — recording the open is the caller's", async () => {
  await resolve(RAW);
  assert.deepEqual(ctrl.writes, [], "the resolver wrote to the invitation");
});

test("the resolver grants nothing — there is no authorisation field in what it returns", async () => {
  // §13-D37: the token binds the invitation, the session authorises the portal. A resolver that
  // returned an authorisation would be the token-alone surface the owner declined to authorise.
  const r = await resolve(RAW);
  assert.ok(r);
  const keys = Object.keys(r);
  for (const forbidden of ["authorized", "canSubmit", "session", "dealer", "token", "rawToken", "tokenHash"]) {
    assert.ok(!keys.includes(forbidden), `the resolver returned "${forbidden}"`);
  }
});

test("an unknown token is null, not 'expired' — 'expired' asserts we issued it", async () => {
  assert.equal(await resolve("b".repeat(64)), null);
});

test("an empty token is refused without a query", async () => {
  assert.equal(await resolve(""), null);
  assert.deepEqual(ctrl.wheres, [], "an empty token reached the database");
});

test("a token past its own expiry is TOKEN_EXPIRED", async () => {
  ctrl.rows = [row({ expiresAt: new Date("2026-09-10T00:00:00Z") })];
  const r = await resolve(RAW);
  assert.equal(r?.rejection, "TOKEN_EXPIRED");
});

test("THE AUCTION IS THE AUTHORITY ON THE WINDOW — an early close kills a live-looking token", async () => {
  // `issueInvitations` sets `expiresAt` to the auction's `endsAt` so the two agree, but an admin
  // closing an auction early moves only the auction. A token that outlived its auction is a
  // token replayable into a closed auction.
  ctrl.rows = [
    row({
      expiresAt: new Date("2026-09-13T00:00:00Z"),
      auction: { status: "CLOSED", endsAt: new Date("2026-09-13T00:00:00Z") },
    }),
  ];
  const r = await resolve(RAW);
  assert.equal(r?.rejection, "AUCTION_NOT_ACTIVE");
});

test("an auction whose endsAt has passed is closed even if its status lags", async () => {
  ctrl.rows = [
    row({
      expiresAt: new Date("2026-09-14T00:00:00Z"),
      auction: { status: "ACTIVE", endsAt: new Date("2026-09-10T00:00:00Z") },
    }),
  ];
  const r = await resolve(RAW);
  assert.equal(r?.rejection, "AUCTION_NOT_ACTIVE");
});

test("a REPLACED invitation reads as superseded, which outranks every other reason", async () => {
  // The dealership's own question is "why doesn't my link work", and the specific answer is that
  // a newer one was issued to them — which is actionable where "this auction has closed" is not.
  ctrl.rows = [
    row({
      status: "REPLACED",
      expiresAt: new Date("2026-09-10T00:00:00Z"),
      auction: { status: "CLOSED", endsAt: new Date("2026-09-10T00:00:00Z") },
    }),
  ];
  const r = await resolve(RAW);
  assert.equal(r?.rejection, "INVITATION_SUPERSEDED");
});

test("a declined invitation reads as declined, not as expired", async () => {
  ctrl.rows = [row({ status: "DECLINED", declinedAt: new Date("2026-09-11T09:00:00Z") })];
  const r = await resolve(RAW);
  assert.equal(r?.rejection, "ALREADY_DECLINED");
});

test("a submitted offer is reported, so the brief does not invite a second one", async () => {
  ctrl.rows = [row({ status: "OFFER_SUBMITTED", offerSubmittedAt: new Date("2026-09-11T10:00:00Z") })];
  const r = await resolve(RAW);
  assert.equal(r?.rejection, null, "an invitation that has bid is still a live invitation");
  assert.equal(r?.alreadyBid, true);
});

test("a null expiry does not expire — the auction's window is the only other gate", async () => {
  ctrl.rows = [row({ expiresAt: null })];
  const r = await resolve(RAW);
  assert.equal(r?.rejection, null);
});

test("a dealer-bound invitation with no rooftop still resolves — both keys are carried", async () => {
  // The admin hand-pick path can invite a registered dealer that has never been resolved to a
  // rooftop. Refusing it here would remove that capability.
  ctrl.rows = [row({ rooftopId: null, dealerId: "d_1" })];
  const r = await resolve(RAW);
  assert.equal(r?.rejection, null);
  assert.equal(r?.rooftopId, null);
  assert.equal(r?.dealerId, "d_1");
});

test("a missing dealership name is reported as null, never as a placeholder", async () => {
  // Substituting "Dealership" in the service would put an invented name into its own return.
  // The surface decides how to address an unnamed rooftop, and can only do that if it is told.
  ctrl.rows = [row({ dealershipName: null, contactName: null })];
  const r = await resolve(RAW);
  assert.equal(r?.dealershipName, null);
  assert.equal(r?.contactName, null);
});
