// A capture that produces NO VehicleRequest is a state the whole intake path used
// to answer for dishonestly.
//
// Three things were true at once before this batch:
//   • the response said "we sent a link to that email address" whether or not one
//     had been sent — a registered USER with no buyer row has nothing to mint a
//     token against, and that branch fell straight through, silently;
//   • the claim prompt was keyed on the opportunity, which is a fresh row on every
//     submission, so N posts at a registered address minted N live 5-day write
//     credentials and sent N emails;
//   • the held capture left an admin Notification titled "Vehicle Request: <name>"
//     pointing at a request that did not exist, and nothing else.
//
// These pin the three answers: `claimLinkSent` is reported not inferred, ONE live
// credential exists per target buyer, and the held capture raises the §26
// BUYER_UNVERIFIED exception that gives a human the buyer id, the lead id and a
// return point.
//
// Run: pnpm test:intake

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeFakePrisma, type FakeDb } from "./fake-prisma";

const db: FakeDb = makeFakePrisma();
mock.module("@/lib/prisma", { namedExports: { prisma: db.client } });
mock.module("@/lib/logger", { namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {} } } });

async function intake() {
  return (await import("@/lib/services/acquisition/unified-buyer-intake.service")).intakeBuyerRequest;
}

beforeEach(() => db.reset());

/** A verified account WITH a buyer row — a link can be minted for it. */
function seedRegisteredBuyer(email: string) {
  const userId = `user_${email}`;
  db.state.users.set(userId, { id: userId, email, supabaseId: `sb_${email}`, role: "BUYER" });
  const buyerId = `buyer_${email}`;
  db.state.buyers.set(buyerId, { id: buyerId, userId, firstName: "Sam", lastName: "B", phone: null, isGuest: false, zip: null, city: null, state: null });
  return { userId, buyerId };
}

/** A verified account with NO buyer row. Rule 16 still refuses to attach, and
 *  there is nothing to bind a token to — the case that answered "check your
 *  email" with no email on the way. */
function seedRegisteredUserWithoutBuyer(email: string) {
  const userId = `user_${email}`;
  db.state.users.set(userId, { id: userId, email, supabaseId: `sb_${email}`, role: "BUYER" });
  return { userId };
}

function queueItems() {
  return [...db.state.queueItems.values()];
}

// ── claimLinkSent is reported, never inferred ───────────────────────────────

test("a registered address WITH a buyer row: the link is sent and claimLinkSent says so", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  const intakeBuyerRequest = await intake();

  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Anyone",
    email: "registered@example.com",
    zip: "75035",
  });

  assert.equal(r.vehicleRequestId, null, "§7.2: nothing attaches to a registered account on an asserted email");
  assert.equal(r.requiresClaim, true);
  assert.equal(r.claimLinkSent, true, "a link was actually enqueued");
  assert.equal(db.state.claimTokens.size, 1);
  assert.equal([...db.state.claimTokens.values()][0]!.buyerId, buyerId);
  assert.equal(db.state.commsOutbox.size, 1);
  assert.equal(queueItems().length, 0, "nothing is wrong: the system did exactly what it says");
});

test("a registered USER with NO buyer row: claimLinkSent is false and an exception is raised", async () => {
  seedRegisteredUserWithoutBuyer("orphan@example.com");
  const intakeBuyerRequest = await intake();

  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Anyone",
    email: "orphan@example.com",
    zip: "75035",
  });

  assert.equal(r.requiresClaim, true);
  assert.equal(r.claimLinkSent, false, "no buyer row means no token, which means no link — say so");
  assert.equal(db.state.claimTokens.size, 0, "nothing was minted");
  assert.equal(db.state.commsOutbox.size, 0, "and nothing was enqueued");

  const items = queueItems();
  assert.equal(items.length, 1, "the held capture becomes work, not silence");
  assert.equal(items[0]!.exceptionCode, "BUYER_UNVERIFIED");
  assert.equal(items[0]!.status, "OPEN");
  assert.ok(
    String(items[0]!.requiredAction).includes(r.buyerOpportunityId),
    "the exception carries the lead id, so a human can get from the queue to the record",
  );
  assert.ok(String(items[0]!.returnPoint).length > 0, "§26: a return point that says what resolves it");
});

test("a capture with no identifiable buyer at all raises the same exception", async () => {
  const intakeBuyerRequest = await intake();

  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Anyone",
    // No address at all: rule 16 has nothing to resolve on, so tier 3 cannot
    // even create a guest capture.
    email: undefined,
    zip: "75035",
  });

  assert.equal(r.vehicleRequestId, null);
  assert.equal(r.requiresClaim, false);
  assert.equal(r.claimLinkSent, false);
  const items = queueItems();
  assert.equal(items.length, 1);
  assert.equal(items[0]!.exceptionCode, "BUYER_UNVERIFIED");
  assert.equal(items[0]!.buyerId, null, "there is no buyer to point at — the lead id is the handle");
});

// ── one live credential per target buyer ────────────────────────────────────

