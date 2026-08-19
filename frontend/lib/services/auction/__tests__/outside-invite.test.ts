// C — outside-auction-invite mint with rooftop dedup + auto-mint from sourcing.
// Injected fake prisma (no module mocks). Proves: one physical rooftop is invited
// at most once per auction (existing outside invite, existing registered-dealer
// invitation, and within-batch dupes all deduped), email dedup, expiry stamped
// from the auction, max cap honored, and auto-mint builds best-contact-per-rooftop
// candidates with proximity filtering.
//   npx tsx --test lib/services/auction/__tests__/outside-invite.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { mintOutsideInvites, autoMintOutsideInvitesFromSourcing, inviteRejection } from "../outside-invite.service";

const NOW = new Date("2026-08-10T12:00:00Z");
const ENDS = new Date("2026-08-12T12:00:00Z");

interface InviteRow { email: string; rooftopId: string | null }
interface DealerInviteRow { dealer: { rooftopId: string | null } }

function mintFake(opts: {
  auction?: { id: string; endsAt: Date | null } | null;
  existingInvites?: InviteRow[];
  dealerInvites?: DealerInviteRow[];
}): { prisma: PrismaClient; created: Array<Record<string, unknown>> } {
  const created: Array<Record<string, unknown>> = [];
  let n = 0;
  const prisma = {
    auction: {
      findUnique: async () => (opts.auction === undefined ? { id: "auc1", endsAt: ENDS } : opts.auction),
    },
    outsideAuctionInvite: {
      findMany: async () => opts.existingInvites ?? [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        n += 1;
        const row = { id: `inv-${n}`, token: `tok-${n}`, ...data };
        created.push(row);
        return row;
      },
    },
    auctionInvitation: {
      findMany: async () => opts.dealerInvites ?? [],
    },
  } as unknown as PrismaClient;
  return { prisma, created };
}

const cand = (over: Partial<{ dealershipName: string; contactName: string; email: string; phone: string | null; rooftopId: string | null }> = {}) => ({
  dealershipName: "Test Motors",
  contactName: "Sales Team",
  email: `s${Math.round((over.rooftopId ? 1 : 0))}@x.test`,
  phone: null,
  rooftopId: null,
  ...over,
});

test("mints fresh candidates, stamps expiresAt from the auction, returns tokens", async () => {
  const { prisma, created } = mintFake({ auction: { id: "auc1", endsAt: ENDS } });
  const out = await mintOutsideInvites(
    "auc1",
    [cand({ email: "a@x.test", rooftopId: "r1" }), cand({ email: "b@x.test", rooftopId: "r2" })],
    undefined,
    { prisma, now: NOW },
  );
  assert.equal(out.length, 2);
  assert.equal(created.length, 2);
  assert.equal(created[0].expiresAt, ENDS);
  assert.equal(created[0].rooftopId, "r1");
  assert.ok(out[0].token.startsWith("tok-"));
});

test("skips a candidate whose rooftop already has an outside invite for the auction", async () => {
  const { prisma, created } = mintFake({
    auction: { id: "auc1", endsAt: ENDS },
    existingInvites: [{ email: "old@x.test", rooftopId: "r1" }],
  });
  const out = await mintOutsideInvites(
    "auc1",
    [cand({ email: "a@x.test", rooftopId: "r1" }), cand({ email: "b@x.test", rooftopId: "r2" })],
    undefined,
    { prisma, now: NOW },
  );
  assert.equal(out.length, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].rooftopId, "r2");
});

test("skips a candidate whose rooftop's registered dealer is already invited", async () => {
  const { prisma, created } = mintFake({
    auction: { id: "auc1", endsAt: ENDS },
    dealerInvites: [{ dealer: { rooftopId: "r1" } }],
  });
  const out = await mintOutsideInvites(
    "auc1",
    [cand({ email: "a@x.test", rooftopId: "r1" }), cand({ email: "b@x.test", rooftopId: "r2" })],
    undefined,
    { prisma, now: NOW },
  );
  assert.equal(out.length, 1);
  assert.equal(created[0].rooftopId, "r2");
});

