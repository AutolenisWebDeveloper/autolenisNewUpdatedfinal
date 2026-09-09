// §7.2 REGRESSION — defect #2: a duplicate buyer record for the same person,
// created after an earlier fix.
//
// The five cases §7.2 names, verbatim:
//   (i)   two concurrent Lane 1 submissions with the same normalised verified
//         email → one buyer, one open Vehicle Request (DB partial unique index +
//         service CAS);
//   (ii)  case/whitespace variants of one email → one buyer;
//   (iii) same phone and name with a DIFFERENT verified email → TWO buyers and no
//         merge (rule 16 negative test);
//   (iv)  claim-token resend → no second buyer or request;
//   (v)   dashboard submission with no campaign → acquisition channel `direct`,
//         individual UTM fields NULL, `source_url`/`referrer` NULL not `direct`,
//         `ip_address` captured or recorded unavailable with reason.
//
// Plus the rule-16 violation §7.2 traced in the code: public intake attaching a
// new request to a REGISTERED buyer on an unverified email.
//
// These construct their own data and never read the production rows §7.2 cites.
// §13-D3 asks the owner to confirm that the two production rows are the §9C
// duplicate; §7.2 states the fix design does not change either way, and these
// tests are why — they assert the RULE, not the pair.
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

/** A verified account: a real Supabase identity, not a `guest_` placeholder. */
function seedRegisteredBuyer(email: string, phone: string | null = null, name = "Sam") {
  const userId = `user_seed_${email}`;
  db.state.users.set(userId, { id: userId, email, supabaseId: `sb_${email}`, role: "BUYER" });
  const buyerId = `buyer_seed_${email}`;
  db.state.buyers.set(buyerId, { id: buyerId, userId, firstName: name, lastName: "B", phone, isGuest: false, zip: null, city: null, state: null });
  return { userId, buyerId };
}

// ── (i) concurrency ─────────────────────────────────────────────────────────

test("(i) two concurrent submissions with the same email → ONE buyer, ONE open request", async () => {
  const intakeBuyerRequest = await intake();
  const submission = {
    source: "request_vehicle_wizard" as const,
    firstName: "Sam",
    email: "sam@example.com",
    zip: "75035",
  };

  // Both start before either finishes — the shape that produced the duplicate.
  const [a, b] = await Promise.all([intakeBuyerRequest(submission), intakeBuyerRequest(submission)]);

  assert.equal(db.state.buyers.size, 1, "one person, one buyer row");
  assert.equal(db.state.users.size, 1);
  assert.equal(db.state.vehicleRequests.size, 1, "the partial unique index permits exactly one open request");
  assert.equal(a.vehicleRequestId, b.vehicleRequestId, "both submissions resolve to the same request");

  // One created, the other merged. WHICH merge branch it took — "saw the row and
  // attached" or "lost the insert and attached after P2002" — depends on where the
  // two flows interleave, so asserting a specific branch here would be asserting
  // the scheduler. The invariant is above; the CAS branch is proved
  // deterministically in the next test.
  const outcomes = [a.attachOutcome, b.attachOutcome].sort();
  assert.equal(outcomes.filter((o) => o === "CREATED").length, 1, "exactly one submission created the request");
  assert.ok(
    outcomes.some((o) => o === "ATTACHED" || o === "ATTACHED_AFTER_RACE"),
    "the other must have attached, not failed"
  );
});

test("(i) the CAS branch: a create that loses to the partial unique index merges into the winner", async () => {
  const { attachOrCreateOpenRequest } = await import("@/lib/services/vehicle-request/open-request.service");

  // A buyer who already holds an open request, and a caller that has not seen it —
  // exactly the state a concurrent submission is in when it reaches the insert.
  db.state.buyers.set("b1", { id: "b1", userId: "u1", isGuest: false });
  db.state.vehicleRequests.set("vr_winner", {
    id: "vr_winner",
    buyerId: "b1",
    status: "SUBMITTED",
    createdAt: new Date(),
    makePreference: null,
  });

  const model = db.client.vehicleRequest as { findFirst: (a: unknown) => Promise<unknown> };
  const realFindFirst = model.findFirst;
  let firstLook = true;
  model.findFirst = async (args: unknown) => {
    if (firstLook) {
      // The pre-check misses: the winner committed after this read.
      firstLook = false;
      return null;
    }
    return realFindFirst(args);
  };

  try {
    const result = await attachOrCreateOpenRequest(
      { buyerId: "b1", createStatus: "SUBMITTED", data: { makePreference: "Toyota" } },
      db.client as never
    );
    assert.equal(result.outcome, "ATTACHED_AFTER_RACE", "a lost insert must merge, never surface a raw 23505");
    assert.equal(result.vehicleRequest.id, "vr_winner");
    assert.deepEqual(result.updatedFields, ["makePreference"]);
    assert.equal(db.state.vehicleRequests.size, 1, "no second open request was created");
  } finally {
    model.findFirst = realFindFirst;
  }
});

