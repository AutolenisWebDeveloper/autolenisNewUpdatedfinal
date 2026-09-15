// §13-D30's invited-signer link — the six conditions of the owner's authorization, as tests.
//
// The authorization was conditional, and the conditions are the authorization rather than
// decoration. Each one gets a test that fails if the condition is dropped, so "we built it
// under these constraints" is a claim the suite can check rather than a sentence in a commit.
//
// THE DEFECT BEHIND IT. A required co-buyer had no reachable signing surface at all: the
// emailed link landed on a Supabase-authenticated buyer page, the co-buyer has no account by
// the owner's own §13-D30 ruling, and every deal with `is_required_signer` set deadlocked at
// SIGNING_PENDING until the envelope expired at 14 days.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/esign/__tests__/phase8-invited-signer.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
mock.module("@/lib/services/dealer-recruitment/account-claim.service", {
  namedExports: {
    hashToken: sha,
    generateRawToken: () => "a".repeat(64),
    INVITATION_TOKEN_TTL_MS: 7 * 24 * 3600_000,
  },
});

const HOUR = 3600_000;
interface EnvRow {
  id: string; dealId: string; coBuyerId: string | null; signerKind: string; status: string;
  expiresAt: Date | null; documentVersionId: string | null; documentHash: string | null;
  signerAccessTokenHash: string | null;
  signerAccessTokenExpiresAt: Date | null;
  signerAccessTokenConsumedAt: Date | null;
  deal: { buyerId: string; vin: string | null; vehicleYear: number | null; vehicleMake: string | null; vehicleModel: string | null; buyer: { firstName: string } | null } | null;
  coBuyer: { id: string; buyerId: string; legalFirstName: string | null; legalLastName: string | null; isRequiredSigner: boolean } | null;
}

let env: EnvRow;
let updateManyCalls: { where: Record<string, unknown> }[] = [];

function freshEnvelope(): EnvRow {
  return {
    id: "env_co", dealId: "d1", coBuyerId: "cb1", signerKind: "CO_BUYER", status: "SENT",
    expiresAt: new Date(Date.now() + 14 * 24 * HOUR),
    documentVersionId: "cv1", documentHash: "hash1",
    signerAccessTokenHash: sha("a".repeat(64)),
    signerAccessTokenExpiresAt: new Date(Date.now() + 72 * HOUR),
    signerAccessTokenConsumedAt: null,
    deal: { buyerId: "b1", vin: "1HGCM82633A004352", vehicleYear: 2021, vehicleMake: "Honda", vehicleModel: "Accord", buyer: { firstName: "Ada" } },
    coBuyer: { id: "cb1", buyerId: "b1", legalFirstName: "Co", legalLastName: "Signer", isRequiredSigner: true },
  };
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      eSignEnvelope: {
        findUnique: async (args: { where: { signerAccessTokenHash: string } }) =>
          env.signerAccessTokenHash === args.where.signerAccessTokenHash ? env : null,
        findFirst: async () => env,
        update: async ({ data }: { data: Partial<EnvRow> }) => { Object.assign(env, data); return env; },
        updateMany: async (args: { where: Record<string, unknown>; data: Partial<EnvRow> }) => {
          updateManyCalls.push({ where: args.where });
          // Model the real CAS: only matches while consumedAt is still null.
          if (args.where.signerAccessTokenConsumedAt === null && env.signerAccessTokenConsumedAt !== null) {
            return { count: 0 };
          }
          Object.assign(env, args.data);
          return { count: 1 };
        },
      },
    },
  },
});

const mod = () => import("../invited-signer.service");

beforeEach(() => { env = freshEnvelope(); updateManyCalls = []; });

// ── CONDITION 2 — bound to BOTH the deal and the co-buyer row ───────────────

test("CONDITION 2: a token on a BUYER envelope is refused, never honoured as a co-buyer link", async () => {
  env.signerKind = "BUYER";
  const { resolveSignerToken } = await mod();
  const res = await resolveSignerToken("a".repeat(64));
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, "not_a_co_buyer_token",
    "a bearer token must never be able to sign as the PRIMARY buyer");
});

test("CONDITION 2: a co-buyer re-pointed to a different buyer no longer resolves", async () => {
  env.coBuyer!.buyerId = "b_someone_else";
  const { resolveSignerToken } = await mod();
  const res = await resolveSignerToken("a".repeat(64));
  assert.equal(res.ok === false && res.reason, "subject_mismatch");
});

test("CONDITION 2: a co-buyer who is no longer a REQUIRED signer cannot sign on a stale link", async () => {
  env.coBuyer!.isRequiredSigner = false;
  const { resolveSignerToken } = await mod();
  const res = await resolveSignerToken("a".repeat(64));
  assert.equal(res.ok === false && res.reason, "subject_mismatch",
    "the deal's requirement changed; the link must not outlive it");
});

// ── CONDITION 3 — short expiry, ceilinged by the envelope ───────────────────

