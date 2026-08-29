// R10/O7 — affiliate registration must place a recruited affiliate at the
// parent's depth + 1 (capped at 3), never a hardcoded 2, so the L1→L2→L3
// commission tree the portal advertises can actually form.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks "app/api/affiliate/__tests__/register-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

// Some transitive imports construct a Supabase client at module scope; give
// them harmless values (the admin client itself is module-mocked below).
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";

interface Ctrl {
  parent: { id: string; level: number; referralCode: string; status: string } | null;
  usersByEmail: Record<string, unknown>;
  createdAffiliates: Array<Record<string, unknown>>;
  supabaseCreateFails: boolean;
}
let ctrl: Ctrl;

const txClient = {
  user: {
    create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "user_new", ...data }),
  },
  affiliate: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `aff_new_${ctrl.createdAffiliates.length + 1}`, ...data };
      ctrl.createdAffiliates.push(row);
      return row;
    },
  },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      user: {
        findUnique: async ({ where }: { where: { email: string } }) => ctrl.usersByEmail[where.email] ?? null,
        findFirst: async ({ where }: { where: { email?: string } }) =>
          (where.email && ctrl.usersByEmail[where.email]) || null,
      },
      affiliate: {
        findUnique: async () => null, // referral-code uniqueness check — always free
        findFirst: async ({ where }: { where: { referralCode?: string } }) =>
          ctrl.parent && ctrl.parent.referralCode === where.referralCode ? ctrl.parent : null,
      },
      $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient),
    },
  },
});

const mockCreateClient = () => ({
  auth: {
    admin: {
      createUser: async () =>
        ctrl.supabaseCreateFails
          ? { data: null, error: { message: "boom", code: "unexpected" } }
          : { data: { user: { id: "sb_user_1" } }, error: null },
      generateLink: async () => ({
        data: { properties: { action_link: "https://sb/link" } },
        error: null,
      }),
      deleteUser: async () => ({ error: null }),
    },
  },
});
// The route reaches Supabase admin through the shared service-role adapter
// (lib/supabase-service) — the mockable seam; the raw package cannot be
// intercepted by node:test module mocks under tsx.
mock.module("@/lib/supabase-service", {
  namedExports: { getServiceSupabase: mockCreateClient },
});

mock.module("@/lib/auth/api", {
  namedExports: {
    successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } },
});
mock.module("@/lib/services/email/resend.service", {
  namedExports: { sendAffiliateVerificationEmail: async () => {} },
});
mock.module("@/lib/services/contact.service", {
  namedExports: { ContactService: { upsertFromAffiliate: async () => {} } },
});
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });
let rateLimited = false;
mock.module("@/lib/security/rate-limit", {
  namedExports: {
    limitAuthAttempt: async () =>
      rateLimited ? { ok: false, status: 429, message: "Too many attempts." } : { ok: true },
    clientIpKey: () => "1.2.3.4",
  },
});

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/affiliate/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  firstName: "Cass",
  lastName: "A",
  email: "new@x.com",
  password: "Str0ngPassword12",
  promotionMethod: "YouTube channel",
  ftcDisclosure: true,
  termsAgreed: true,
};

beforeEach(() => {
  ctrl = { parent: null, usersByEmail: {}, createdAffiliates: [], supabaseCreateFails: false };
  rateLimited = false;
});

test("R4: rate-limited request → 429, nothing created", async () => {
  const { POST } = await import("@/app/api/affiliate/register/route");
  rateLimited = true;
  const res = await POST(req(BASE_BODY));
  assert.equal(res.status, 429);
  assert.equal(ctrl.createdAffiliates.length, 0);
});

test("no referral code → level 1, no parent", async () => {
  const { POST } = await import("@/app/api/affiliate/register/route");
  const res = await POST(req(BASE_BODY));
  assert.equal(res.status, 201);
  assert.equal(ctrl.createdAffiliates.length, 1);
  assert.equal(ctrl.createdAffiliates[0].level, 1);
  assert.equal(ctrl.createdAffiliates[0].parentId, undefined);
});

test("recruited under a level-1 parent → level 2", async () => {
  const { POST } = await import("@/app/api/affiliate/register/route");
  ctrl.parent = { id: "aff_p1", level: 1, referralCode: "ALPARENT", status: "ACTIVE" };
  const res = await POST(req({ ...BASE_BODY, referralCode: "ALPARENT" }));
  assert.equal(res.status, 201);
  assert.equal(ctrl.createdAffiliates[0].parentId, "aff_p1");
  assert.equal(ctrl.createdAffiliates[0].level, 2);
});

test("recruited under a level-2 parent → level 3 (was hardcoded 2)", async () => {
  const { POST } = await import("@/app/api/affiliate/register/route");
  ctrl.parent = { id: "aff_p2", level: 2, referralCode: "ALPARENT", status: "ACTIVE" };
  const res = await POST(req({ ...BASE_BODY, referralCode: "ALPARENT" }));
  assert.equal(res.status, 201);
  assert.equal(ctrl.createdAffiliates[0].level, 3);
});

test("recruited under a level-3 parent → capped at level 3", async () => {
  const { POST } = await import("@/app/api/affiliate/register/route");
  ctrl.parent = { id: "aff_p3", level: 3, referralCode: "ALPARENT", status: "ACTIVE" };
  const res = await POST(req({ ...BASE_BODY, referralCode: "ALPARENT" }));
  assert.equal(res.status, 201);
  assert.equal(ctrl.createdAffiliates[0].level, 3);
});
