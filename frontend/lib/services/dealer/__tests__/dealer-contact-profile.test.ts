// Block B / B1 — DealerContactProfile: person-level contact identity keyed to the
// A2 DealerRooftop (registered + prospect twin share one contact history).
// Injected, where-aware fake prisma — runs under test:dealer, NO module mocks
// (that suite runs tsx --test without --experimental-test-module-mocks).
//   npx tsx --test lib/services/dealer/__tests__/dealer-contact-profile.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { upsertContactProfile, reconcileProspectContact } from "../dealer-contact-profile.service";
import { normalizeDealerName, phoneKey } from "@/lib/services/dealer/dealer-identity.service";

interface Captured {
  created: Array<Record<string, unknown>>;
  updated: Array<{ where: { id: string }; data: Record<string, unknown> }>;
}

// Where-aware fake: findFirst matches a seeded row on ALL keys in the where
// clause (rooftopId + one identity key), so the email→name→phone lookup chain is
// exercised for real.
function fakePrisma(
  profiles: Array<Record<string, unknown>> = [],
  prospect: Record<string, unknown> | null = null,
): { prisma: PrismaClient; cap: Captured } {
  const cap: Captured = { created: [], updated: [] };
  const store = [...profiles];
  const matches = (p: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => p[k] === v);
  const prisma = {
    dealerContactProfile: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        store.find((p) => matches(p, where)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        cap.created.push(data);
        const row = { id: `dcp_${store.length + 1}`, ...data };
        store.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        cap.updated.push({ where, data });
        const row = store.find((p) => p.id === where.id);
        if (row) Object.assign(row, data);
        return { id: where.id, ...(row ?? {}) };
      },
    },
    dealerProspect: { findUnique: async () => prospect },
  } as unknown as PrismaClient;
  return { prisma, cap };
}

// ─── upsertContactProfile: create + normalization ────────────────────────────

test("creates a new profile with normalized name/email/phone keys, keyed to the rooftop", async () => {
  const { prisma, cap } = fakePrisma([]);
  const r = await upsertContactProfile(
    "rt1",
    {
      name: "John Smith",
      title: "Internet Sales Manager",
      email: "John.Smith@Dealer.com",
      phone: "(555) 123-4567",
      emailVerificationStatus: "VERIFIED",
      emailSource: "gemini_search_high_confidence",
    },
    { prisma },
  );
  assert.equal(cap.created.length, 1);
  assert.equal(cap.updated.length, 0);
  const d = cap.created[0]!;
  assert.equal(d.rooftopId, "rt1");
  assert.equal(d.emailKey, "john.smith@dealer.com");
  assert.equal(d.email, "John.Smith@Dealer.com"); // original preserved for display
  assert.ok((d.phoneKey as string)?.includes("5551234567"));
  assert.ok(d.nameKey);
  assert.equal(r?.id, "dcp_1");
});

test("is idempotent — a second upsert for the same rooftop+email updates, never duplicates", async () => {
  const { prisma, cap } = fakePrisma([
    { id: "dcp1", rooftopId: "rt1", email: "sales@dealer.com", emailKey: "sales@dealer.com", emailVerificationStatus: "VERIFIED" },
  ]);
  await upsertContactProfile("rt1", { email: "sales@dealer.com", title: "Sales", emailVerificationStatus: "VERIFIED" }, { prisma });
  assert.equal(cap.created.length, 0, "no duplicate profile");
  assert.equal(cap.updated.length, 1);
});

// ─── never-downgrade + empty-data guard ──────────────────────────────────────

test("a pure downgrade attempt writes NOTHING (never-downgrade + empty-data guard)", async () => {
  const { prisma, cap } = fakePrisma([
    { id: "dcp1", rooftopId: "rt1", email: "a@dealer.com", emailKey: "a@dealer.com", emailVerificationStatus: "VERIFIED", emailSource: "gemini_search_high_confidence" },
  ]);
  await upsertContactProfile("rt1", { email: "a@dealer.com", emailVerificationStatus: "UNVERIFIED" }, { prisma });
  assert.equal(cap.created.length, 0);
  assert.equal(cap.updated.length, 0, "no spurious write on a downgrade-only upsert");
});

