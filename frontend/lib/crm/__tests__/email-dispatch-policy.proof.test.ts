// Proof tests for the email effective-type gate (computeEffectiveEmailType).
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/email-dispatch-policy.proof.test.ts
//
// Invariant under proof: the caller-supplied type label can NEVER, on its own,
// unlock a consent-free send. A send is genuinely transactional ONLY when it
// declares 'transactional' AND uses an allowlisted template_key. Everything else
// (marketing label, raw html with no key, or an UNLISTED key) collapses to
// 'marketing' → consent_email required at the dispatch route.

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeEffectiveEmailType,
  TRANSACTIONAL_TEMPLATE_KEYS,
} from "../email-dispatch-policy";

// The seven LIVE buyer-lifecycle keys actually dispatched by the nurture
// campaigns (migrations/09_nurture_templates_all.sql, all category
// 'transactional'). Regression guard for the allowlist/seed-key drift defect
// where the allowlist referenced phantom keys (offer_ready, auction_activated…)
// that exist in no seed, so 6 of these genuinely-transactional emails were being
// downgraded to marketing and consent-blocked.
const LIVE_LIFECYCLE_KEYS = [
  "vr_received",
  "auction_live",
  "offer_in",
  "offer_multiple",
  "deal_formed",
  "deposit_confirmed",
  "contract_signed",
] as const;

test("ALLOWED: every live lifecycle key, declared transactional, stays transactional", () => {
  for (const key of LIVE_LIFECYCLE_KEYS) {
    assert.ok(
      TRANSACTIONAL_TEMPLATE_KEYS.has(key),
      `${key} must be on the transactional allowlist`,
    );
    assert.equal(
      computeEffectiveEmailType("transactional", key),
      "transactional",
      `${key} declared transactional must resolve transactional (no consent gate)`,
    );
  }
});

test("BLOCKED: a transactional label on an UNLISTED key collapses to marketing", () => {
  assert.equal(
    computeEffectiveEmailType("transactional", "welcome_d0"),
    "marketing",
    "welcome_d0 is a nurture (non-allowlisted) key → marketing → consent required",
  );
  assert.equal(
    computeEffectiveEmailType("transactional", "not_a_real_key"),
    "marketing",
  );
});

test("BLOCKED: raw payload (no template_key) can never be transactional", () => {
  assert.equal(computeEffectiveEmailType("transactional", undefined), "marketing");
  assert.equal(computeEffectiveEmailType("transactional", null), "marketing");
});

test("BLOCKED: a marketing label is always marketing, even on an allowlisted key", () => {
  assert.equal(computeEffectiveEmailType("marketing", "vr_received"), "marketing");
});