test("dedups within the batch by rooftop and by normalized email", async () => {
  const { prisma, created } = mintFake({ auction: { id: "auc1", endsAt: ENDS } });
  const out = await mintOutsideInvites(
    "auc1",
    [
      cand({ email: "a@x.test", rooftopId: "r1" }),
      cand({ email: "dupe@x.test", rooftopId: "r1" }), // same rooftop → skip
      cand({ email: "A@X.test", rooftopId: "r2" }), // same email (normalized) as first → skip
      cand({ email: "c@x.test", rooftopId: "r3" }),
    ],
    undefined,
    { prisma, now: NOW },
  );
  assert.equal(out.length, 2);
  assert.deepEqual(created.map((c) => c.rooftopId), ["r1", "r3"]);
});

test("skips candidates with no usable email", async () => {
  const { prisma, created } = mintFake({ auction: { id: "auc1", endsAt: ENDS } });
  const out = await mintOutsideInvites(
    "auc1",
    [cand({ email: "", rooftopId: "r1" }), cand({ email: "b@x.test", rooftopId: "r2" })],
    undefined,
    { prisma, now: NOW },
  );
  assert.equal(out.length, 1);
  assert.equal(created[0].rooftopId, "r2");
});

test("honors the max cap on minted count", async () => {
  const { prisma, created } = mintFake({ auction: { id: "auc1", endsAt: ENDS } });
  const out = await mintOutsideInvites(
    "auc1",
    [
      cand({ email: "a@x.test", rooftopId: "r1" }),
      cand({ email: "b@x.test", rooftopId: "r2" }),
      cand({ email: "c@x.test", rooftopId: "r3" }),
    ],
    { max: 2 },
    { prisma, now: NOW },
  );
  assert.equal(out.length, 2);
  assert.equal(created.length, 2);
});

test("a P2002 unique violation (concurrent mint won the rooftop) skips that candidate, batch continues", async () => {
  const created: Array<Record<string, unknown>> = [];
  let n = 0;
  const prisma = {
    auction: { findUnique: async () => ({ id: "auc1", endsAt: ENDS }) },
    outsideAuctionInvite: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.rooftopId === "raced") throw Object.assign(new Error("unique"), { code: "P2002" });
        n += 1;
        const row = { id: `inv-${n}`, token: `tok-${n}`, ...data };
        created.push(row);
        return row;
      },
    },
    auctionInvitation: { findMany: async () => [] },
  } as unknown as PrismaClient;
  const out = await mintOutsideInvites(
    "auc1",
    [cand({ email: "a@x.test", rooftopId: "raced" }), cand({ email: "b@x.test", rooftopId: "r2" })],
    undefined,
    { prisma, now: NOW },
  );
  assert.equal(out.length, 1);
  assert.equal(created[0].rooftopId, "r2");
});

test("stamps a bounded fallback expiry when the auction has no endsAt", async () => {
  const { prisma, created } = mintFake({ auction: { id: "auc1", endsAt: null } });
  await mintOutsideInvites("auc1", [cand({ email: "a@x.test", rooftopId: "r1" })], undefined, { prisma, now: NOW });
  const exp = created[0].expiresAt as Date;
  assert.ok(exp instanceof Date);
  assert.equal(exp.getTime(), NOW.getTime() + 14 * 24 * 60 * 60 * 1000);
});

test("returns [] when the auction does not exist (no mint)", async () => {
  const { prisma, created } = mintFake({ auction: null });
  const out = await mintOutsideInvites("missing", [cand({ email: "a@x.test", rooftopId: "r1" })], undefined, { prisma, now: NOW });
  assert.equal(out.length, 0);
  assert.equal(created.length, 0);
});

// ---- inviteRejection (token acceptance guard) ----

test("inviteRejection: accepts a fresh invite on an active, unexpired auction", () => {
  const r = inviteRejection(
    { respondedAt: null, expiresAt: ENDS, auction: { status: "ACTIVE", endsAt: ENDS } },
    NOW,
  );
  assert.equal(r, null);
});

test("inviteRejection: single-use — a responded invite is ALREADY_SUBMITTED", () => {
  const r = inviteRejection(
    { respondedAt: NOW, expiresAt: ENDS, auction: { status: "ACTIVE", endsAt: ENDS } },
    NOW,
  );
  assert.equal(r, "ALREADY_SUBMITTED");
});