test("submitting the same registered address twice mints ONE token and sends ONE email", async () => {
  seedRegisteredBuyer("registered@example.com");
  const intakeBuyerRequest = await intake();

  const submission = {
    source: "request_vehicle_wizard" as const,
    firstName: "Anyone",
    email: "registered@example.com",
    zip: "75035",
  };

  const first = await intakeBuyerRequest(submission);
  const second = await intakeBuyerRequest(submission);

  assert.equal(first.claimLinkSent, true);
  assert.equal(second.claimLinkSent, true, "the link IS in that inbox — truthfully reported the second time too");
  assert.equal(db.state.claimTokens.size, 1, "one live write credential, not one per submission");
  assert.equal(db.state.commsOutbox.size, 1, "and one email, not one per submission");
  assert.equal(db.state.opportunities.size, 2, "both captures are still kept — the lead is never dropped");
});

test("an EXPIRED token does not suppress a fresh link", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  // A dead credential is not a live one: suppressing on it would silently break a
  // legitimate submission made days later.
  db.state.claimTokens.set("tok_old", {
    id: "tok_old",
    buyerId,
    tokenHash: "old",
    purpose: "claim",
    consumedAt: null,
    vehicleRequestId: null,
    expiresAt: new Date(Date.now() - 60_000),
  });

  const intakeBuyerRequest = await intake();
  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Anyone",
    email: "registered@example.com",
    zip: "75035",
  });

  assert.equal(r.claimLinkSent, true);
  assert.equal(db.state.claimTokens.size, 2, "a new token is minted alongside the dead one");
});

test("a live LEGACY-purpose token does not suppress a claim link", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  // `legacy_unscoped` is what the migration backfills onto every row minted
  // before the column existed — including $99 deposit-resume links. The tier-2
  // lookup accepts those (refusing them would break live links); the SUPPRESSION
  // lookup must not, or a deposit link in the inbox silences the claim email
  // while the visitor is told to go and read it.
  db.state.claimTokens.set("tok_legacy", {
    id: "tok_legacy",
    buyerId,
    tokenHash: "legacy",
    purpose: "legacy_unscoped",
    consumedAt: null,
    vehicleRequestId: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const intakeBuyerRequest = await intake();
  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Anyone",
    email: "registered@example.com",
    zip: "75035",
  });

  assert.equal(r.claimLinkSent, true);
  assert.equal(db.state.commsOutbox.size, 1, "a claim email really was enqueued");
});

test("a live NULL-purpose token does not suppress a claim link", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  // What an instance running the pre-migration code writes during a rolling
  // deploy. Same reasoning as above.
  db.state.claimTokens.set("tok_null", {
    id: "tok_null",
    buyerId,
    tokenHash: "nullpurpose",
    purpose: null,
    consumedAt: null,
    vehicleRequestId: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const intakeBuyerRequest = await intake();
  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Anyone",
    email: "registered@example.com",
    zip: "75035",
  });

  assert.equal(r.claimLinkSent, true);
  assert.equal(db.state.commsOutbox.size, 1);
});

test("a live DEPOSIT-resume token does not suppress a claim link", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  // The two purposes are different credentials. A live resume link in the inbox
  // is not something the visitor can claim a request with.
  db.state.claimTokens.set("tok_resume", {
    id: "tok_resume",
    buyerId,
    tokenHash: "resume",
    purpose: "resume",
    consumedAt: null,
    vehicleRequestId: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const intakeBuyerRequest = await intake();
  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Anyone",
    email: "registered@example.com",
    zip: "75035",
  });

  assert.equal(r.claimLinkSent, true);
  assert.equal(db.state.claimTokens.size, 2);
});

// ── single use on the path that used it ─────────────────────────────────────

test("a claim token presented to the intake write path is CONSUMED by the write it authorised", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  const raw = "raw-claim-token-value";
  db.state.claimTokens.set("tok_live", {
    id: "tok_live",
    buyerId,
    tokenHash: createHash("sha256").update(raw).digest("hex"),
    purpose: "claim",
    consumedAt: null,
    vehicleRequestId: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const intakeBuyerRequest = await intake();
  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    email: "registered@example.com",
    zip: "75035",
    claimToken: raw,
  });

  assert.equal(r.identityTier, "CLAIM_TOKEN");
  assert.ok(r.vehicleRequestId, "the token authorised the attach");
  assert.equal([...db.state.vehicleRequests.values()][0]!.buyerId, buyerId);

  const token = db.state.claimTokens.get("tok_live")!;
  assert.ok(token.consumedAt instanceof Date, "single use: the forwarded link stops being a write credential");
});

test("a consumed claim token no longer authorises a write", async () => {
  seedRegisteredBuyer("registered@example.com");
  const raw = "already-used";
  db.state.claimTokens.set("tok_used", {
    id: "tok_used",
    buyerId: "buyer_registered@example.com",
    tokenHash: createHash("sha256").update(raw).digest("hex"),
    purpose: "claim",
    consumedAt: new Date(),
    vehicleRequestId: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const intakeBuyerRequest = await intake();
  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    email: "registered@example.com",
    zip: "75035",
    claimToken: raw,
  });

  // Falls through to tier 3, which refuses a registered address to an anonymous
  // caller — so the reused link attaches nothing.
  assert.equal(r.identityTier, "REGISTERED_REQUIRES_CLAIM");
  assert.equal(r.vehicleRequestId, null);
});
