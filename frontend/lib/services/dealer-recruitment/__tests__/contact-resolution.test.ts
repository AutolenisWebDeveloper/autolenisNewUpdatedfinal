// A3 — contactable resolution (free tiers). Injected deps; runs under base `test`.
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/dealer-recruitment/__tests__/contact-resolution.test.ts

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { resolveContactableEmail, type ContactResolutionDeps } from "../contact-resolution.service";
import type { EmailEnrichmentResult } from "../email-enrichment.service";

function enrichResult(over: Partial<EmailEnrichmentResult> = {}): EmailEnrichmentResult {
  return {
    email: null, contactName: null, contactTitle: null, contactPhone: null, sourceUrl: null,
    confidence: "none", source: null, contactConfidence: "none", contactSource: null, contactSourceUrl: null,
    ...over,
  };
}

function makeDeps(over: Partial<ContactResolutionDeps> = {}) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prisma = {
    dealerProspect: {
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },
  };
  const deps = {
    prisma: prisma as never,
    supabase: {} as never,
    isEmailSuppressed: mock.fn(async () => false),
    verifyDeliverability: mock.fn(async () => ({ deliverable: true, reason: "mx_ok" })),
    enrich: mock.fn(async () => enrichResult()),
    getRooftopContacts: mock.fn(async () => [] as Array<Record<string, unknown>>),
    upsertContactProfile: mock.fn(async () => ({ id: "dcp" })),
    ...over,
  } as unknown as ContactResolutionDeps;
  return { deps, updates };
}

const cand = (over = {}) => ({ id: "p1", name: "Toyota of Dallas", website: "https://toyotaofdallas.com", city: "Dallas", state: "TX", ...over });

// ─── tier 1: reuse ───────────────────────────────────────────────────────────

test("a still-send-safe VERIFIED address is reused without role-derive or Gemini", async () => {
  const enrich = mock.fn(async () => enrichResult());
  const { deps, updates } = makeDeps({ enrich });
  const r = await resolveContactableEmail(
    cand({ email: "sales@toyotaofdallas.com", emailVerificationStatus: "VERIFIED" }),
    deps,
  );
  assert.equal(r.contactable, true);
  assert.equal(r.source, "reuse");
  assert.equal(enrich.mock.callCount(), 0);
  assert.equal(updates.length, 0); // nothing re-persisted
});

test("a VERIFIED address that is NOW hard-suppressed falls through (not reused)", async () => {
  const { deps } = makeDeps({
    isEmailSuppressed: mock.fn(async (_sb: unknown, email: string) => email === "stale@toyotaofdallas.com"),
  });
  const r = await resolveContactableEmail(
    cand({ email: "stale@toyotaofdallas.com", emailVerificationStatus: "VERIFIED" }),
    deps,
  );
  // reuse rejected → role-derive on the host succeeds instead.
  assert.equal(r.contactable, true);
  assert.equal(r.status, "ROLE_DERIVED");
});

// ─── tier 2: role-derivation (INVARIANT: inferred provenance) ─────────────────

test("role-derivation persists ROLE_DERIVED provenance — never VERIFIED — and skips Gemini", async () => {
  const enrich = mock.fn(async () => enrichResult());
  const { deps, updates } = makeDeps({ enrich });
  const r = await resolveContactableEmail(cand({ email: null }), deps);
  assert.equal(r.contactable, true);
  assert.equal(r.status, "ROLE_DERIVED");
  assert.equal(r.email, "internetsales@toyotaofdallas.com");
  assert.equal(enrich.mock.callCount(), 0); // cheap-first
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.emailVerificationStatus, "ROLE_DERIVED");
  assert.equal(updates[0].data.emailSource, "role_derived");
  assert.notEqual(updates[0].data.emailVerificationStatus, "VERIFIED");
});

