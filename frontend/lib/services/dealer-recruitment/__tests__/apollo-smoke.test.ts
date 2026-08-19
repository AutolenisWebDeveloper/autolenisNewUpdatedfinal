// Apollo smoke-test diagnostic — pure gate/classify/interpret logic + the single
// injectable-fetch runner (fake fetch, no live Apollo). Runs under base `test`.
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo-smoke.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSmokeGates,
  classifyApolloStatus,
  interpretPeopleSearch,
  extractCreditAndRate,
  runApolloPeopleSearchSmoke,
} from "../apollo-smoke.service";

// ── Gates ────────────────────────────────────────────────────────────────────

test("gate: Vercel production is always 404 (even with a correct token)", () => {
  const r = evaluateSmokeGates({ vercelEnv: "production", nodeEnv: "production", providedToken: "s3cret", expectedToken: "s3cret" });
  assert.deepEqual(r, { ok: false, status: 404, body: { error: "Not found" } });
});

test("gate: self-hosted production (VERCEL_ENV unset, NODE_ENV=production) is 404", () => {
  const r = evaluateSmokeGates({ vercelEnv: undefined, nodeEnv: "production", providedToken: "s3cret", expectedToken: "s3cret" });
  assert.deepEqual(r, { ok: false, status: 404, body: { error: "Not found" } });
});

test("gate: 403 when SMOKE_TEST_TOKEN is not configured", () => {
  const r = evaluateSmokeGates({ vercelEnv: "preview", nodeEnv: "production", providedToken: "anything", expectedToken: undefined });
  assert.equal(r.ok, false);
  assert.equal((r as { status: number }).status, 403);
});

test("gate: 403 on missing or wrong token", () => {
  assert.equal(evaluateSmokeGates({ vercelEnv: "preview", nodeEnv: "production", providedToken: null, expectedToken: "s3cret" }).ok, false);
  assert.equal(evaluateSmokeGates({ vercelEnv: "preview", nodeEnv: "production", providedToken: "nope", expectedToken: "s3cret" }).ok, false);
});

test("gate: ok on Vercel preview (NODE_ENV=production) with the correct token", () => {
  assert.deepEqual(evaluateSmokeGates({ vercelEnv: "preview", nodeEnv: "production", providedToken: "s3cret", expectedToken: "s3cret" }), { ok: true });
});

test("gate: ok on local/dev (VERCEL_ENV undefined, NODE_ENV!=production) with the correct token", () => {
  assert.deepEqual(evaluateSmokeGates({ vercelEnv: undefined, nodeEnv: "development", providedToken: "s3cret", expectedToken: "s3cret" }), { ok: true });
});

// ── Error classification ─────────────────────────────────────────────────────

test("classifyApolloStatus maps HTTP codes to error types", () => {
  assert.equal(classifyApolloStatus(401), "bad_key");
  assert.equal(classifyApolloStatus(403), "no_people_search_entitlement");
  assert.equal(classifyApolloStatus(402), "no_credits");
  assert.equal(classifyApolloStatus(429), "rate_limited");
  assert.equal(classifyApolloStatus(500), "other");
});

// ── Search interpretation (the economics signal) ─────────────────────────────

test("interpret: a locked-email contact requires a paid reveal", () => {
  const r = interpretPeopleSearch({
    people: [{ name: "J. Doe", title: "Internet Sales Manager", email: "email_not_unlocked@domain.com", email_status: "verified" }],
  });
  assert.equal(r.contactFound, true);
  assert.equal(r.title, "Internet Sales Manager");
  assert.equal(r.nameReturned, true);
  assert.equal(r.emailReturnedInSearch, false);
  assert.equal(r.emailRequiresPaidReveal, true);
});

test("interpret: a real email returned in search needs no reveal", () => {
  const r = interpretPeopleSearch({ people: [{ name: "J. Doe", title: "BDC Manager", email: "jdoe@realdealer.com", email_status: "verified" }] });
  assert.equal(r.emailReturnedInSearch, true);
  assert.equal(r.emailRequiresPaidReveal, false);
});

test("interpret: no people → contactFound false, both flags false", () => {
  const r = interpretPeopleSearch({ people: [] });
  assert.equal(r.contactFound, false);
  assert.equal(r.emailReturnedInSearch, false);
  assert.equal(r.emailRequiresPaidReveal, false);
});

test("interpret: contact with no email signal does not claim a reveal is available", () => {
  const r = interpretPeopleSearch({ people: [{ name: "J. Doe", title: "Sales", email: null, email_status: "unavailable" }] });
  assert.equal(r.contactFound, true);
  assert.equal(r.emailRequiresPaidReveal, false);
});

// ── Header extraction ────────────────────────────────────────────────────────

test("extractCreditAndRate pulls rate-limit + credit headers, ignores others", () => {
  const r = extractCreditAndRate({
    "x-rate-limit-remaining": "97",
    "x-24-hour-credits-left": "2400",
    "content-type": "application/json",
  });
  assert.equal(r.rateLimit["x-rate-limit-remaining"], "97");
  assert.match(r.creditBalance ?? "", /2400/);
});

// ── Runner (fake fetch — no live Apollo) ─────────────────────────────────────

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { forEach: (cb: (v: string, k: string) => void) => { for (const [k, v] of Object.entries(headers)) cb(v, k); } },
    json: async () => body,
  } as unknown as Response;
}

test("runner: success path reports economics + never leaks email/name + calls Apollo exactly once", async () => {
  let calledUrl = "";
  let callCount = 0;
  let sentBody: Record<string, unknown> = {};
  const fetchImpl = (async (url: string, init: { body: string }) => {
    callCount++;
    calledUrl = url;
    sentBody = JSON.parse(init.body);
    return fakeResponse(200, { people: [{ name: "Jane Rep", title: "Internet Sales Manager", email: "email_not_unlocked@domain.com", email_status: "likely" }] }, { "x-rate-limit-remaining": "99" });
  }) as unknown as typeof fetch;

  const r = await runApolloPeopleSearchSmoke({ apiKey: "k", domain: "longotoyota.com", fetchImpl });
  assert.equal(callCount, 1, "exactly one Apollo call (no paid reveal)");
  assert.match(calledUrl, /\/mixed_people\/search$/);
  assert.deepEqual(sentBody.q_organization_domains_list, ["longotoyota.com"]);
  assert.equal(r.success, true);
  assert.equal(r.emailRequiresPaidReveal, true);
  assert.equal(r.estimatedCreditCostPerReveal, 1);
  assert.equal(r.title, "Internet Sales Manager");
  // redaction: no email/name values anywhere in the output
  const serialized = JSON.stringify(r);
  assert.equal(serialized.includes("Jane Rep"), false);
  assert.equal(serialized.includes("@domain.com"), false);
});

test("runner: non-2xx classifies the error and surfaces Apollo's message", async () => {
  const fetchImpl = (async () => fakeResponse(401, { error: "invalid api key" })) as unknown as typeof fetch;
  const r = await runApolloPeopleSearchSmoke({ apiKey: "bad", domain: "x.com", fetchImpl });
  assert.equal(r.success, false);
  assert.equal(r.httpStatus, 401);
  assert.equal(r.errorType, "bad_key");
  assert.equal(r.message, "invalid api key");
});

test("runner: a thrown fetch (network/timeout) fails closed as 'other'", async () => {
  const fetchImpl = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
  const r = await runApolloPeopleSearchSmoke({ apiKey: "k", domain: "x.com", fetchImpl });
  assert.equal(r.success, false);
  assert.equal(r.errorType, "other");
  assert.equal(r.httpStatus, 0);
});
