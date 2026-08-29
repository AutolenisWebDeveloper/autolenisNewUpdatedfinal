// POST /api/admin/dealers/invitations/[invId]/resend — ROUTE-LEVEL behaviour.
//
// WHY THIS SUITE EXISTS
// ---------------------
// The invitation token scheme is covered at the service level
// (lib/services/dealer-recruitment/__tests__/invitation-token.test.ts) and the
// write guards by __tests__/invitation-guards.test.ts. Nothing covered the ROUTE: there are no
// tests anywhere under app/api/admin/dealers. So the parts that only exist in
// the handler were unpinned — the admin authorization check, the status
// pre-checks, the 409 when the guarded rotation loses a race, the shape of the
// emailed link, and the fact that a failed email must not fail the request.
//
// It also pins the defect class that has now taken out two production paths in
// one day: an UNPROJECTED Prisma read. Prisma emits an explicit column list on
// every query, so a `findUnique` without a `select` asks for every model
// scalar — including columns a not-yet-applied migration has not created — and
// fails with 42703/P2022. That is what killed the invite path (fixed by #352)
// and, on the e-sign side, what the executed-artifact gate exists to prevent.
// The read in this route must stay projected — the migration that made those
// columns real removes the crash, not the habit.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/dealers/__tests__/invitation-resend-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { NextRequest } from "next/server";

const INV_ID = "11111111-1111-4111-8111-111111111111";
const OLD_PLAINTEXT = "old-plaintext-token-still-sitting-in-an-inbox";

interface UpdateManyCall {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

interface Ctrl {
  admin: { adminId: string; email: string } | null;
  invitation: Record<string, unknown> | null;
  /** What the guarded updateMany reports — 0 models "status changed under us". */
  updateCount: number;
  findUniqueArgs: Array<Record<string, unknown>>;
  updates: UpdateManyCall[];
  emails: Array<Record<string, unknown>>;
  emailThrows: boolean;
  audits: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/admin-api", {
  namedExports: { getAdminFromRequest: async () => ctrl.admin },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dealerInvitation: {
        findUnique: async (args: Record<string, unknown>) => {
          ctrl.findUniqueArgs.push(args);
          return ctrl.invitation;
        },
        updateMany: async (args: UpdateManyCall) => {
          ctrl.updates.push(args);
          return { count: ctrl.updateCount };
        },
      },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.audits.push(data);
          return {};
        },
      },
    },
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendDealerInvitationEmail: async (args: Record<string, unknown>) => {
      ctrl.emails.push(args);
      if (ctrl.emailThrows) throw new Error("resend is down");
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return (await import("@/app/api/admin/dealers/invitations/[invId]/resend/route")).POST;
}

function req() {
  return new NextRequest(
    `https://autolenis.com/api/admin/dealers/invitations/${INV_ID}/resend`,
    { method: "POST" },
  );
}
const ctx = { params: Promise.resolve({ invId: INV_ID }) };

/** The raw token as it reaches the dealer, pulled back out of the emailed link. */
function rawTokenFromUrl(url: string): string {
  return new URL(url).searchParams.get("token") ?? "";
}

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

beforeEach(() => {
  ctrl = {
    admin: { adminId: "admin_1", email: "admin@autolenis.com" },
    invitation: {
      id: INV_ID,
      email: "dealer@example.com",
      contactName: "Sam Dealer",
      dealershipName: "Example Motors",
      status: "PENDING",
    },
    updateCount: 1,
    findUniqueArgs: [],
    updates: [],
    emails: [],
    emailThrows: false,
    audits: [],
  };
  process.env.NEXT_PUBLIC_APP_URL = "https://autolenis.com";
});

// ---------------------------------------------------------------------------
// 1. The read must stay projected
// ---------------------------------------------------------------------------

test("the invitation is read with an explicit select, never an unprojected findUnique", async () => {
  const POST = await load();
  await POST(req(), ctx);

  const args = ctrl.findUniqueArgs[0];
  assert.ok(args, "the route must read the invitation before rotating it");
  const select = args.select as Record<string, unknown> | undefined;
  assert.ok(select, "an unprojected read asks for every model scalar — the defect class this suite exists to pin");
  // token_hash and consumed_at exist now, but the route has no use for token
  // material; naming columns explicitly is what keeps it out of the handler.
  for (const gated of ["tokenHash", "consumedAt"]) {
    assert.ok(!(gated in select), `${gated} must not be selected — the route has no use for token material`);
  }
});

// ---------------------------------------------------------------------------
// 2. The emailed link actually works
// ---------------------------------------------------------------------------

