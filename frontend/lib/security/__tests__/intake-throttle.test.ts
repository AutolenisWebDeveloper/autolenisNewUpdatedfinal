// The bound on the two public intake routes.
//
// Run: pnpm test:intake-throttle
//
// These pin the two decisions that are easy to get wrong and impossible to see
// in production until they bite: an unidentifiable caller must not share ONE
// global bucket, and the address key must be the normalised address so
// `Sam@Example.com ` and `sam@example.com` are one subject rather than two.

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const calls: Array<{ key: string; opts: unknown }> = [];
let nextResult: { ok: boolean; status?: number; message?: string } = { ok: true };

mock.module("@/lib/security/rate-limit", {
  namedExports: {
    limitGeneral: async (key: string, opts: unknown) => {
      calls.push({ key, opts });
      return nextResult;
    },
    clientIpKey: (headers: Headers) =>
      (headers.get("x-forwarded-for")?.split(",")[0].trim()) || headers.get("x-real-ip") || "unknown",
  },
});

async function load() {
  return import("@/lib/security/intake-throttle");
}

beforeEach(() => {
  calls.length = 0;
  nextResult = { ok: true };
});

test("an identifiable IP is throttled, scoped to the caller's route", async () => {
  const { throttleIntakeByIp } = await load();
  const refusal = await throttleIntakeByIp(new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }), "intake");
  assert.equal(refusal, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.key, "intake:ip:203.0.113.7", "the first forwarded hop, namespaced by route");
});

test("an UNIDENTIFIABLE caller is not throttled by IP at all", async () => {
  // `clientIpKey` returns the literal "unknown" with no forwarding header. Keying
  // on it would put every such request in one bucket, so a misconfigured ingress
  // would 429 the whole platform's intake after 20 requests in an hour.
  const { throttleIntakeByIp } = await load();
  const refusal = await throttleIntakeByIp(new Headers(), "intake");
  assert.equal(refusal, null);
  assert.equal(calls.length, 0, "no limiter call is made for an unidentifiable caller");
});

test("a refusal is returned with the store's status and message", async () => {
  const { throttleIntakeByIp } = await load();
  nextResult = { ok: false, status: 429, message: "Too many requests. Please slow down and try again." };
  const refusal = await throttleIntakeByIp(new Headers({ "x-real-ip": "203.0.113.7" }), "intake");
  assert.deepEqual(refusal, { status: 429, message: "Too many requests. Please slow down and try again." });
});

test("the address key is the NORMALISED address, so case and whitespace are one subject", async () => {
  const { throttleIntakeByEmail } = await load();
  await throttleIntakeByEmail("  Sam@Example.COM ", "intake");
  assert.equal(calls[0]!.key, "intake:email:sam@example.com");
});

test("the address half is tighter than the IP half", async () => {
  const { throttleIntakeByIp, throttleIntakeByEmail } = await load();
  await throttleIntakeByIp(new Headers({ "x-real-ip": "203.0.113.7" }), "intake");
  await throttleIntakeByEmail("sam@example.com", "intake");
  const ipTokens = (calls[0]!.opts as { tokens: number }).tokens;
  const emailTokens = (calls[1]!.opts as { tokens: number }).tokens;
  assert.ok(emailTokens < ipTokens, `repeatedly submitting one address is the abuse shape (${emailTokens} < ${ipTokens})`);
});

test("a missing or non-string address is not throttled — the IP half still bounds it", async () => {
  const { throttleIntakeByEmail } = await load();
  assert.equal(await throttleIntakeByEmail(undefined, "intake"), null);
  assert.equal(await throttleIntakeByEmail(42, "intake"), null);
  assert.equal(await throttleIntakeByEmail("not-an-address", "intake"), null);
  assert.equal(calls.length, 0);
});

test("the two routes do not share a bucket", async () => {
  const { throttleIntakeByEmail } = await load();
  await throttleIntakeByEmail("sam@example.com", "intake");
  await throttleIntakeByEmail("sam@example.com", "complete");
  assert.notEqual(calls[0]!.key, calls[1]!.key);
});