test("role walk-down: a suppressed first prefix skips to the next-ranked role inbox", async () => {
  const enrich = mock.fn(async () => enrichResult());
  const { deps } = makeDeps({
    isEmailSuppressed: mock.fn(async (_sb: unknown, email: string) => email.startsWith("internetsales@")),
    enrich,
  });
  const r = await resolveContactableEmail(cand({ email: null }), deps);
  assert.equal(r.contactable, true);
  assert.equal(r.status, "ROLE_DERIVED");
  assert.equal(r.email, "internet@toyotaofdallas.com"); // skipped the suppressed internetsales@
  assert.equal(enrich.mock.callCount(), 0); // resolved within the role tier, no Gemini
});

test("role-derivation exhausts (whole domain has no MX) → falls through to Gemini", async () => {
  const { deps } = makeDeps({
    verifyDeliverability: mock.fn(async (email: string) =>
      email.endsWith("@toyotaofdallas.com") ? { deliverable: false, reason: "no_mx" } : { deliverable: true, reason: "mx_ok" },
    ),
    enrich: mock.fn(async () => enrichResult({ email: "jane@gmail.com", source: "gemini_search_high_confidence" })),
  });
  const r = await resolveContactableEmail(cand({ email: null }), deps);
  assert.equal(r.status, "VERIFIED"); // all role prefixes no-MX → Gemini resolved off-domain
});

// ─── tier 3: Gemini ──────────────────────────────────────────────────────────

test("Gemini resolves a send-safe person email as VERIFIED when role-derive can't run", async () => {
  const { deps, updates } = makeDeps({
    enrich: mock.fn(async () => enrichResult({ email: "jane@toyotaofdallas.com", source: "gemini_search_high_confidence", contactName: "Jane" })),
  });
  const r = await resolveContactableEmail(cand({ email: null, website: null }), deps); // no host → no role-derive
  assert.equal(r.contactable, true);
  assert.equal(r.status, "VERIFIED");
  assert.equal(updates[0].data.emailVerificationStatus, "VERIFIED");
});

// ─── INVARIANT: contactable == send-safe ─────────────────────────────────────

test("INVARIANT: an enriched email that is not MX-deliverable is NOT contactable", async () => {
  const { deps } = makeDeps({
    verifyDeliverability: mock.fn(async () => ({ deliverable: false, reason: "no_mx" })),
    enrich: mock.fn(async () => enrichResult({ email: "jane@toyotaofdallas.com", source: "gemini_search_high_confidence" })),
  });
  const r = await resolveContactableEmail(cand({ email: null, website: null }), deps);
  assert.equal(r.contactable, false);
});

test("INVARIANT: an enriched email that is hard-suppressed is NOT contactable", async () => {
  const { deps } = makeDeps({
    isEmailSuppressed: mock.fn(async () => true),
    enrich: mock.fn(async () => enrichResult({ email: "jane@toyotaofdallas.com", source: "gemini_search_high_confidence" })),
  });
  const r = await resolveContactableEmail(cand({ email: null, website: null }), deps);
  assert.equal(r.contactable, false);
});

test("a prospect with no host and no enriched email is not contactable", async () => {
  const { deps } = makeDeps();
  const r = await resolveContactableEmail(cand({ email: null, website: null }), deps);
  assert.equal(r.contactable, false);
});

// ─── reuse of an existing ROLE_DERIVED address ───────────────────────────────

test("a still-send-safe ROLE_DERIVED address is reused (counts as contactable)", async () => {
  const enrich = mock.fn(async () => enrichResult());
  const { deps } = makeDeps({ enrich });
  const r = await resolveContactableEmail(
    cand({ email: "internetsales@toyotaofdallas.com", emailVerificationStatus: "ROLE_DERIVED" }),
    deps,
  );
  assert.equal(r.contactable, true);
  assert.equal(r.status, "ROLE_DERIVED");
  assert.equal(r.source, "reuse");
  assert.equal(enrich.mock.callCount(), 0);
});

