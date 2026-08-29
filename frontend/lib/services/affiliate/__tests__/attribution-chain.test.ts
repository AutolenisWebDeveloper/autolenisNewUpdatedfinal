// T2.6 (owner-required) — the COMPLETE attribution chain in ONE execution:
//
//   ?ref= visit → proxy sets the affiliate_ref cookie
//     → buyer signup with an EMPTY form field (server-side cookie fallback)
//       → referralCode lands in the Supabase signup metadata
//     → provisioning (ensurePrismaUser, as /auth/callback drives it)
//       → AffiliateReferral row + Buyer.affiliateId + click conversion
//     → fee payment conversion (processFeeCommission)
//       → Commission row for the right affiliate with the right basis.
//
// Production evidence at audit time: 5 affiliate_clicks, 0 affiliate_referrals,
// 0 commissions — the chain had never executed past click tracking, and five
// isolated unit tests would all pass with the chain still dead. This test
// crosses every link in one run: any silently-dropped hand-off (cookie name
// drift, a provisioning path that skips attribution, a converter that can't
// find the referral) fails HERE.
//
// Only infrastructure seams are mocked (Prisma → in-memory store, Supabase
// clients, email, events, rate limits). Every AutoLenis function in the chain
// is the real implementation.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/affiliate/__tests__/attribution-chain.test.ts

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

// ── In-memory store ──────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const db = {
  users: [] as Row[],
  buyers: [] as Row[],
  affiliates: [
    {
      id: "aff_1",
      userId: "user_aff_1",
      referralCode: "ALCHAIN1",
      status: "ACTIVE",
      level: 1,
      parentId: null,
      parent: null,
    },
  ] as Row[],
  referrals: [] as Row[],
  clicks: [
    { id: "click_1", affiliateId: "aff_1", referralCode: "ALCHAIN1", convertedAt: null, referredUserId: null },
  ] as Row[],
  commissions: [] as Row[],
};

