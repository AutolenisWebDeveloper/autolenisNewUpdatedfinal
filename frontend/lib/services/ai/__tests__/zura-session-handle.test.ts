// The server-issued session handle for the anonymous public concierge.
//
// The finding it closes: the public concierge's only identity was a `sessionId`
// the BROWSER minted and posted, so a caller could open unlimited parallel
// sessions and could address any session id it chose. These tests assert the two
// properties that make the replacement worth having — the token is unforgeable,
// and the gate claim inside it (which is what makes CONSENT server-verified)
// cannot be set by a client.
//
//   pnpm test:zura

import test, { beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// The module under test is `server-only`, which throws outside a server bundle.
// Neutralise it exactly as the affiliate and dealer-recruitment suites do.
mock.module("server-only", { namedExports: {}, defaultExport: {} });

type SessionHandle = typeof import("../zura-session-handle");
let mod: SessionHandle;

const ORIGINAL_SECRET = process.env.ZURA_SESSION_SECRET;
const ORIGINAL_CRON = process.env.CRON_SECRET;

beforeEach(async () => {
  process.env.ZURA_SESSION_SECRET = "test-session-secret";
  process.env.CRON_SECRET = "";
  mod = await import("../zura-session-handle");
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ZURA_SESSION_SECRET;
  else process.env.ZURA_SESSION_SECRET = ORIGINAL_SECRET;
  process.env.CRON_SECRET = ORIGINAL_CRON ?? "";
});

// ─── Round trip ──────────────────────────────────────────────────────────────

test("a freshly issued handle verifies and carries its claims", () => {
  const started = mod.startSession(false);
  assert.ok(started);
  const claims = mod.verifySessionHandle(started.handle);
  assert.ok(claims);
  assert.equal(claims.sid, started.claims.sid);
  assert.equal(claims.gate, false);
});

test("two sessions get different, server-minted ids", () => {
  const a = mod.startSession(false);
  const b = mod.startSession(false);
  assert.ok(a && b);
  assert.notEqual(a.claims.sid, b.claims.sid);
});

// ─── Unforgeable ─────────────────────────────────────────────────────────────

test("a client-chosen UUID is NOT a valid handle", () => {
  assert.equal(mod.verifySessionHandle("11111111-2222-3333-4444-555555555555"), null);
});

test("a tampered payload is rejected", () => {
  const started = mod.startSession(false);
  assert.ok(started);
  const [, sig] = started.handle.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({ sid: "attacker-chosen", iat: Date.now(), gate: true }),
    "utf8",
  ).toString("base64url");
  assert.equal(mod.verifySessionHandle(`${forgedPayload}.${sig}`), null);
});

test("a handle signed with the WRONG secret is rejected", () => {
  const payload = Buffer.from(
    JSON.stringify({ sid: "s1", iat: Date.now(), gate: true }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", "not-the-secret").update(payload).digest("base64url");
  assert.equal(mod.verifySessionHandle(`${payload}.${sig}`), null);
});

test("a client cannot grant itself the GATE claim", () => {
  // This is the whole reason consent can be server-verified without a schema
  // change: the gate flag is covered by the signature.
  const payload = Buffer.from(
    JSON.stringify({ sid: "s1", iat: Date.now(), gate: true }),
    "utf8",
  ).toString("base64url");
  assert.equal(mod.verifySessionHandle(`${payload}.anything`), null);
});

test("malformed shapes are rejected rather than repaired", () => {
  for (const bad of ["", ".", "nodot", "a.b.c.d", null, undefined, 42, {}]) {
    assert.equal(mod.verifySessionHandle(bad as unknown), null, `accepted: ${String(bad)}`);
  }
});

test("a payload missing a required claim is rejected", () => {
  const key = "test-session-secret";
  for (const claims of [{ iat: Date.now(), gate: true }, { sid: "s", gate: true }, { sid: "s", iat: Date.now() }]) {
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const sig = createHmac("sha256", key).update(payload).digest("base64url");
    assert.equal(mod.verifySessionHandle(`${payload}.${sig}`), null);
  }
});

// ─── Expiry ──────────────────────────────────────────────────────────────────

test("an expired handle is rejected", () => {
  const key = "test-session-secret";
  const payload = Buffer.from(
    JSON.stringify({ sid: "s1", iat: Date.now() - mod.SESSION_HANDLE_TTL_MS - 1000, gate: true }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", key).update(payload).digest("base64url");
  assert.equal(mod.verifySessionHandle(`${payload}.${sig}`), null);
});

test("a FUTURE-dated handle is rejected too", () => {
  // Otherwise a leaked secret would yield tokens with unbounded lifetime.
  const key = "test-session-secret";
  const payload = Buffer.from(
    JSON.stringify({ sid: "s1", iat: Date.now() + 60 * 60 * 1000, gate: true }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", key).update(payload).digest("base64url");
  assert.equal(mod.verifySessionHandle(`${payload}.${sig}`), null);
});

// ─── Degrades CLOSED ─────────────────────────────────────────────────────────

test("with NO secret configured, minting fails rather than issuing an unsigned handle", () => {
  delete process.env.ZURA_SESSION_SECRET;
  process.env.CRON_SECRET = "";
  assert.equal(mod.isSessionHandleConfigured(), false);
  assert.equal(mod.mintSessionHandle({ sid: "s1", gate: true }), null);
  assert.equal(mod.startSession(true), null);
  assert.equal(mod.verifySessionHandle("anything.atall"), null);
});

test("CRON_SECRET is accepted as the fallback signing key", () => {
  delete process.env.ZURA_SESSION_SECRET;
  process.env.CRON_SECRET = "cron-fallback-secret";
  assert.equal(mod.isSessionHandleConfigured(), true);
  const started = mod.startSession(true);
  assert.ok(started);
  assert.ok(mod.verifySessionHandle(started.handle));
});

// ─── Server-side lead-gate validation ────────────────────────────────────────

test("a valid gate submission is accepted and normalised", () => {
  const gate = mod.validateGateSubmission({ firstName: "  Ada  ", email: "  ADA@Example.COM " });
  assert.deepEqual(gate, { firstName: "Ada", email: "ada@example.com" });
});

test("an email alone is NOT a gate acceptance", () => {
  // This is the exact defect: consent was written because an email was merely
  // PRESENT in the body, with no name and no validation.
  assert.equal(mod.validateGateSubmission({ email: "ada@example.com" }), null);
});

test("a malformed or oversized submission is not a gate acceptance", () => {
  assert.equal(mod.validateGateSubmission({ firstName: "Ada", email: "not-an-email" }), null);
  assert.equal(mod.validateGateSubmission({ firstName: "Ada", email: "a@b" }), null);
  assert.equal(mod.validateGateSubmission({ firstName: "  ", email: "ada@example.com" }), null);
  assert.equal(mod.validateGateSubmission({ firstName: "x".repeat(200), email: "ada@example.com" }), null);
  assert.equal(
    mod.validateGateSubmission({ firstName: "Ada", email: `${"x".repeat(250)}@example.com` }),
    null,
  );
  assert.equal(mod.validateGateSubmission({ firstName: 42, email: {} }), null);
});
