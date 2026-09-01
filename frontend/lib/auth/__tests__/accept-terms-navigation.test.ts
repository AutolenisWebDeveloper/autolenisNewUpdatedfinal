// P0 regression: /auth/accept-terms — the second screen every new buyer sees.
//
// Reported live: a brand-new buyer clicked "I Accept — Continue" and nothing
// visible happened, while a terms-acceptance stamp WAS written in that window.
//
// These tests pin the server half of that interaction, which is what a
// regression would silently break:
//
//   * a successful acceptance PERSISTS the stamp AND ADVANCES the buyer (the
//     action must throw NEXT_REDIRECT to the next step, never return normally —
//     a swallowed redirect is exactly the "button does nothing" symptom);
//   * clicking twice is IDEMPOTENT — the stamp is a column update on the single
//     Buyer row, so no second acceptance row and no second Buyer is ever
//     created, and the second click still advances;
//   * the destination is the safe requested redirect, or /buyer/dashboard;
//   * a buyer whose auth-callback provisioning left a User with NO Buyer row is
//     HEALED and advances — it used to be stranded, because ensurePrismaUser
//     returns an existing User untouched and never noticed the missing Buyer,
//     so the heal both call sites depend on was a no-op for the one case it
//     exists to fix;
//   * a failed metadata sync returns to the page with an actionable error
//     rather than dropping the buyer into a silent dead end.
//
// Run: pnpm test:auth   (globs lib/auth/__tests__/*.test.ts)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

class RedirectError extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
    this.name = "RedirectError";
  }
}

interface FakeBuyer {
  id: string;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
}
interface FakeUser {
  id: string;
  email: string;
  supabaseId: string;
  role: string;
  buyer: FakeBuyer | null;
}

interface Ctrl {
  authUser: Record<string, unknown> | null;
  users: FakeUser[];
  metadataError: { message: string } | null;
  metadataUpdates: Array<Record<string, unknown>>;
  buyersCreated: number;
  usersCreated: number;
  updateManyCalls: number;
}
let ctrl: Ctrl;

const SUPABASE_ID = "sb-buyer-1";

/** Simulate the half-provisioned account: a User row with no Buyer row. */
function dropBuyerRow(user: FakeUser): void {
  user.buyer = null;
}

function freshCtrl(overrides: Partial<Ctrl> = {}): Ctrl {
  return {
    authUser: {
      id: SUPABASE_ID,
      email: "newbuyer@example.com",
      user_metadata: { role: "BUYER", firstName: "New", lastName: "Buyer" },
    },
    users: [
      {
        id: "user-1",
        email: "newbuyer@example.com",
        supabaseId: SUPABASE_ID,
        role: "BUYER",
        buyer: { id: "buyer-1", termsAcceptedAt: null, termsVersion: null },
      },
    ],
    metadataError: null,
    metadataUpdates: [],
    buyersCreated: 0,
    usersCreated: 0,
    updateManyCalls: 0,
    ...overrides,
  };
}

mock.module("next/navigation", {
  namedExports: {
    redirect: (to: string) => {
      throw new RedirectError(to);
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } },
});

mock.module("next/headers", {
  namedExports: {
    headers: async () => new Headers(),
    cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  },
});

mock.module("@/lib/security/rate-limit", {
  namedExports: { limitAuthAttempt: async () => ({ ok: true }) },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: { sendWelcomeEmail: async () => {}, sendEmailVerifiedEmail: async () => {} },
});

mock.module("@/lib/services/crm/lifecycle-scheduler", {
  namedExports: { scheduleLifecycleWorkload: async () => {} },
});

mock.module("@/lib/supabase", {
  namedExports: {
    createServerSupabaseClient: async () => ({
      auth: { getUser: async () => ({ data: { user: ctrl.authUser } }) },
    }),
    createServiceSupabaseClient: () => ({
      auth: {
        admin: {
          updateUserById: async (_id: string, attrs: { user_metadata?: Record<string, unknown> }) => {
            ctrl.metadataUpdates.push(attrs.user_metadata ?? {});
            return { data: { user: null }, error: ctrl.metadataError };
          },
        },
      },
    }),
  },
});