test("CONDITION 3: the token expiry is CAPPED at the envelope's, never beyond it", async () => {
  // Envelope closes in 6 hours; the 72-hour TTL must not win.
  env.expiresAt = new Date(Date.now() + 6 * HOUR);
  const { issueSignerToken } = await mod();
  const issued = await issueSignerToken({ dealId: "d1", coBuyerId: "cb1" });
  assert.ok(issued);
  assert.equal(issued.expiresAt.getTime(), env.expiresAt.getTime(),
    "a signing token must never outlive the version it signs");
});

test("CONDITION 3: the TTL wins when it is the earlier of the two", async () => {
  env.expiresAt = new Date(Date.now() + 14 * 24 * HOUR);
  const { issueSignerToken, SIGNER_TOKEN_TTL_MS } = await mod();
  const before = Date.now();
  const issued = await issueSignerToken({ dealId: "d1", coBuyerId: "cb1" });
  assert.ok(issued);
  const ttlHours = (issued.expiresAt.getTime() - before) / HOUR;
  assert.ok(ttlHours > 71 && ttlHours < 73, `expected ~72h, got ${ttlHours}`);
  assert.equal(SIGNER_TOKEN_TTL_MS, 72 * HOUR);
});

test("CONDITION 3: BOTH expiries are checked — an expired ENVELOPE refuses a live token", async () => {
  env.expiresAt = new Date(Date.now() - HOUR);              // envelope lapsed
  env.signerAccessTokenExpiresAt = new Date(Date.now() + HOUR); // token still live
  const { resolveSignerToken } = await mod();
  const res = await resolveSignerToken("a".repeat(64));
  assert.equal(res.ok === false && res.reason, "expired",
    "a signature must never land on a superseded version because the token was still valid");
});

// ── CONDITION 1 — single use ────────────────────────────────────────────────

test("CONDITION 1: the token is consumed under a CAS — two concurrent clicks, one winner", async () => {
  const { consumeSignerToken } = await mod();
  const first = await consumeSignerToken("env_co");
  const second = await consumeSignerToken("env_co");
  assert.equal(first, true, "the first click spends the token");
  assert.equal(second, false, "the second must NOT — Phase 5's H2 was a token never consumed");
  assert.ok(
    updateManyCalls.every((c) => c.where.signerAccessTokenConsumedAt === null),
    "consumption must be a compare-and-swap on NULL, not an unconditional write",
  );
});

test("CONDITION 1: a consumed token resolves as CONSUMED, and is never replayable", async () => {
  env.signerAccessTokenConsumedAt = new Date();
  const { resolveSignerToken } = await mod();
  const res = await resolveSignerToken("a".repeat(64));
  assert.equal(res.ok === false && res.reason, "consumed");
});

test("CONDITION 1: re-issuing refuses once the token has been spent", async () => {
  env.signerAccessTokenConsumedAt = new Date();
  const { issueSignerToken } = await mod();
  assert.equal(await issueSignerToken({ dealId: "d1", coBuyerId: "cb1" }), null,
    "a spent signature must not be re-openable by minting a fresh link");
});

// ── CONDITION 6 — a spent or expired link is a NAMED STATE ──────────────────

test("CONDITION 6: every refusal carries a reason a page can render as a sentence", async () => {
  const { resolveSignerToken } = await mod();
  const cases: Array<[() => void, string]> = [
    [() => { env.signerAccessTokenConsumedAt = new Date(); }, "consumed"],
    [() => { env.signerAccessTokenExpiresAt = new Date(Date.now() - HOUR); }, "expired"],
    [() => { env.status = "VOIDED"; }, "envelope_not_signable"],
    [() => { env.signerKind = "BUYER"; }, "not_a_co_buyer_token"],
  ];
  for (const [mutate, expected] of cases) {
    env = freshEnvelope();
    mutate();
    const res = await resolveSignerToken("a".repeat(64));
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.reason, expected);
  }
  // An unknown token is "not_found" — never a crash, and never a hint that some other
  // token would have worked.
  env = freshEnvelope();
  const unknown = await resolveSignerToken("b".repeat(64));
  assert.equal(unknown.ok === false && unknown.reason, "not_found");
});

test("CONDITION 6: an already-COMPLETED envelope reads as CONSUMED, not as a broken link", async () => {
  // The common case: the co-buyer signed, then clicked the emailed link again.
  env.status = "COMPLETED";
  const { resolveSignerToken } = await mod();
  const res = await resolveSignerToken("a".repeat(64));
  assert.equal(res.ok === false && res.reason, "consumed",
    "clicking twice is the COMMON case; the second click explains rather than fails");
});

// ── CONDITION 4 — this surface and nothing else ─────────────────────────────