// ── (ii) normalisation ──────────────────────────────────────────────────────

test("(ii) case and whitespace variants of one email resolve to ONE buyer", async () => {
  const intakeBuyerRequest = await intake();
  for (const email of ["Sam@Example.com", "  sam@example.com  ", "SAM@EXAMPLE.COM"]) {
    await intakeBuyerRequest({ source: "request_vehicle_wizard", firstName: "Sam", email, zip: "75035" });
  }
  assert.equal(db.state.buyers.size, 1);
  assert.equal(db.state.users.size, 1);
  assert.equal(db.state.vehicleRequests.size, 1);
});

// ── (iii) the rule-16 NEGATIVE test ─────────────────────────────────────────

test("(iii) same phone and name, DIFFERENT verified email → TWO buyers and no merge", async () => {
  const intakeBuyerRequest = await intake();
  await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    lastName: "Baker",
    email: "sam@example.com",
    phone: "+13617174215",
    zip: "75035",
  });
  await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    lastName: "Baker",
    email: "sam.baker@other.com",
    phone: "+13617174215",
    zip: "75035",
  });

  assert.equal(
    db.state.buyers.size,
    2,
    "rule 16 forbids merging by name, phone or fuzzy match — two distinct emails are two identities"
  );
  assert.equal(db.state.vehicleRequests.size, 2, "each identity gets its own open request");

  // But the collision IS flagged for a human. §7.2 (iv): a flag, never a merge.
  const flagged = [...db.state.queueItems.values()].filter((q) =>
    String(q.requiredAction ?? "").includes("possible duplicate buyer")
  );
  assert.equal(flagged.length >= 1, true, "a phone collision must raise an exception for an audited human merge");
  assert.equal(flagged[0]!.ownerRole, "OPERATIONS");
});

// ── (iv) claim-token resend ─────────────────────────────────────────────────

test("(iv) a claim-token resend creates no second buyer and no second request", async () => {
  const intakeBuyerRequest = await intake();
  const first = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    email: "sam@example.com",
    zip: "75035",
  });
  assert.equal(db.state.buyers.size, 1);
  const buyerId = [...db.state.buyers.keys()][0]!;

  // A claim link is issued and then RESENT — the same token, twice.
  const raw = "claim-token-abc";
  db.state.claimTokens.set("tok_1", {
    id: "tok_1",
    tokenHash: createHash("sha256").update(raw).digest("hex"),
    buyerId,
    vehicleRequestId: first.vehicleRequestId,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  for (let i = 0; i < 2; i++) {
    const r = await intakeBuyerRequest({
      source: "request_vehicle_wizard",
      firstName: "Sam",
      email: "sam@example.com",
      claimToken: raw,
      zip: "75035",
    });
    assert.equal(r.vehicleRequestId, first.vehicleRequestId);
  }
  assert.equal(db.state.buyers.size, 1, "resending a claim link never creates a second buyer");
  assert.equal(db.state.vehicleRequests.size, 1, "…nor a second request");
});

// ── token purpose: the $99 deposit link is not a write credential ───────────
//
// `resolveClaimToken` matched on the hash alone, so every row in
// `buyer_request_claim_tokens` was interchangeable. Two sites mint into it: the
// rule-16 claim link, which is meant to authorise a write on the request it names,
// and the $99 pre-checkout resume link, whose own service comment says it "confers
// NO authenticated capability". Pasted into `/request-vehicle?claim=`, the second
// resolved as tier 2 and wrote to the buyer's account.

