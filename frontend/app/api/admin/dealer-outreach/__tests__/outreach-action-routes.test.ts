// HTTP surface for the outreach actions: SMS, manual call logging, status.
//
// WHY THESE EXIST. Tasks 7-10 built the services — the consent gate, the call
// log, the guarded status machine — but nothing on the web could reach them.
// `/admin/dealer-outreach/queue` rendered a read-only table, and the operator's
// one shipping-enabled action (log the call you just made) had no endpoint. A
// service with no caller is indistinguishable from an unimplemented one.
//
// WHAT THESE ASSERT, AND WHY THIS SHAPE. The prisma client is faked and the
// REAL services run against it. The routes are NOT allowed to reach the gates
// through stub deps: `sendDealerSms` ships with no default loadTarget, so a
// route that forgets to wire one gets `not_found` and refuses everything, which
// would look exactly like a working consent gate from the outside. The tests
// therefore assert the SPECIFIC refusal reason and the row it leaves behind —
// `dnc_blocked` can only be produced by a target that was actually loaded and
// actually evaluated.
//
// Run: pnpm test:admin-dealers

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { adminSuccess, adminError, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";

// ── controllable caller ──────────────────────────────────────────────────────
type Caller = { adminId: string; email: string; role: string; mfaVerified: boolean } | null;
let caller: Caller = null;

// ── prisma fake ──────────────────────────────────────────────────────────────
interface ProspectRow {
  id: string;
  status: string;
  phone: string | null;
  state: string | null;
  zip: string | null;
  rooftopId: string | null;
}
let prospects: ProspectRow[] = [];
let contactProfiles: Record<string, unknown>[] = [];
let logRows: Record<string, unknown>[] = [];
let logIdSeq = 0;

const pick = <T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>) => {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k as keyof T];
  return out;
};

const prismaFake = {
  dealerProspect: {
    findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
      const row = prospects.find((p) => p.id === where.id);
      return row ? pick(row as unknown as Record<string, unknown>, select) : null;
    },
    findFirst: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
      const row = prospects.find((p) => p.id === where.id);
      return row ? pick(row as unknown as Record<string, unknown>, select) : null;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = prospects.find((p) => p.id === where.id && p.status === where.status);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  },
  dealerContactProfile: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      contactProfiles.find((c) => c.rooftopId === where.rooftopId) ?? null,
  },
  dealerOutreachLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `log_${++logIdSeq}`, ...data };
      logRows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = logRows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      logRows.find(
        (r) =>
          r.dealerProspectId === where.dealerProspectId &&
          r.channel === where.channel &&
          r.outreachSequenceStep === where.outreachSequenceStep &&
          r.status !== "failed",
      ) ?? null,
  },
  adminAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "audit_1", ...data }) },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFake } });

// The real response helpers and the real role list — only the caller identity is
// controllable. Testing a mocked adminError would assert nothing.
mock.module("@/lib/auth/admin-api", {
  namedExports: {
    adminSuccess,
    adminError,
    OPERATIONAL_ROLES,
    getClientIp: () => null,
    createAuditLog: async () => ({ id: "audit_1" }),
    getAdminFromRequest: async () => caller,
    getAdminWithRole: async (_req: unknown, roles: string[]) =>
      caller && roles.includes(caller.role) ? caller : null,
  },
});

// Suppression and quiet hours are consulted by the SMS wiring. Neither may be
// reached in these tests — the consent gate refuses first — so they are mocked
// to throw. A test that passes here proves the gate ran BEFORE them.
mock.module("@/lib/services/suppression.service", {
  namedExports: {
    SuppressionService: {
      isSmsSuppressed: async () => {
        throw new Error("suppression must not be consulted before the consent gate");
      },
    },
  },
});

const post = async (mod: string, body: unknown, url = "http://localhost/api") => {
  const { POST } = (await import(mod)) as {
    POST: (r: Request) => Promise<Response>;
  };
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req as never);
};

const SMS_ROUTE = "@/app/api/admin/dealer-outreach/send-sms/route";
const CALL_ROUTE = "@/app/api/admin/dealer-outreach/log-call/route";
const STATUS_ROUTE = "@/app/api/admin/dealer-outreach/status/route";

beforeEach(() => {
  caller = { adminId: "admin_1", email: "ops@autolenis.com", role: "OPERATIONS_ADMIN", mfaVerified: true };
  logRows = [];
  logIdSeq = 0;
  prospects = [
    { id: "p_dnc", status: "DISCOVERED", phone: "+15125550102", state: "TX", zip: "78701", rooftopId: "r_dnc" },
    { id: "p_ok", status: "DISCOVERED", phone: "+15125550101", state: "TX", zip: "78701", rooftopId: "r_ok" },
  ];
  contactProfiles = [
    { rooftopId: "r_dnc", consentBasis: "EXPRESS_WRITTEN", dncStatus: "found", phoneType: "mobile_phone" },
    { rooftopId: "r_ok", consentBasis: "NONE", dncStatus: "not_found", phoneType: "corporate_phone" },
  ];
  delete process.env.DEALER_OUTREACH_SMS_ENABLED;
});

// ── authorization ────────────────────────────────────────────────────────────

test("all three action routes refuse an unauthenticated caller", async () => {
  caller = null;
  for (const mod of [SMS_ROUTE, CALL_ROUTE, STATUS_ROUTE]) {
    const res = await post(mod, { prospectId: "p_ok" });
    assert.equal(res.status, 401, `${mod} must 401 without a session`);
  }
  assert.equal(logRows.length, 0, "an unauthenticated call must not write a row");
});