function findBySupabaseId(id: string) {
  return ctrl.users.find((u) => u.supabaseId === id) ?? null;
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: {
        updateMany: async ({
          where,
          data,
        }: {
          where: { user?: { supabaseId?: string } };
          data: { termsAcceptedAt: Date; termsVersion: string };
        }) => {
          ctrl.updateManyCalls += 1;
          const u = findBySupabaseId(where.user?.supabaseId ?? "");
          if (!u || !u.buyer) return { count: 0 };
          u.buyer.termsAcceptedAt = data.termsAcceptedAt;
          u.buyer.termsVersion = data.termsVersion;
          return { count: 1 };
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.buyersCreated += 1;
          const u = ctrl.users.find((x) => x.id === data.userId);
          const buyer: FakeBuyer = {
            id: `buyer-created-${ctrl.buyersCreated}`,
            termsAcceptedAt: (data.termsAcceptedAt as Date | null) ?? null,
            termsVersion: (data.termsVersion as string | null) ?? null,
          };
          if (u) u.buyer = buyer;
          return buyer;
        },
        upsert: async ({
          where,
          create,
        }: {
          where: { userId: string };
          create: Record<string, unknown>;
        }) => {
          const u = ctrl.users.find((x) => x.id === where.userId);
          if (u?.buyer) return u.buyer; // `update: {}` — an existing Buyer is untouched
          ctrl.buyersCreated += 1;
          const buyer: FakeBuyer = {
            id: `buyer-upserted-${ctrl.buyersCreated}`,
            termsAcceptedAt: (create.termsAcceptedAt as Date | null) ?? null,
            termsVersion: (create.termsVersion as string | null) ?? null,
          };
          if (u) u.buyer = buyer;
          return buyer;
        },
        findFirst: async () => null,
        findUnique: async () => null,
        update: async () => ({}),
      },
      user: {
        findUnique: async ({ where }: { where: { supabaseId?: string; email?: string } }) => {
          if (where.supabaseId) {
            const u = findBySupabaseId(where.supabaseId);
            // Mirror Prisma's `include: { buyer: ... }`: null when there is no row.
            return u ? { ...u, buyer: u.buyer ? { id: u.buyer.id } : null } : null;
          }
          const u = ctrl.users.find((x) => x.email === where.email);
          return u ? { ...u } : null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.usersCreated += 1;
          const nested = data.buyer as { create?: Record<string, unknown> } | undefined;
          const created: FakeUser = {
            id: `user-created-${ctrl.usersCreated}`,
            email: data.email as string,
            supabaseId: data.supabaseId as string,
            role: data.role as string,
            buyer: nested?.create
              ? {
                  id: `buyer-nested-${ctrl.usersCreated}`,
                  termsAcceptedAt: (nested.create.termsAcceptedAt as Date | null) ?? null,
                  termsVersion: (nested.create.termsVersion as string | null) ?? null,
                }
              : null,
          };
          ctrl.users.push(created);
          if (created.buyer) ctrl.buyersCreated += 1;
          return { ...created };
        },
        update: async () => ({ id: "user-1" }),
      },
      affiliate: { findFirst: async () => null, create: async () => ({}) },
      affiliateReferral: { upsert: async () => ({}) },
      vehicleRequest: { updateMany: async () => ({}) },
      adminAuditLog: { findFirst: async () => null, create: async () => ({}) },
    },
  },
});

async function accept(redirectParam?: string): Promise<RedirectError> {
  const { acceptTermsAction } = await import("../actions");
  const fd = new FormData();
  if (redirectParam) fd.set("redirect", redirectParam);
  try {
    await acceptTermsAction(fd);
  } catch (err) {
    if (err instanceof RedirectError) return err;
    throw err;
  }
  assert.fail(
    "acceptTermsAction returned without redirecting — a swallowed redirect IS the dead button",
  );
}

beforeEach(() => {
  ctrl = freshCtrl();
});

