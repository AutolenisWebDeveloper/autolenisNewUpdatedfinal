// RF-F1 — pin the OpenRoad partner hand-off URL shape.
//
// Attribution is revenue-critical: `aid=1445` is AutoLenis's affiliate id and
// `opt_1=<leadId>` is the per-lead reconciliation subid. A silent edit to the
// affiliate id, base path, or query shape would break attribution unnoticed.
// This test pins the exact contract. It intentionally does NOT assert or change
// any behavior around applyv2-multi / customer_id — those remain NOT VERIFIED
// (require live OpenRoad confirmation) and are frozen out of scope.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPartnerRedirectUrl,
  PARTNER_AFFILIATE_ID,
  PARTNER_REDIRECT_BASE,
} from "@/lib/services/refinance/refinance-lead.service";

test("buildPartnerRedirectUrl: exact shape applyone/?aid=1445&opt_1=<leadId>", () => {
  const url = buildPartnerRedirectUrl("clead12345");
  assert.equal(url, "https://www.openroadlending.com/applyone/?aid=1445&opt_1=clead12345");
});

test("aid is the hard-coded affiliate id 1445 and is always present", () => {
  assert.equal(PARTNER_AFFILIATE_ID, "1445");
  const u = new URL(buildPartnerRedirectUrl("abc"));
  assert.equal(u.searchParams.get("aid"), "1445");
});

test("opt_1 carries the lead id verbatim for reconciliation", () => {
  const u = new URL(buildPartnerRedirectUrl("LEAD-xyz-789"));
  assert.equal(u.searchParams.get("opt_1"), "LEAD-xyz-789");
});

test("only aid and opt_1 are emitted — no fabricated/null PII params", () => {
  const u = new URL(buildPartnerRedirectUrl("abc"));
  assert.deepEqual([...u.searchParams.keys()].sort(), ["aid", "opt_1"]);
});

test("base path is the applyone endpoint", () => {
  assert.equal(PARTNER_REDIRECT_BASE, "https://www.openroadlending.com/applyone/");
});

test("empty/blank leadId hard-fails rather than emitting opt_1=", () => {
  assert.throws(() => buildPartnerRedirectUrl(""));
  assert.throws(() => buildPartnerRedirectUrl("   "));
});
