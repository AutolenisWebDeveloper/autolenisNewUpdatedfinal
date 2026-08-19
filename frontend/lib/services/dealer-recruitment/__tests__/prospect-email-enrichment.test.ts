// Y1 — enrichProspectEmailsForOpportunity: the bounded, verify-before-persist
// email-acquisition pass that feeds the outreach stage.
//
// All external effects are injected (prisma, enrich, verifyDeliverability,
// isEmailHardSuppressed, supabase), so this runs under plain `pnpm test` with no
// module mocks.
//
// Run with:
//   npx tsx --test lib/services/dealer-recruitment/__tests__/prospect-email-enrichment.test.ts

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { enrichProspectEmailsForOpportunity } from "../prospect-email-enrichment.service";
import type { EmailEnrichmentResult } from "../email-enrichment.service";

// A full parsed enrichment result with overridable fields.
function enrichResult(over: Partial<EmailEnrichmentResult> = {}): EmailEnrichmentResult {
  return {
    email: null,
    contactName: null,
    contactTitle: null,
    contactPhone: null,
    sourceUrl: null,
    confidence: "none",
    source: null,
    contactConfidence: "none",
    contactSource: null,
    contactSourceUrl: null,
    ...over,
  };
}

type Prospect = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  website: string | null;
};

// Fake prisma: the initial load carries `buyerOppId`; the dedup candidate query
// does not. Every update is captured.
function makePrisma(prospects: Prospect[], candidates: unknown[] = []) {
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const prisma = {
    dealerProspect: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        if (args.where.buyerOppId) return prospects;
        return candidates;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push(args);
        return {};
      },
    },
  };
  return { prisma, updates };
}

const baseProspect = (over: Partial<Prospect> = {}): Prospect => ({
  id: "p1",
  name: "Toyota of Dallas",
  city: "Dallas",
  state: "TX",
  zip: "75001",
  website: "https://toyotaofdallas.com",
  ...over,
});

// A contacted cross-opportunity duplicate row (different id, same host, has email).
const contactedDuplicate = {
  id: "other_1",
  name: "Toyota of Dallas",
  website: "https://www.toyotaofdallas.com/inventory",
  zip: "75001",
  status: "CONTACTED",
};

const deps = (over: Record<string, unknown>) =>
  ({
    supabase: {} as never,
    isEmailHardSuppressed: async () => false,
    verifyDeliverability: async () => ({ deliverable: true, reason: "mx_ok" }),
    ...over,
  }) as never;

// ─── (i) verified, non-suppressed, non-duplicate → persists email + VERIFIED ──

test("verified deliverable non-suppressed result persists email + emailVerifiedAt + VERIFIED", async () => {
  const { prisma, updates } = makePrisma([baseProspect()]);
  const enrich = mock.fn(async (_input: { persist?: boolean }) =>
    enrichResult({ email: "sales@toyotaofdallas.com", source: "gemini_search_high_confidence" }),
  );

  const counts = await enrichProspectEmailsForOpportunity(
    "opp_1",
    deps({ prisma, enrich }),
  );

  assert.equal(counts.verified, 1);
  assert.equal(counts.processed, 1);
  assert.equal(updates.length, 1);
  const data = updates[0].data;
  assert.equal(data.email, "sales@toyotaofdallas.com");
  assert.equal(data.emailSource, "gemini_search_high_confidence");
  assert.equal(data.emailVerificationStatus, "VERIFIED");
  assert.ok(data.emailVerifiedAt instanceof Date);
  // enrich must be asked NOT to persist.
  assert.equal(enrich.mock.calls[0].arguments[0]?.persist, false);
});

// ─── (ii) MX-fail (undeliverable) → NO email, UNVERIFIED ─────────────────────

test("undeliverable email persists NO email and UNVERIFIED", async () => {
  const { prisma, updates } = makePrisma([baseProspect()]);
  const enrich = mock.fn(async () =>
    enrichResult({ email: "sales@toyotaofdallas.com", source: "gemini_search_high_confidence" }),
  );

  const counts = await enrichProspectEmailsForOpportunity(
    "opp_1",
    deps({ prisma, enrich, verifyDeliverability: async () => ({ deliverable: false, reason: "no_mx" }) }),
  );

  assert.equal(counts.unverified, 1);
  assert.equal(counts.verified, 0);
  const data = updates[0].data;
  assert.equal(data.email, undefined);
  assert.equal(data.emailVerificationStatus, "UNVERIFIED");
  assert.equal(data.emailVerifiedAt, undefined);
});

// ─── (iii) hard-suppressed → NO email, SUPPRESSED ────────────────────────────

test("hard-suppressed email persists NO email and SUPPRESSED", async () => {
  const { prisma, updates } = makePrisma([baseProspect()]);
  const enrich = mock.fn(async () =>
    enrichResult({ email: "bounced@toyotaofdallas.com", source: "gemini_search_high_confidence" }),
  );
  const verify = mock.fn(async () => ({ deliverable: true, reason: "mx_ok" }));

  const counts = await enrichProspectEmailsForOpportunity(
    "opp_1",
    deps({ prisma, enrich, isEmailHardSuppressed: async () => true, verifyDeliverability: verify }),
  );

  assert.equal(counts.suppressed, 1);
  const data = updates[0].data;
  assert.equal(data.email, undefined);
  assert.equal(data.emailVerificationStatus, "SUPPRESSED");
  // Suppression short-circuits before deliverability is even checked.
  assert.equal(verify.mock.callCount(), 0);
});