test("a successful acceptance persists the stamp AND advances the buyer", async () => {
  const redirected = await accept();

  const buyer = ctrl.users[0].buyer!;
  assert.ok(buyer.termsAcceptedAt instanceof Date, "the acceptance must be persisted");
  assert.equal(buyer.termsVersion, "1.0.0", "the stamped version must be the one in force");
  assert.equal(
    redirected.to,
    "/buyer/dashboard",
    "the buyer must be advanced to the next step, not left on the terms page",
  );
  assert.equal(ctrl.metadataUpdates.length, 1, "the edge gate's copy must be synced too");
  assert.ok(
    ctrl.metadataUpdates[0].termsAcceptedAt,
    "user_metadata.termsAcceptedAt is what the edge gate reads — without it the buyer bounces back",
  );
});

test("both terms gates agree after acceptance, so the destination cannot bounce back", async () => {
  await accept();
  const { needsTermsAcceptance } = await import("../terms");

  const buyer = ctrl.users[0].buyer!;
  const meta = ctrl.metadataUpdates[0] as { termsAcceptedAt: string; termsVersion: string };

  assert.equal(
    needsTermsAcceptance(buyer.termsAcceptedAt, buyer.termsVersion),
    false,
    "the server backstop (app/buyer/layout.tsx) must let the buyer through",
  );
  assert.equal(
    needsTermsAcceptance(meta.termsAcceptedAt, meta.termsVersion),
    false,
    "the edge gate (proxy.ts) must let the buyer through",
  );
});

test("a safe requested redirect is honoured; an unsafe one falls back to the dashboard", async () => {
  assert.equal((await accept("/buyer/prequalification")).to, "/buyer/prequalification");

  ctrl = freshCtrl();
  assert.equal(
    (await accept("https://evil.example/steal")).to,
    "/buyer/dashboard",
    "an off-site redirect must never be followed",
  );

  ctrl = freshCtrl();
  assert.equal(
    (await accept("/admin/dashboard")).to,
    "/buyer/dashboard",
    "a buyer must not be redirected outside the buyer portal",
  );
});

test("clicking twice is idempotent — no duplicate acceptance row, no second buyer", async () => {
  const first = await accept();
  const stampedAt = ctrl.users[0].buyer!.termsAcceptedAt;

  const second = await accept();

  assert.equal(first.to, "/buyer/dashboard");
  assert.equal(second.to, "/buyer/dashboard", "the second click must still advance the buyer");
  assert.equal(ctrl.users.length, 1, "no second User row");
  assert.equal(ctrl.buyersCreated, 0, "no second Buyer row is provisioned on a re-click");
  assert.equal(ctrl.updateManyCalls, 2, "each click writes the stamp once, to the same row");
  assert.ok(ctrl.users[0].buyer!.termsAcceptedAt instanceof Date);
  assert.ok(
    stampedAt instanceof Date,
    "acceptance is a column update on the one Buyer row, so a re-click cannot duplicate it",
  );
  assert.equal(ctrl.metadataUpdates.length, 2, "each click re-syncs the same values (idempotent)");
});

test("a User with no Buyer row is healed and still advances", async () => {
  // The exact state the heal path exists for: auth-callback provisioning created
  // the User but not the Buyer. ensurePrismaUser returned the existing User
  // untouched and never created the missing Buyer, so the retried updateMany
  // still matched 0 rows and the buyer was stranded on this page forever.
  ctrl = freshCtrl();
  // Cleared through a helper so TypeScript does not narrow `buyer` to `null` for
  // the assertions below — the whole point is that the action repopulates it.
  dropBuyerRow(ctrl.users[0]);

  const redirected = await accept();

  const healed = ctrl.users[0].buyer;
  assert.ok(healed, "the missing Buyer row must be provisioned");
  assert.ok(
    healed.termsAcceptedAt instanceof Date,
    "the healed buyer's acceptance must be persisted",
  );
  assert.equal(redirected.to, "/buyer/dashboard", "a healed buyer must advance, not loop");
  assert.equal(ctrl.users.length, 1, "healing must not create a duplicate User");
});

test("a failed metadata sync returns an actionable error instead of a silent dead end", async () => {
  ctrl.metadataError = { message: "boom" };

  const redirected = await accept();

  assert.equal(
    redirected.to,
    "/auth/accept-terms?error=SYNC_FAILED",
    "the buyer must be told why, not bounced invisibly",
  );
});

test("an unauthenticated submit is sent to sign-in, never silently ignored", async () => {
  ctrl.authUser = null;
  assert.equal((await accept()).to, "/auth/signin");
});