test("a RESUME-purpose token does NOT resolve as a rule-16 tier-2 identity", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  const intakeBuyerRequest = await intake();

  const raw = "deposit-resume-token";
  db.state.claimTokens.set("tok_resume", {
    id: "tok_resume",
    tokenHash: createHash("sha256").update(raw).digest("hex"),
    buyerId,
    vehicleRequestId: null,
    purpose: "resume",
    consumedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Anyone",
    email: "registered@example.com",
    claimToken: raw,
    zip: "75035",
  });

  // Falls through to tier 3, which refuses a registered address to an anonymous
  // caller — so the deposit link buys exactly nothing.
  assert.equal(r.identityTier, "REGISTERED_REQUIRES_CLAIM");
  assert.equal(r.vehicleRequestId, null, "a deposit deep link must not authorise a write");
  assert.equal(db.state.vehicleRequests.size, 0);
});

test("a CLAIM-purpose token still resolves as tier 2", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  const intakeBuyerRequest = await intake();

  const raw = "genuine-claim-token";
  db.state.claimTokens.set("tok_claim", {
    id: "tok_claim",
    tokenHash: createHash("sha256").update(raw).digest("hex"),
    buyerId,
    vehicleRequestId: null,
    purpose: "claim",
    consumedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    email: "registered@example.com",
    claimToken: raw,
    zip: "75035",
  });

  assert.equal(r.identityTier, "CLAIM_TOKEN");
  assert.ok(r.vehicleRequestId, "the emailed claim link is what makes the address verified");
});

test("a LEGACY-purpose token still resolves — pre-migration links must not break", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  const intakeBuyerRequest = await intake();

  const raw = "minted-before-the-column";
  db.state.claimTokens.set("tok_legacy", {
    id: "tok_legacy",
    tokenHash: createHash("sha256").update(raw).digest("hex"),
    buyerId,
    vehicleRequestId: null,
    purpose: "legacy_unscoped",
    consumedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    email: "registered@example.com",
    claimToken: raw,
    zip: "75035",
  });

  assert.equal(r.identityTier, "CLAIM_TOKEN", "the data cannot attribute these; both paths accept them");
});

test("a NULL-purpose token still resolves — the rolling-deploy window", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  const intakeBuyerRequest = await intake();

  // An old instance, still live during the deploy, mints without a purpose. `in`
  // does not match NULL in SQL, so refusing these would kill every claim link issued
  // in that window — and would disagree with the resume side, which reads
  // `purpose ?? LEGACY`. Two lookups that decide an unattributed row differently is
  // how one of them becomes a trapdoor.
  const raw = "minted-mid-deploy";
  db.state.claimTokens.set("tok_null", {
    id: "tok_null",
    tokenHash: createHash("sha256").update(raw).digest("hex"),
    buyerId,
    vehicleRequestId: null,
    purpose: null,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    email: "registered@example.com",
    claimToken: raw,
    zip: "75035",
  });

  assert.equal(r.identityTier, "CLAIM_TOKEN");
});

// ── (v) attribution defaults ────────────────────────────────────────────────

test("(v) no campaign → channel `direct`, UTM fields NULL, url columns NULL not `direct`", async () => {
  const intakeBuyerRequest = await intake();
  const r = await intakeBuyerRequest({
    source: "buyer_dashboard",
    firstName: "Sam",
    email: "sam@example.com",
    zip: "75035",
    // Exactly what the dashboard path sends today: nothing.
  });

  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.acquisitionChannel, "direct", "the SUBMISSION is recorded as direct…");
  assert.equal(vr.utmSource, null, "…and the individual fields stay NULL");
  assert.equal(vr.utmMedium, null);
  assert.equal(vr.utmCampaign, null);
  assert.equal(vr.utmContent, null);
  assert.equal(vr.sourceUrl, null, "a URL column never holds the sentinel `direct`");
  assert.equal(vr.referrer, null);
  assert.equal(vr.affiliateId, null);

  // The IP rule: an address OR a reason. Never a sentinel in an address column.
  assert.equal(vr.ipAddress, null);
  assert.equal(vr.ipUnavailableReason, "UNKNOWN");

  const lead = db.state.opportunities.get(r.buyerOpportunityId)!;
  assert.equal(lead.acquisitionChannel, "direct", "the LEAD carries attribution too — it used to carry none");
  assert.equal(lead.utmSource, null);
});

test("(v) a captured IP is written and no reason is recorded — the two are exclusive", async () => {
  const intakeBuyerRequest = await intake();
  await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    email: "sam@example.com",
    zip: "75035",
    ipAddress: "203.0.113.7",
  });
  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.ipAddress, "203.0.113.7");
  assert.equal(vr.ipUnavailableReason, null, "the Phase 1 migration CHECKs that these are mutually exclusive");
});