test("a read-only SUPPORT_ADMIN cannot send, log a call, or change status", async () => {
  caller = { adminId: "admin_2", email: "support@autolenis.com", role: "SUPPORT_ADMIN", mfaVerified: true };
  for (const mod of [SMS_ROUTE, CALL_ROUTE, STATUS_ROUTE]) {
    const res = await post(mod, { prospectId: "p_ok", disposition: "CONNECTED", durationSeconds: 30, to: "CONTACTED" });
    assert.equal(res.status, 403, `${mod} must 403 for a read-only role`);
  }
  assert.equal(logRows.length, 0, "a forbidden call must not write a row");
});

// ── SMS: the gate is reached, and it refuses ────────────────────────────────

test("SMS is refused while the send flag is off, and the refusal is RECORDED", async () => {
  const res = await post(SMS_ROUTE, { prospectId: "p_ok", body: "hello" });
  assert.equal(res.status, 409, "a blocked send is a conflict, not a server error");
  const payload = (await res.json()) as { error: { code: string } };
  assert.equal(payload.error.code, "SEND_DISABLED");

  assert.equal(logRows.length, 1, "exactly one row — not zero, the bug this branch exists to fix");
  assert.equal(logRows[0].channel, "sms");
  assert.equal(logRows[0].status, "failed");
  assert.equal(logRows[0].consentBasis, "NONE", "the basis in force is recorded on every row");
});

test("a DNC-flagged prospect is refused by the CONSENT GATE, not by a missing dep", async () => {
  process.env.DEALER_OUTREACH_SMS_ENABLED = "true";
  const res = await post(SMS_ROUTE, { prospectId: "p_dnc", body: "hello" });
  assert.equal(res.status, 409);
  const payload = (await res.json()) as { error: { code: string } };
  // The specific reason is the whole point: `dnc_blocked` is only reachable
  // once a target has been LOADED and EVALUATED. `not_found` here would mean
  // the route never wired loadTarget and refuses everything for the wrong reason.
  assert.equal(payload.error.code, "DNC_BLOCKED");
  assert.equal(logRows.length, 1);
  assert.equal(logRows[0].consentBasis, "EXPRESS_WRITTEN", "recorded even when the send is blocked");
});

test("an unknown prospect is a 404 and writes nothing — there is no FK to hang a row on", async () => {
  process.env.DEALER_OUTREACH_SMS_ENABLED = "true";
  const res = await post(SMS_ROUTE, { prospectId: "p_missing", body: "hello" });
  assert.equal(res.status, 404);
  assert.equal(logRows.length, 0);
});

test("SMS requires a non-empty body", async () => {
  const res = await post(SMS_ROUTE, { prospectId: "p_ok", body: "   " });
  assert.equal(res.status, 400);
  assert.equal(logRows.length, 0);
});

// ── manual call logging: the one action that ships ENABLED ──────────────────

test("logging a call works with NO feature flag set — this is the shipping deliverable", async () => {
  const res = await post(CALL_ROUTE, {
    prospectId: "p_ok",
    disposition: "CONNECTED",
    durationSeconds: 240,
    notes: "Spoke with the GM; sending the deck.",
  });
  assert.equal(res.status, 200, "manual call logging is not gated on any send flag");
  assert.equal(logRows.length, 1);
  assert.equal(logRows[0].channel, "CALL");
  assert.equal(logRows[0].callDisposition, "CONNECTED");
  assert.equal(logRows[0].callDurationSeconds, 240);
  assert.equal(logRows[0].status, "sent");
});

test("an unrecognised disposition is refused rather than stored as free text", async () => {
  const res = await post(CALL_ROUTE, { prospectId: "p_ok", disposition: "VIBES", durationSeconds: 10 });
  assert.equal(res.status, 400);
  assert.equal(logRows.length, 0);
});

test("a negative duration is refused", async () => {
  const res = await post(CALL_ROUTE, { prospectId: "p_ok", disposition: "CONNECTED", durationSeconds: -5 });
  assert.equal(res.status, 400);
  assert.equal(logRows.length, 0);
});

// ── status machine over HTTP ────────────────────────────────────────────────

test("DEAD without a reason is refused by the SERVER and leaves the status alone", async () => {
  const res = await post(STATUS_ROUTE, { prospectId: "p_ok", to: "DEAD" });
  assert.equal(res.status, 400);
  const payload = (await res.json()) as { error: { code: string } };
  assert.equal(payload.error.code, "DEAD_REASON_REQUIRED");
  assert.equal(prospects.find((p) => p.id === "p_ok")?.status, "DISCOVERED");
});

test("DEAD with a reason is accepted", async () => {
  const res = await post(STATUS_ROUTE, { prospectId: "p_ok", to: "DEAD", deadReason: "Closed permanently" });
  assert.equal(res.status, 200);
  assert.equal(prospects.find((p) => p.id === "p_ok")?.status, "DEAD");
});

test("an illegal transition is refused with its own code", async () => {
  const res = await post(STATUS_ROUTE, { prospectId: "p_ok", to: "DISCOVERED" });
  assert.equal(res.status, 409);
  const payload = (await res.json()) as { error: { code: string } };
  assert.equal(payload.error.code, "ILLEGAL_TRANSITION");
});

test("an unknown target status is rejected before the service is reached", async () => {
  const res = await post(STATUS_ROUTE, { prospectId: "p_ok", to: "ASCENDED" });
  assert.equal(res.status, 400);
  assert.equal(prospects.find((p) => p.id === "p_ok")?.status, "DISCOVERED");
});