// ─── transient / recency outcomes ────────────────────────────────────────────

test("a transient enrichment error is not contactable and persists nothing (retriable)", async () => {
  const { deps, updates } = makeDeps({
    enrich: mock.fn(async () => enrichResult({ errored: true })),
  });
  const r = await resolveContactableEmail(cand({ email: null, website: null }), deps);
  assert.equal(r.contactable, false);
  assert.equal(updates.length, 0);
});

test("a recency-guard skip is not contactable and persists nothing", async () => {
  const { deps, updates } = makeDeps({
    enrich: mock.fn(async () => enrichResult({ skipped: true })),
  });
  const r = await resolveContactableEmail(cand({ email: null, website: null }), deps);
  assert.equal(r.contactable, false);
  assert.equal(updates.length, 0);
});

// ─── M4b: Gemini ran but produced nothing send-safe → stamp emailEnrichedAt ───

test("M4b: Gemini ran with no email stamps emailEnrichedAt + NONE (suppresses re-hits)", async () => {
  const { deps, updates } = makeDeps({
    enrich: mock.fn(async () => enrichResult({ email: null })),
  });
  const r = await resolveContactableEmail(cand({ email: null, website: null }), deps);
  assert.equal(r.contactable, false);
  assert.equal(updates.length, 1);
  assert.ok(updates[0].data.emailEnrichedAt instanceof Date); // recency window advanced
  assert.equal(updates[0].data.emailVerificationStatus, "NONE");
});

test("M4b: Gemini found an unsafe email stamps emailEnrichedAt + UNVERIFIED, not contactable", async () => {
  const { deps, updates } = makeDeps({
    verifyDeliverability: mock.fn(async () => ({ deliverable: false, reason: "no_mx" })),
    enrich: mock.fn(async () => enrichResult({ email: "jane@toyotaofdallas.com", source: "gemini_search_high_confidence" })),
  });
  const r = await resolveContactableEmail(cand({ email: null, website: null }), deps);
  assert.equal(r.contactable, false);
  assert.equal(updates.length, 1);
  assert.ok(updates[0].data.emailEnrichedAt instanceof Date);
  assert.equal(updates[0].data.emailVerificationStatus, "UNVERIFIED");
});

// ─── B2c: rooftop-shared reuse (tier 0) + write-through ──────────────────────

test("rooftop-shared reuse: a send-safe rooftop contact is reused before any cold work", async () => {
  const enrich = mock.fn(async () => enrichResult());
  const getRooftopContacts = mock.fn(async () => [
    { email: "sales@toyotaofdallas.com", emailVerificationStatus: "VERIFIED", emailVerifiedAt: new Date(), emailSource: "gemini_search_high_confidence" },
  ]);
  const { deps, updates } = makeDeps({ enrich, getRooftopContacts } as never);
  const r = await resolveContactableEmail(cand({ email: null, rooftopId: "rt1" }), deps);
  assert.equal(r.contactable, true);
  assert.equal(r.source, "rooftop_reuse");
  assert.equal(r.email, "sales@toyotaofdallas.com");
  assert.equal(enrich.mock.callCount(), 0); // twin's contact reused — no cold work
  // HIGH-fix: the reused address is persisted onto THIS prospect so the send
  // path (prospect.email) can actually reach it — contactable must be sendable.
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, "p1");
  assert.equal(updates[0].data.email, "sales@toyotaofdallas.com");
});

test("rooftop reuse skips a suppressed shared contact and falls through to role-derive", async () => {
  const getRooftopContacts = mock.fn(async () => [
    { email: "bounced@toyotaofdallas.com", emailVerificationStatus: "VERIFIED", emailVerifiedAt: new Date(), emailSource: "x" },
  ]);
  const { deps } = makeDeps({
    getRooftopContacts,
    isEmailSuppressed: mock.fn(async (_sb: unknown, email: string) => email === "bounced@toyotaofdallas.com"),
  } as never);
  const r = await resolveContactableEmail(cand({ email: null, rooftopId: "rt1" }), deps);
  assert.equal(r.contactable, true);
  assert.equal(r.status, "ROLE_DERIVED"); // suppressed shared contact skipped → role-derive
});