test("the link carries the RAW token and the stored hash is the hash OF THAT LINK", async () => {
  const POST = await load();
  const res = await POST(req(), ctx);
  const body = (await res.json()) as { inviteUrl: string };

  const raw = rawTokenFromUrl(body.inviteUrl);
  assert.match(raw, /^[0-9a-f]{64}$/, "256 bits of hex from the shared generator");
  assert.equal(
    ctrl.updates[0].data.tokenHash,
    sha256(raw),
    "a hash that is not the hash of the emailed token makes the invitation unclaimable",
  );
  assert.equal(ctrl.emails[0].claimUrl, body.inviteUrl, "the emailed link and the API response must agree");
});

test("the superseded plaintext is nulled, so the old link dies", async () => {
  ctrl.invitation = { ...(ctrl.invitation as object), token: OLD_PLAINTEXT } as Record<string, unknown>;
  const POST = await load();
  await POST(req(), ctx);

  assert.equal(
    ctrl.updates[0].data.token,
    null,
    "a resend that leaves the previous token resolvable has revoked nothing",
  );
});

test("the TTL is 7 days — the old 72h window expired 6 of 11 real invitations unopened", async () => {
  const before = Date.now();
  const POST = await load();
  await POST(req(), ctx);

  const ttlMs = (ctrl.updates[0].data.expiresAt as Date).getTime() - before;
  assert.ok(
    Math.abs(ttlMs - 7 * 24 * 60 * 60 * 1000) < 60_000,
    `expected a 7-day TTL, got ${Math.round(ttlMs / 3_600_000)}h`,
  );
});

test("an expired invitation is returned to PENDING rather than left retired", async () => {
  ctrl.invitation = { ...(ctrl.invitation as object), status: "EXPIRED" } as Record<string, unknown>;
  const POST = await load();
  const res = await POST(req(), ctx);

  assert.equal(res.status, 200);
  assert.equal(ctrl.updates[0].data.status, "PENDING");
});

// ---------------------------------------------------------------------------
// 3. Authorization and status
// ---------------------------------------------------------------------------

test("an unauthenticated caller is rejected and rotates nothing", async () => {
  ctrl.admin = null;
  const POST = await load();
  const res = await POST(req(), ctx);

  assert.equal(res.status, 401);
  assert.equal(ctrl.updates.length, 0);
  assert.equal(ctrl.findUniqueArgs.length, 0, "authorize before reading, not after");
});

test("a missing invitation is a 404", async () => {
  ctrl.invitation = null;
  const POST = await load();
  assert.equal((await POST(req(), ctx)).status, 404);
});

test("an accepted invitation is refused and never re-armed", async () => {
  ctrl.invitation = { ...(ctrl.invitation as object), status: "ACCEPTED" } as Record<string, unknown>;
  const POST = await load();
  const res = await POST(req(), ctx);

  assert.equal(res.status, 409);
  assert.equal(ctrl.updates.length, 0);
  assert.equal(ctrl.emails.length, 0, "no live link may be emailed for a consumed invitation");
});

test("a cancelled invitation is refused and never re-armed", async () => {
  ctrl.invitation = { ...(ctrl.invitation as object), status: "CANCELLED" } as Record<string, unknown>;
  const POST = await load();
  const res = await POST(req(), ctx);

  assert.equal(res.status, 409);
  assert.equal(ctrl.updates.length, 0);
  assert.equal(ctrl.emails.length, 0);
});

test("losing the guarded rotation race is a 409, not a dead link in a dealer's inbox", async () => {
  // The row was PENDING at the read above, then claimed or cancelled before the
  // status-guarded updateMany landed. Nothing was rotated, so nothing may be sent.
  ctrl.updateCount = 0;
  const POST = await load();
  const res = await POST(req(), ctx);

  assert.equal(res.status, 409);
  assert.equal(ctrl.emails.length, 0, "emailing a token that was never persisted hands out a link that cannot work");
});

// ---------------------------------------------------------------------------
// 4. Side effects
// ---------------------------------------------------------------------------

test("the admin action is audited against the invitation", async () => {
  const POST = await load();
  await POST(req(), ctx);

  assert.equal(ctrl.audits.length, 1);
  assert.equal(ctrl.audits[0].entityId, INV_ID);
  assert.equal(ctrl.audits[0].adminId, "admin_1");
});

test("an email provider outage does not fail the request — the token is already rotated", async () => {
  ctrl.emailThrows = true;
  const POST = await load();
  const res = await POST(req(), ctx);

  assert.equal(res.status, 200, "the rotation is committed; failing the response would invite a second rotation");
  assert.equal(ctrl.audits.length, 1, "the admin action still happened and must still be recorded");
});