// ─── (iv) cross-opportunity contacted duplicate → DUPLICATE, no enrich ───────

test("cross-opportunity contacted duplicate is marked DUPLICATE and never enriched", async () => {
  const { prisma, updates } = makePrisma([baseProspect()], [contactedDuplicate]);
  const enrich = mock.fn(async () => enrichResult());

  const counts = await enrichProspectEmailsForOpportunity(
    "opp_1",
    deps({ prisma, enrich }),
  );

  assert.equal(counts.duplicate, 1);
  assert.equal(counts.verified, 0);
  assert.equal(enrich.mock.callCount(), 0); // never enriched
  const data = updates[0].data;
  assert.equal(data.emailVerificationStatus, "DUPLICATE");
  assert.equal(data.email, undefined);
  assert.ok(data.emailEnrichedAt instanceof Date);
});

// ─── (v) email:null but a contactName → contact block persisted, NONE ────────

test("no email but a found ISM persists the contact block with status NONE", async () => {
  const { prisma, updates } = makePrisma([baseProspect()]);
  const enrich = mock.fn(async () =>
    enrichResult({
      email: null,
      contactName: "Jane Rivera",
      contactTitle: "Internet Sales Manager",
      contactPhone: "555-200-1000",
      contactConfidence: "high",
      contactSource: "gemini_search_high_confidence",
      contactSourceUrl: "https://toyotaofdallas.com/staff",
    }),
  );

  const counts = await enrichProspectEmailsForOpportunity(
    "opp_1",
    deps({ prisma, enrich }),
  );

  assert.equal(counts.verified, 0);
  assert.equal(counts.processed, 1);
  const data = updates[0].data;
  assert.equal(data.email, undefined);
  assert.equal(data.emailVerificationStatus, "NONE");
  assert.equal(data.contactName, "Jane Rivera");
  assert.equal(data.contactTitle, "Internet Sales Manager");
  assert.equal(data.contactSource, "gemini_search_high_confidence");
});

// ─── (vi) one prospect throwing does not abort the batch ─────────────────────

test("a throwing prospect is isolated and never persists anything bad", async () => {
  const { prisma, updates } = makePrisma([
    baseProspect({ id: "p_bad", website: "https://bad-dealer.com" }),
    baseProspect({ id: "p_ok", name: "Honda of Plano", website: "https://hondaofplano.com" }),
  ]);
  const enrich = mock.fn(async (input: { dealerProspectId: string }) => {
    if (input.dealerProspectId === "p_bad") throw new Error("provider exploded");
    return enrichResult({ email: "sales@hondaofplano.com", source: "gemini_search_high_confidence" });
  });

  const counts = await enrichProspectEmailsForOpportunity(
    "opp_1",
    deps({ prisma, enrich }),
  );

  // The good prospect still processed; the bad one wrote nothing.
  assert.equal(counts.verified, 1);
  assert.equal(counts.processed, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, "p_ok");
});

// ─── within-opportunity self-dedup: same host, second is DUPLICATE ───────────

test("two same-host prospects in one pass: first VERIFIED, second DUPLICATE (not enriched)", async () => {
  const { prisma, updates } = makePrisma(
    [
      baseProspect({ id: "p1", website: "https://toyotaofdallas.com" }),
      baseProspect({ id: "p2", website: "https://www.toyotaofdallas.com/new-cars" }),
    ],
    [], // no cross-opportunity contacted duplicates
  );
  const enrich = mock.fn(async () =>
    enrichResult({ email: "sales@toyotaofdallas.com", source: "gemini_search_high_confidence" }),
  );

  const counts = await enrichProspectEmailsForOpportunity("opp_1", deps({ prisma, enrich }));

  assert.equal(counts.verified, 1);
  assert.equal(counts.duplicate, 1);
  assert.equal(enrich.mock.callCount(), 1, "second same-host prospect must not be enriched");
  assert.equal(updates.length, 2);
  assert.equal(updates[0].data.emailVerificationStatus, "VERIFIED");
  assert.equal(updates[1].data.emailVerificationStatus, "DUPLICATE");
  assert.equal(updates[1].data.email, undefined);
});

// ─── transient provider failure → errored, row left untouched for retry ──────

test("a transient enrichment failure is counted errored and persists NOTHING (retriable)", async () => {
  const { prisma, updates } = makePrisma([baseProspect()]);
  const enrich = mock.fn(async () => enrichResult({ errored: true }));

  const counts = await enrichProspectEmailsForOpportunity("opp_1", deps({ prisma, enrich }));

  assert.equal(counts.errored, 1);
  assert.equal(counts.processed, 0);
  assert.equal(counts.verified, 0);
  // Nothing persisted → emailEnrichedAt stays null → a later re-run retries.
  assert.equal(updates.length, 0);
});

// ─── recency-guard skip is not counted or persisted ──────────────────────────

test("enrich returning skipped (recency guard) is not counted or persisted", async () => {
  const { prisma, updates } = makePrisma([baseProspect()]);
  const enrich = mock.fn(async () => enrichResult({ skipped: true }));

  const counts = await enrichProspectEmailsForOpportunity(
    "opp_1",
    deps({ prisma, enrich }),
  );

  assert.equal(counts.processed, 0);
  assert.equal(updates.length, 0);
});
