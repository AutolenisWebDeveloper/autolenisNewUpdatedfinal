// Unit tests for the recipient timezone resolver (Fix B polish).
// Run with:  npx tsx --test lib/crm/__tests__/recipient-timezone.test.ts
//
// Focus: ZIP3 takes PRECEDENCE over the state→zone map when both are present,
// so a split-zone state resolves to the recipient's actual zone (El Paso, TX is
// Mountain even though TX's dominant zone is Central).

import test from "node:test";
import assert from "node:assert/strict";
import { resolveRecipientTimezone } from "../recipient-timezone";

test("ZIP3 precedence: El-Paso-style (TX + Mountain ZIP) resolves to Mountain, not Central", () => {
  // 79901 = El Paso, TX. State map says TX → America/Chicago (Central), but the
  // ZIP3 (799) pins the actual zone to America/Denver (Mountain).
  assert.equal(resolveRecipientTimezone("TX", "79901"), "America/Denver");
  // 798xx is the other El-Paso/Hudspeth prefix.
  assert.equal(resolveRecipientTimezone("TX", "79835"), "America/Denver");
});

test("ZIP3 precedence: non-split TX ZIP still resolves to Central", () => {
  // 75001 = Dallas, TX → Central. ZIP3 and state agree.
  assert.equal(resolveRecipientTimezone("TX", "75001"), "America/Chicago");
});

test("state is the fallback when ZIP is absent or unresolvable", () => {
  assert.equal(resolveRecipientTimezone("TX", null), "America/Chicago");
  assert.equal(resolveRecipientTimezone("CA", undefined), "America/Los_Angeles");
  // ZIP with too few digits cannot resolve → fall back to state.
  assert.equal(resolveRecipientTimezone("CO", "8"), "America/Denver");
});

test("neither state nor zip resolves → null (caller applies CONUS-safe envelope)", () => {
  assert.equal(resolveRecipientTimezone(null, null), null);
  assert.equal(resolveRecipientTimezone("ZZ", "abc"), null);
});

test("ZIP-only still resolves (no state provided)", () => {
  assert.equal(resolveRecipientTimezone(null, "79901"), "America/Denver");
  assert.equal(resolveRecipientTimezone(undefined, "90001"), "America/Los_Angeles");
});