test("inviteRejection: rejects a non-ACTIVE auction", () => {
  const r = inviteRejection(
    { respondedAt: null, expiresAt: ENDS, auction: { status: "CLOSED", endsAt: ENDS } },
    NOW,
  );
  assert.equal(r, "AUCTION_INACTIVE");
});

test("inviteRejection: rejects a past-end auction", () => {
  const past = new Date(NOW.getTime() - 60_000);
  const r = inviteRejection(
    { respondedAt: null, expiresAt: ENDS, auction: { status: "ACTIVE", endsAt: past } },
    NOW,
  );
  assert.equal(r, "AUCTION_EXPIRED");
});

test("inviteRejection: enforces token expiry independently even if the auction looks active (replay after reopen)", () => {
  const past = new Date(NOW.getTime() - 60_000);
  const r = inviteRejection(
    { respondedAt: null, expiresAt: past, auction: { status: "ACTIVE", endsAt: null } },
    NOW,
  );
  assert.equal(r, "TOKEN_EXPIRED");
});

// ---- autoMintOutsideInvitesFromSourcing ----

interface RooftopWithContacts {
  id: string;
  displayName: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  contacts: Array<{ name: string | null; email: string | null; phone: string | null; emailVerificationStatus: string | null }>;
}

function autoMintFake(rooftops: RooftopWithContacts[]): { prisma: PrismaClient; created: Array<Record<string, unknown>> } {
  const created: Array<Record<string, unknown>> = [];
  let n = 0;
  const prisma = {
    auction: { findUnique: async () => ({ id: "auc1", endsAt: ENDS }) },
    dealerRooftop: { findMany: async () => rooftops.map((r) => ({ ...r, contacts: r.contacts.map((c) => ({ ...c })) })) },
    outsideAuctionInvite: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        n += 1;
        const row = { id: `inv-${n}`, token: `tok-${n}`, ...data };
        created.push(row);
        return row;
      },
    },
    auctionInvitation: { findMany: async () => [] },
  } as unknown as PrismaClient;
  return { prisma, created };
}

test("auto-mint builds best-contact-per-rooftop (VERIFIED over ROLE_DERIVED) candidates and mints them", async () => {
  const { prisma, created } = autoMintFake([
    {
      id: "r1", displayName: "Alpha Auto", city: "Austin", state: "TX", latitude: 30.3, longitude: -97.7,
      contacts: [
        { name: "Role Desk", email: "sales@alpha.test", phone: null, emailVerificationStatus: "ROLE_DERIVED" },
        { name: "Jane Rep", email: "jane@alpha.test", phone: "555", emailVerificationStatus: "VERIFIED" },
      ],
    },
  ]);
  const out = await autoMintOutsideInvitesFromSourcing("auc1", {}, { prisma, now: NOW });
  assert.equal(out.length, 1);
  assert.equal(created[0].email, "jane@alpha.test", "picks the VERIFIED contact");
  assert.equal(created[0].contactName, "Jane Rep");
  assert.equal(created[0].rooftopId, "r1");
});

test("auto-mint proximity filter excludes rooftops beyond radius and unplaceable ones when buyer coords are known", async () => {
  const { prisma, created } = autoMintFake([
    { id: "near", displayName: "Near Auto", city: "Austin", state: "TX", latitude: 30.30, longitude: -97.74,
      contacts: [{ name: "N", email: "n@near.test", phone: null, emailVerificationStatus: "VERIFIED" }] },
    { id: "far", displayName: "Far Auto", city: "Seattle", state: "WA", latitude: 47.6, longitude: -122.3,
      contacts: [{ name: "F", email: "f@far.test", phone: null, emailVerificationStatus: "VERIFIED" }] },
    { id: "noloc", displayName: "NoLoc Auto", city: null, state: null, latitude: null, longitude: null,
      contacts: [{ name: "X", email: "x@noloc.test", phone: null, emailVerificationStatus: "VERIFIED" }] },
  ]);
  const out = await autoMintOutsideInvitesFromSourcing(
    "auc1",
    { buyerCoords: { lat: 30.27, lng: -97.74 }, radiusMiles: 50 },
    { prisma, now: NOW },
  );
  assert.equal(out.length, 1);
  assert.equal(created[0].rooftopId, "near");
});
