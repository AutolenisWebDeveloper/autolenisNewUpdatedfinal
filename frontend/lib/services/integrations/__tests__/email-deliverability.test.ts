// Y1 — MX-deliverability adapter. Fail-closed: unless an MX record is confirmed,
// the address is treated as not-deliverable so we never persist (and later cold-
// email) an address whose domain cannot receive mail.
//
// node:dns/promises is module-mocked, so run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/integrations/__tests__/email-deliverability.test.ts
//
// NOTE: real DNS resolution is NOT VERIFIED here (offline / hermetic) — these
// tests pin the branching logic against a mocked resolver only.

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Swappable resolver behavior, re-pointed per test.
let resolveMxImpl: (domain: string) => Promise<Array<{ exchange: string; priority: number }>> =
  async () => [{ exchange: "mx.example.com", priority: 10 }];

mock.module("node:dns/promises", {
  defaultExport: { resolveMx: (d: string) => resolveMxImpl(d) },
  namedExports: { resolveMx: (d: string) => resolveMxImpl(d) },
});

async function load() {
  const mod = await import("../email-deliverability.service");
  return mod.verifyEmailDeliverability;
}

beforeEach(() => {
  resolveMxImpl = async () => [{ exchange: "mx.example.com", priority: 10 }];
});

test("valid address on a domain with MX records is deliverable", async () => {
  const verifyEmailDeliverability = await load();
  const r = await verifyEmailDeliverability("sales@dealer.com");
  assert.equal(r.deliverable, true);
  assert.equal(r.reason, "mx_ok");
});

test("domain with NO MX records is not deliverable", async () => {
  resolveMxImpl = async () => [];
  const verifyEmailDeliverability = await load();
  const r = await verifyEmailDeliverability("sales@no-mx-dealer.com");
  assert.equal(r.deliverable, false);
  assert.equal(r.reason, "no_mx");
});

test("DNS lookup throwing (offline / SERVFAIL) fails closed", async () => {
  resolveMxImpl = async () => {
    throw new Error("ENOTFOUND");
  };
  const verifyEmailDeliverability = await load();
  const r = await verifyEmailDeliverability("sales@broken-dealer.com");
  assert.equal(r.deliverable, false);
  assert.equal(r.reason, "mx_lookup_failed");
});

test("malformed address is rejected without a DNS call", async () => {
  let called = false;
  resolveMxImpl = async () => {
    called = true;
    return [{ exchange: "mx", priority: 1 }];
  };
  const verifyEmailDeliverability = await load();
  const r = await verifyEmailDeliverability("info at dealer dot com");
  assert.equal(r.deliverable, false);
  assert.equal(r.reason, "invalid_format");
  assert.equal(called, false);
});

test("empty / missing address is rejected as invalid_format", async () => {
  const verifyEmailDeliverability = await load();
  const r = await verifyEmailDeliverability("");
  assert.equal(r.deliverable, false);
  assert.equal(r.reason, "invalid_format");
});