test("write-through: a role-derived resolution is written back to the rooftop profile", async () => {
  const upsertContactProfile = mock.fn(async () => ({ id: "dcp" }));
  const { deps } = makeDeps({ upsertContactProfile } as never);
  await resolveContactableEmail(cand({ email: null, rooftopId: "rt1" }), deps);
  assert.equal(upsertContactProfile.mock.callCount(), 1);
  const [rooftopId, input] = upsertContactProfile.mock.calls[0]!.arguments as unknown as [string, Record<string, unknown>];
  assert.equal(rooftopId, "rt1");
  assert.equal(input.emailVerificationStatus, "ROLE_DERIVED");
});

test("no rooftopId → no rooftop read and no write-through (backward compatible)", async () => {
  const getRooftopContacts = mock.fn(async () => []);
  const upsertContactProfile = mock.fn(async () => ({ id: "dcp" }));
  const { deps } = makeDeps({ getRooftopContacts, upsertContactProfile } as never);
  await resolveContactableEmail(cand({ email: null }), deps); // no rooftopId
  assert.equal(getRooftopContacts.mock.callCount(), 0);
  assert.equal(upsertContactProfile.mock.callCount(), 0);
});

// ─── B2b: bounce → re-resolve (proof #5) ─────────────────────────────────────

test("bounce→re-resolve: a VERIFIED person email that hard-bounced re-resolves down the waterfall", async () => {
  const { deps, updates } = makeDeps({
    isEmailSuppressed: mock.fn(async (_sb: unknown, email: string) => email === "jane@toyotaofdallas.com"),
  });
  const r = await resolveContactableEmail(
    cand({ email: "jane@toyotaofdallas.com", emailVerificationStatus: "VERIFIED" }),
    deps,
  );
  // reuse rejected (bounced/suppressed) → role walk-down resolves a fresh inbox;
  // the rooftop is never stranded on a dead address.
  assert.equal(r.contactable, true);
  assert.equal(r.status, "ROLE_DERIVED");
  assert.equal(r.email, "internetsales@toyotaofdallas.com");
  // The stale person block is cleared — never greet a named person at a role inbox.
  assert.equal(updates[0].data.contactName, null);
  assert.equal(updates[0].data.contactTitle, null);
});

// ─── B2b: staleness re-check (CONTACT_STALE_MONTHS) ──────────────────────────

test("staleness: a FRESH reused contact skips the MX re-check (suppression only)", async () => {
  const verifyDeliverability = mock.fn(async () => ({ deliverable: true, reason: "mx_ok" }));
  const { deps } = makeDeps({ verifyDeliverability });
  const r = await resolveContactableEmail(
    cand({ email: "sales@toyotaofdallas.com", emailVerificationStatus: "VERIFIED", emailVerifiedAt: new Date() }),
    deps,
  );
  assert.equal(r.source, "reuse");
  assert.equal(verifyDeliverability.mock.callCount(), 0); // fresh → no MX lookup
});

test("staleness: a STALE reused contact is MX re-checked before reuse", async () => {
  const verifyDeliverability = mock.fn(async () => ({ deliverable: true, reason: "mx_ok" }));
  const { deps } = makeDeps({ verifyDeliverability });
  const stale = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // ~13 months old
  const r = await resolveContactableEmail(
    cand({ email: "sales@toyotaofdallas.com", emailVerificationStatus: "VERIFIED", emailVerifiedAt: stale }),
    deps,
  );
  assert.equal(r.source, "reuse");
  assert.ok(verifyDeliverability.mock.callCount() >= 1); // stale → MX re-checked
});