const prismaMock = {
  user: {
    findUnique: async ({ where }: { where: Row }) =>
      db.users.find((u) => (where.supabaseId ? u.supabaseId === where.supabaseId : u.email === where.email)) ?? null,
    findFirst: async ({ where }: { where: Row }) => db.users.find((u) => u.email === where.email) ?? null,
    create: async ({ data }: { data: Row & { buyer?: { create: Row } } }) => {
      const user: Row = { id: `user_${db.users.length + 1}`, supabaseId: data.supabaseId, email: data.email, role: data.role };
      db.users.push(user);
      let buyer: Row | null = null;
      if (data.buyer?.create) {
        buyer = { id: `buyer_${db.buyers.length + 1}`, userId: user.id, affiliateId: null, ...data.buyer.create };
        db.buyers.push(buyer);
      }
      return { ...user, buyer: buyer ? { id: buyer.id } : null };
    },
  },
  buyer: {
    findUnique: async ({ where }: { where: Row }) =>
      db.buyers.find((b) => (where.userId ? b.userId === where.userId : b.id === where.id)) ?? null,
    findFirst: async () => null, // no guest rows in this scenario
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hits = db.buyers.filter(
        (b) => b.userId === where.userId && (!("affiliateId" in where) || b.affiliateId === where.affiliateId),
      );
      hits.forEach((b) => Object.assign(b, data));
      return { count: hits.length };
    },
  },
  affiliate: {
    findUnique: async ({ where }: { where: Row }) => {
      const row = db.affiliates.find((a) =>
        where.referralCode ? a.referralCode === where.referralCode : a.id === where.id,
      );
      if (!row) return null;
      // include shapes used by the chain (parent tree, earner email) are
      // satisfied by returning a superset
      return { ...row, user: { email: "affiliate@x.com" }, profile: null };
    },
    findFirst: async ({ where }: { where: Row }) => db.affiliates.find((a) => a.userId === where.userId) ?? null,
  },
  affiliateReferral: {
    upsert: async ({ where, create }: { where: { affiliateId_referredUserId: Row }; create: Row }) => {
      const key = where.affiliateId_referredUserId;
      let row = db.referrals.find(
        (r) => r.affiliateId === key.affiliateId && r.referredUserId === key.referredUserId,
      );
      if (!row) {
        row = { id: `ref_${db.referrals.length + 1}`, signedUpAt: new Date(), firstDealAt: null, totalDeals: 0, ...create };
        db.referrals.push(row);
      }
      return row;
    },
    findFirst: async ({ where }: { where: Row }) =>
      db.referrals.find((r) => r.referredUserId === where.referredUserId) ?? null,
    count: async ({ where }: { where: Row }) =>
      db.referrals.filter((r) => r.affiliateId === where.affiliateId).length,
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = db.referrals.find((r) => r.id === where.id)!;
      const inc = (data.totalDeals as { increment?: number } | undefined)?.increment ?? 0;
      Object.assign(row, { ...data, totalDeals: (row.totalDeals as number) + inc });
      return row;
    },
  },
  affiliateClick: {
    findFirst: async ({ where }: { where: Row }) =>
      db.clicks.find(
        (c) =>
          (where.affiliateId ? c.affiliateId === where.affiliateId : c.referralCode === where.referralCode) &&
          c.convertedAt === null,
      ) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = db.clicks.find((c) => c.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hits = db.clicks.filter((c) => c.referralCode === where.referralCode && c.convertedAt === null);
      hits.forEach((c) => Object.assign(c, data));
      return { count: hits.length };
    },
  },
  referralMilestoneConfig: { findMany: async () => [] },
  referralMilestone: { findMany: async () => [], create: async (a: { data: Row }) => a.data },
  commission: {
    findUnique: async ({ where }: { where: { qualifyingEventId: string } }) =>
      db.commissions.find((c) => c.qualifyingEventId === where.qualifyingEventId) ?? null,
    findFirst: async ({ where }: { where: Row }) => {
      const prefix = (where.qualifyingEventId as { startsWith?: string } | undefined)?.startsWith;
      return db.commissions.find((c) => !prefix || (c.qualifyingEventId as string).startsWith(prefix)) ?? null;
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: `com_${db.commissions.length + 1}`, ...data };
      db.commissions.push(row);
      return row;
    },
  },
  vehicleRequest: { updateMany: async () => ({ count: 0 }) },
  notification: { create: async (a: { data: Row }) => a.data },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

// ── Infrastructure seams ─────────────────────────────────────────────────────
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } },
});
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });
mock.module("@/lib/security/rate-limit", {
  namedExports: {
    limitAuthAttempt: async () => ({ ok: true }),
    limitPaymentIntent: async () => ({ ok: true }),
    clientIpKey: () => "1.2.3.4",
  },
});
mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendWelcomeEmail: async () => {},
    sendPasswordResetEmail: async () => {},
    sendAffiliateVerificationEmail: async () => {},
  },
});
mock.module("@/lib/services/crm/lifecycle-scheduler", {
  namedExports: { scheduleLifecycleWorkload: async () => {} },
});
mock.module("@/lib/auth/terms", {
  namedExports: {
    needsTermsAcceptance: () => false,
    getCurrentTermsVersion: () => "2026-01",
  },
});

// The signup metadata that would travel to Supabase — captured at the
// generateLink seam, exactly what /auth/callback later reads.
let capturedSignupMetadata: Record<string, unknown> | null = null;
mock.module("@/lib/supabase", {
  namedExports: {
    createServerSupabaseClient: async () => ({
      auth: { getUser: async () => ({ data: { user: null } }), signOut: async () => {} },
    }),
    createServiceSupabaseClient: () => ({
      auth: {
        admin: {
          generateLink: async (args: { options?: { data?: Record<string, unknown> } }) => {
            capturedSignupMetadata = args.options?.data ?? null;
            return {
              data: { properties: { action_link: "http://link" }, user: { id: "sb_buyer_1" } },
              error: null,
            };
          },
        },
      },
    }),
  },
});

// next/headers — the mutable request store signUpAction's cookie fallback and
// header reads use. The affiliate_ref value is fed in from the proxy step.
let chainCookieValue: string | undefined;
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) => (name === "affiliate_ref" && chainCookieValue ? { value: chainCookieValue } : undefined),
      set: () => {},
      delete: () => {},
      getAll: () => [],
    }),
    headers: async () => new Headers(),
  },
});