test("CONDITION 4: the view discloses only what the co-buyer is signing", async () => {
  const { resolveSignerToken } = await mod();
  const res = await resolveSignerToken("a".repeat(64));
  assert.equal(res.ok, true);
  if (!res.ok) return;

  // The projection is an allowlist, asserted as an exact key set. A field added to
  // InvitedSignerView without a deliberate decision fails HERE, which is the point: every
  // widening of what a bearer token discloses should have to be argued for.
  assert.deepEqual(
    Object.keys(res.view).sort(),
    [
      "coBuyerId", "coBuyerName", "dealId", "documentHash", "documentVersionId",
      "envelopeId", "primaryBuyerFirstName", "signingClosesAt", "vehicle", "vin",
    ],
    "a bearer token's disclosure surface must not widen silently",
  );
  // Of the primary buyer, the FIRST NAME only — enough to know whose contract this is.
  assert.equal(res.view.primaryBuyerFirstName, "Ada");
  assert.ok(!JSON.stringify(res.view).includes("lastName"));
  // Whichever window closes FIRST is what the co-buyer is told.
  assert.equal(res.view.signingClosesAt?.getTime(), env.signerAccessTokenExpiresAt!.getTime());
});

test("a garbage or truncated token is refused before any database read", async () => {
  const { resolveSignerToken } = await mod();
  for (const bad of ["", "short", "x".repeat(31)]) {
    const res = await resolveSignerToken(bad);
    assert.equal(res.ok === false && res.reason, "not_found");
  }
});

// ── THE DEADLOCK ITSELF ─────────────────────────────────────────────────────
//
// Every test above checks one condition of the authorization. This one checks the thing the
// authorization was FOR: that a required co-buyer now has a reachable route to a signature.
//
// It is written as a property of the link rather than of the UI, because the defect was never
// in the ceremony — it was that the URL pointed at a page the co-buyer could not open. A test
// that renders the component would have passed throughout the deadlock.

test("THE DEADLOCK: a co-buyer's link no longer points at an account they do not have", async () => {
  const { renderSignatureRequired } = await import("@/lib/services/comms/phase8-email-content");

  // BEFORE: the link went to /buyer/esign, which calls requireBuyer() and redirects to
  // Supabase sign-in. The co-buyer has no account by §13-D30, so this was a dead end.
  //
  // THAT SHAPE NO LONGER COMPILES, which is a stronger guarantee than this test could give
  // at runtime. `SignatureRequiredParams` is a union: `{ isCoBuyer: true; signerToken: string }`
  // or `{ isCoBuyer: false; signerToken?: never }`. A co-buyer render without a token is a
  // type error, so the deadlock cannot be reintroduced by a future caller forgetting one.
  // The line below is deliberately kept and commented rather than deleted — it documents the
  // defect, and uncommenting it must fail `pnpm typecheck`:
  //
  //   renderSignatureRequired({ signerName: "Co", isCoBuyer: true, vehicle: "v",
  //                             expiresAt: new Date(), dealId: "d1" });
  //   //                       ^ Property 'signerToken' is missing

  // AFTER: a tokenised link to the public ceremony.
  const withToken = renderSignatureRequired({
    signerName: "Co Signer", isCoBuyer: true, vehicle: "2021 Honda Accord",
    expiresAt: new Date(Date.now() + 14 * 24 * HOUR), dealId: "d1", signerToken: "t".repeat(64),
  });
  assert.ok(withToken.text.includes(`/esign/invited/${"t".repeat(64)}`),
    "the co-buyer's link must carry their token to the public signing surface");
  assert.ok(withToken.text.includes("do not need an AutoLenis account"),
    "and should say so — the previous link implied one was required");

  // The PRIMARY buyer is unaffected: still their own authenticated page, no token.
  const buyer = renderSignatureRequired({
    signerName: "Ada", isCoBuyer: false, vehicle: "2021 Honda Accord",
    expiresAt: new Date(Date.now() + 14 * 24 * HOUR), dealId: "d1",
  });
  assert.ok(buyer.text.includes("/buyer/esign"), "the buyer signs through their own session");
  assert.ok(!buyer.text.includes("/esign/invited/"), "and is never issued a bearer link");
});

test("THE DEADLOCK: the raw token appears in the email and in NO other rendered output", async () => {
  const { renderSignatureRequired, renderSignatureReminder } = await import("@/lib/services/comms/phase8-email-content");
  const RAW = "t".repeat(64);
  const req = renderSignatureRequired({
    signerName: "Co Signer", isCoBuyer: true, vehicle: "2021 Honda Accord",
    expiresAt: new Date(Date.now() + 14 * HOUR), dealId: "d1", signerToken: RAW,
  });
  // Present exactly where it must be...
  assert.ok(req.html.includes(RAW) && req.text.includes(RAW));
  // ...and the REMINDER does not carry it. A reminder is sent later, to the same inbox, and
  // minting a second live credential for one signature is the thing re-issue must avoid.
  const rem = renderSignatureReminder({
    signerName: "Co Signer", vehicle: "2021 Honda Accord",
    expiresAt: new Date(Date.now() + HOUR), expired: false, dealId: "d1",
  });
  assert.ok(!rem.html.includes(RAW) && !rem.text.includes(RAW));
});