test("(v) a real campaign is recorded on both records", async () => {
  const intakeBuyerRequest = await intake();
  const r = await intakeBuyerRequest({
    source: "lp_campaign",
    firstName: "Sam",
    email: "sam@example.com",
    zip: "75035",
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "dfw-suv",
    utmContent: "variant-b",
    sourceUrl: "https://autolenis.com/lp/dfw-suv?utm_source=google",
    referrer: "https://www.google.com/",
  });
  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.acquisitionChannel, "google");
  assert.equal(vr.utmContent, "variant-b");
  assert.equal(vr.referrer, "https://www.google.com/");
  const lead = db.state.opportunities.get(r.buyerOpportunityId)!;
  assert.equal(lead.utmCampaign, "dfw-suv");
});

test("(v) a junk referrer is stored as NULL, not as junk", async () => {
  const intakeBuyerRequest = await intake();
  await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    email: "sam@example.com",
    zip: "75035",
    referrer: "android-app://com.example",
    sourceUrl: "not a url at all",
  });
  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.referrer, null, "§8.2: a valid URL or NULL");
  assert.equal(vr.sourceUrl, null);
});

// ── the rule-16 violation §7.2 traced in the code ───────────────────────────

test("an anonymous submission NEVER attaches to a registered buyer on an asserted email", async () => {
  seedRegisteredBuyer("registered@example.com", "+15550001111");
  const intakeBuyerRequest = await intake();

  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Anyone",
    email: "registered@example.com",
    zip: "75035",
  });

  assert.equal(r.identityTier, "REGISTERED_REQUIRES_CLAIM");
  assert.equal(r.requiresClaim, true);
  assert.equal(r.vehicleRequestId, null, "nothing is written under an account the caller has not proved they control");
  assert.equal(db.state.vehicleRequests.size, 0);
  assert.equal(db.state.buyers.size, 1, "no second buyer either — the registered one is untouched");
  assert.ok(r.buyerOpportunityId, "the lead IS captured; only the attachment is withheld");
});

// The POSITIVE half of the rule-16 branch, which had never executed in any test.
//
// The branch swallows its own failure by design — "the capture still stands, and the
// visitor was told to check their email" — and `fake-prisma`'s claim-token model had
// only `findFirst`, so `issueResumeToken` threw at the mint on every run, was
// swallowed, and the suite went green. The test above proved what is NOT written;
// nothing proved that the link the response promises is actually sent. That is the
// whole substance of the fix, so it is asserted here rather than assumed.
test("the claim link the response promises is actually minted and enqueued", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  const intakeBuyerRequest = await intake();

  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Anyone",
    email: "registered@example.com",
    zip: "75035",
  });

  assert.equal(r.requiresClaim, true);

  // A token exists, is bound to the REGISTERED buyer, and is live.
  assert.equal(db.state.claimTokens.size, 1, "a claim token is minted for the registered address");
  const token = [...db.state.claimTokens.values()][0]!;
  assert.equal(token.buyerId, buyerId, "bound to the account the link must reach");
  assert.equal(token.consumedAt, null, "live — the click is what consumes it");
  assert.ok((token.expiresAt as Date) > new Date(), "and not already expired");

  // And the message that carries it is on the §27 rail, in the same transaction.
  assert.equal(db.state.commsOutbox.size, 1, "exactly one message enqueued");
  const msg = [...db.state.commsOutbox.values()][0]!;
  assert.equal(msg.templateKey, "registered_claim_prompt");
  assert.equal(msg.triggerEvent, "registered_address_offered_anonymously");
  assert.equal(msg.recipientKind, "buyer");
  assert.equal(msg.recipientId, buyerId);
  assert.equal(msg.channel, "email");
});

test("an AUTHENTICATED submission from that same buyer attaches normally", async () => {
  const { buyerId } = seedRegisteredBuyer("registered@example.com");
  const intakeBuyerRequest = await intake();

  const r = await intakeBuyerRequest({
    source: "buyer_dashboard",
    authenticatedBuyerId: buyerId,
    firstName: "Sam",
    email: "registered@example.com",
    zip: "75035",
  });

  assert.equal(r.identityTier, "AUTHENTICATED");
  assert.equal(r.requiresClaim, false);
  assert.ok(r.vehicleRequestId);
  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.buyerId, buyerId);
});