test("fills a null field without clobbering an existing non-null identity field", async () => {
  const { prisma, cap } = fakePrisma([
    { id: "dcp1", rooftopId: "rt1", name: "Jane Doe", nameKey: "jane doe", title: null, email: "jane@dealer.com", emailKey: "jane@dealer.com", emailVerificationStatus: "VERIFIED" },
  ]);
  await upsertContactProfile("rt1", { email: "jane@dealer.com", name: "SOMEONE ELSE", title: "GM" }, { prisma });
  assert.equal(cap.updated.length, 1);
  const data = cap.updated[0]!.data;
  assert.equal(data.title, "GM"); // filled (was null)
  assert.notEqual(data.name, "SOMEONE ELSE"); // existing non-null name not clobbered
});

// ─── MEDIUM-1 fix: two-phase discovery upgrades one record (no duplicate) ─────

test("name-only record later gaining a verified email is UPGRADED, not duplicated", async () => {
  const nk = normalizeDealerName("John Q");
  const { prisma, cap } = fakePrisma([
    { id: "dcpN", rooftopId: "rt5", name: "John Q", nameKey: nk, email: null, emailKey: null, emailVerificationStatus: null },
  ]);
  await upsertContactProfile("rt5", { name: "John Q", email: "jq@dealer.com", emailVerificationStatus: "VERIFIED" }, { prisma });
  assert.equal(cap.created.length, 0, "email lookup missed, but name fallback found the record — no duplicate");
  assert.equal(cap.updated.length, 1);
  assert.equal(cap.updated[0]!.data.emailKey, "jq@dealer.com");
  assert.equal(cap.updated[0]!.data.emailVerificationStatus, "VERIFIED");
});

// ─── MEDIUM-2 fix: phone-only contact dedups on phoneKey (bounded) ───────────

test("a phone-only contact dedups on phoneKey (repeat upsert does not duplicate)", async () => {
  const pk = phoneKey("555-111-2222");
  const { prisma, cap } = fakePrisma([
    { id: "dcpP", rooftopId: "rt6", name: null, nameKey: null, email: null, emailKey: null, phone: null, phoneKey: pk },
  ]);
  await upsertContactProfile("rt6", { phone: "555-111-2222" }, { prisma });
  assert.equal(cap.created.length, 0, "matched the existing phone-keyed row");
  assert.equal(cap.updated.length, 1);
});

test("skips (returns null) when no identity key (email/name/phone) is derivable", async () => {
  const { prisma, cap } = fakePrisma([]);
  const r = await upsertContactProfile("rt7", { title: "GM" }, { prisma });
  assert.equal(r, null);
  assert.equal(cap.created.length, 0);
  assert.equal(cap.updated.length, 0);
});

// ─── reconcileProspectContact ────────────────────────────────────────────────

test("reconciles a prospect's contact fields into a rooftop-keyed profile", async () => {
  const { prisma, cap } = fakePrisma([], {
    id: "p1", rooftopId: "rt9",
    contactName: "Pat Lee", contactTitle: "BDC Manager", contactPhone: "555-987-6543",
    email: "pat@store.com", emailVerificationStatus: "ROLE_DERIVED", emailSource: "role_derived",
    contactSource: "gemini_search_medium_confidence", contactConfidence: "medium",
  });
  const r = await reconcileProspectContact("p1", { prisma });
  assert.equal(cap.created.length, 1);
  assert.equal(cap.created[0]!.rooftopId, "rt9");
  assert.equal(cap.created[0]!.name, "Pat Lee");
  assert.ok(r);
});

test("skips reconciliation when the prospect has no rooftop (never orphans a profile)", async () => {
  const { prisma, cap } = fakePrisma([], { id: "p2", rooftopId: null, contactName: "No Rooftop", email: "x@y.com" });
  const r = await reconcileProspectContact("p2", { prisma });
  assert.equal(cap.created.length, 0);
  assert.equal(cap.updated.length, 0);
  assert.equal(r, null);
});