// The proxy's Supabase session refresh goes to the network — stub fetch so an
// unauthenticated visitor resolves cleanly instead of "fetch failed".
const realFetch = global.fetch;
global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("supabase.test")) {
    return new Response(JSON.stringify({ msg: "no session" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

// ── THE chain ────────────────────────────────────────────────────────────────
test("?ref= → cookie → signup fallback → referral row → conversion → commission (one execution)", async () => {
  // LINK 1 — the ?ref= visit. The real proxy must persist the code as the
  // affiliate_ref cookie on a public page.
  const { proxy } = await import("@/proxy");
  const visit = new NextRequest("http://localhost:3000/?ref=ALCHAIN1");
  const proxyResponse = await proxy(visit);
  const refCookie = proxyResponse.cookies.get("affiliate_ref");
  assert.ok(refCookie, "proxy must set the affiliate_ref cookie on a ?ref= visit");
  assert.equal(refCookie!.value, "ALCHAIN1");
  chainCookieValue = refCookie!.value; // carried by the browser to signup

  // LINK 2 — buyer signup with an EMPTY referral form field: the server-side
  // cookie fallback must put the code into the Supabase signup metadata.
  const { signUpAction, ensurePrismaUser } = await import("@/lib/auth/actions");
  const formData = new FormData();
  formData.set("email", "referred-buyer@x.com");
  formData.set("password", "Str0ngPassword12");
  formData.set("firstName", "Rae");
  formData.set("lastName", "B");
  formData.set("agreeTerms", "true");
  formData.set("agreePrivacy", "true");
  // NOTE: no referralCode field — the cookie is the only carrier.
  const signup = await signUpAction(formData);
  assert.equal(signup.error, undefined, `signup failed: ${signup.error}`);
  assert.ok(capturedSignupMetadata, "signup must reach the Supabase generateLink seam");
  assert.equal(
    capturedSignupMetadata!.referralCode,
    "ALCHAIN1",
    "the cookie code must survive into signup metadata with no form field",
  );

  // LINK 3 — provisioning, as /auth/callback drives it after verification:
  // the referral row, the click conversion, and Buyer.affiliateId must appear.
  const user = await ensurePrismaUser(
    "sb_buyer_1",
    "referred-buyer@x.com",
    "BUYER" as never,
    undefined,
    "Rae",
    "B",
    undefined,
    undefined,
    capturedSignupMetadata!.referralCode as string,
  );
  const referral = db.referrals.find((r) => r.referredUserId === user.id);
  assert.ok(referral, "provisioning must create the AffiliateReferral row");
  assert.equal(referral!.affiliateId, "aff_1");
  const buyer = db.buyers.find((b) => b.userId === user.id);
  assert.ok(buyer, "buyer row provisioned");
  assert.equal(buyer!.affiliateId, "aff_1", "Buyer.affiliateId mirrors the attribution");
  assert.ok(db.clicks[0].convertedAt, "the pending click is marked converted");

  // LINK 4 — the fee payment converts: the real commission walk pays the
  // referring affiliate on the actual captured basis.
  const { processFeeCommission } = await import("@/lib/services/affiliate/commission.service");
  await processFeeCommission({
    dealId: "deal_chain_1",
    buyerId: buyer!.id as string,
    qualifyingEventId: "pi_chain_1",
    feeBasisCents: 40000,
  });
  assert.equal(db.commissions.length, 1, "exactly one L1 commission for a parentless affiliate");
  const commission = db.commissions[0];
  assert.equal(commission.affiliateId, "aff_1", "the commission pays the referring affiliate");
  assert.equal(commission.qualifyingEventId, "pi_chain_1-L1");
  assert.equal(commission.basisCents, 40000);
  assert.equal(commission.amountCents, 6000, "15% of the $400 captured fee");
  assert.equal(commission.status, "PENDING");

  // Conversion stamps (D12) written in the same pass.
  assert.equal(referral!.totalDeals, 1);
  assert.ok(referral!.firstDealAt, "firstDealAt stamped on first conversion");
});
