// HTTP surface for the Apollo API-contract probe.
//
// The probe spends, so the route is held to the same posture as the enrich
// route plus an explicit spend acknowledgement. The REAL ledger service runs
// against a fake prisma here — the draw and refund arithmetic is not mocked —
// and the Apollo transport is captured so the endpoints touched can be named:
// organizations/enrich and mixed_people/api_search, never people/match.
//
// Run: pnpm test:admin-dealers

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { adminSuccess, adminError, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";

type Caller = { adminId: string; email: string; role: string; mfaVerified: boolean } | null;
let caller: Caller = null;

// ── ledger + rooftop fake (the real drawCredits/refundCredits run on it) ─────
// Cap above the 500-credit live reserve floor the "backfill" consumer respects.
const ledger = { cycleKey: "", capCredits: 2000, spentCredits: 0 };
const prismaFake = {
  dealerRooftop: { findUnique: async () => null },
  apolloCreditLedger: {
    findUnique: async ({ where }: { where: { cycleKey: string } }) =>
      where.cycleKey === ledger.cycleKey ? { ...ledger } : null,
    updateMany: async ({ where, data }: { where: { cycleKey: string; spentCredits?: { lte?: number; gte?: number } }; data: { spentCredits: { increment?: number; decrement?: number } } }) => {
      if (where.cycleKey !== ledger.cycleKey) return { count: 0 };
      if (data.spentCredits.increment != null) {
        if (where.spentCredits?.lte != null && ledger.spentCredits > where.spentCredits.lte) return { count: 0 };
        ledger.spentCredits += data.spentCredits.increment;
        return { count: 1 };
      }
      if (data.spentCredits.decrement != null) {
        if (where.spentCredits?.gte != null && ledger.spentCredits < where.spentCredits.gte) return { count: 0 };
        ledger.spentCredits -= data.spentCredits.decrement;
        return { count: 1 };
      }
      return { count: 0 };
    },
  },
  adminAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "audit_1", ...data }) },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaFake } });

let audits: Array<Record<string, unknown>> = [];
mock.module("@/lib/auth/admin-api", {
  namedExports: {
    adminSuccess,
    adminError,
    OPERATIONAL_ROLES,
    getClientIp: () => null,
    createAuditLog: async (_admin: unknown, _req: unknown, params: Record<string, unknown>) => {
      audits.push(params);
      return { id: "audit_1" };
    },
    getAdminFromRequest: async () => caller,
  },
});

// ── Apollo transport ─────────────────────────────────────────────────────────
let apolloCalls: Array<{ path: string; method: string; query: string }> = [];
let orgAnswer: { status: number; json: unknown } = { status: 200, json: { organization: { id: "o-1", name: "Berman CDJR" } } };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof url === "string" ? url : url.toString();
  if (!href.includes("apollo.io")) return realFetch(url as RequestInfo, init);
  const u = new URL(href);
  apolloCalls.push({ path: u.pathname, method: init?.method ?? "GET", query: u.search });
  if (u.pathname.endsWith("/organizations/enrich")) {
    return new Response(JSON.stringify(orgAnswer.json), { status: orgAnswer.status, headers: { "content-type": "application/json" } });
  }
  if (u.pathname.endsWith("/mixed_people/api_search")) {
    return new Response(JSON.stringify({ people: [], pagination: { total_entries: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: "unexpected endpoint" }), { status: 500 });
}) as typeof globalThis.fetch;

const ROUTE = "@/app/api/admin/dealer-outreach/apollo/probe/route";
const post = async (body: unknown) => {
  const { POST } = (await import(ROUTE)) as { POST: (r: Request) => Promise<Response> };
  return POST(new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never);
};
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

beforeEach(() => {
  caller = { adminId: "admin_1", email: "ops@autolenis.com", role: "OPERATIONS_ADMIN", mfaVerified: true };
  const now = new Date();
  ledger.cycleKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  ledger.capCredits = 2000;
  ledger.spentCredits = 0;
  apolloCalls = [];
  audits = [];
  orgAnswer = { status: 200, json: { organization: { id: "o-1", name: "Berman CDJR" } } };
  process.env.APOLLO_API_KEY = "test-key";
  process.env.APOLLO_REVEAL_ENABLED = "true";
});

test("refuses an unauthenticated caller and a read-only role, spending nothing", async () => {
  caller = null;
  assert.equal((await post({ acknowledgeSpend: true })).status, 401);
  caller = { adminId: "admin_2", email: "support@autolenis.com", role: "SUPPORT_ADMIN", mfaVerified: true };
  assert.equal((await post({ acknowledgeSpend: true })).status, 403);
  assert.equal(apolloCalls.length, 0);
  assert.equal(ledger.spentCredits, 0);
});

test("refuses without an explicit spend acknowledgement that names the ceiling — no call, no draw", async () => {
  for (const body of [{}, { acknowledgeSpend: false }, { acknowledgeSpend: "true" }]) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const payload = await json<{ error: { code: string; message: string } }>(res);
    assert.equal(payload.error.code, "ACKNOWLEDGE_SPEND_REQUIRED");
    assert.match(payload.error.message, /up to 3 credit/);
  }
  assert.equal(apolloCalls.length, 0);
  assert.equal(ledger.spentCredits, 0);
});

test("the paid tier off → 409, nothing asked of Apollo", async () => {
  delete process.env.APOLLO_REVEAL_ENABLED;
  const res = await post({ acknowledgeSpend: true });
  assert.equal(res.status, 409);
  assert.equal((await json<{ error: { code: string } }>(res)).error.code, "APOLLO_DISABLED");
  assert.equal(apolloCalls.length, 0);
});

test("runs the probe: two documented paths, never people/match, credits drawn through the REAL ledger, audited", async () => {
  const res = await post({ acknowledgeSpend: true });
  assert.equal(res.status, 200);
  const body = await json<{ data: { endpointsTouched: string[]; creditsDrawn: number; creditsKept: number; rooftops: Array<{ domain: string; organizationId: string | null; orgResolution: { status: number; envelopeKeys: string[] } }> } }>(res);

  assert.deepEqual(body.data.endpointsTouched, ["/mixed_people/api_search", "/organizations/enrich"]);
  assert.equal(apolloCalls.some((c) => c.path.includes("people/match")), false);
  assert.equal(apolloCalls.filter((c) => c.path.endsWith("/organizations/enrich")).length, 3);
  assert.equal(apolloCalls.filter((c) => c.path.endsWith("/mixed_people/api_search")).length, 3);
  assert.equal(apolloCalls.length, 6);

  const enrich = apolloCalls.find((c) => c.path.endsWith("/organizations/enrich"))!;
  assert.equal(enrich.method, "GET");
  assert.equal(enrich.query, "?domain=bermancdjr.com");

  assert.equal(body.data.creditsDrawn, 3);
  assert.equal(body.data.creditsKept, 3);
  assert.equal(ledger.spentCredits, 3, "the real drawCredits ran against the ledger");
  assert.equal(body.data.rooftops[0].orgResolution.status, 200);
  assert.deepEqual(body.data.rooftops[0].orgResolution.envelopeKeys, ["organization"]);

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "APOLLO_CONTRACT_PROBE");
  assert.deepEqual((audits[0].metadata as { creditsKept: number }).creditsKept, 3);
});

test("a clean not-found refunds each credit through the REAL ledger and reports the raw envelope", async () => {
  orgAnswer = { status: 200, json: { organization: null } };
  const res = await post({ acknowledgeSpend: true });
  const body = await json<{ data: { creditsDrawn: number; creditsKept: number; rooftops: Array<{ organizationId: string | null; peopleSearch: unknown }> } }>(res);
  assert.equal(body.data.creditsDrawn, 3);
  assert.equal(body.data.creditsKept, 0);
  assert.equal(ledger.spentCredits, 0);
  assert.equal(apolloCalls.filter((c) => c.path.endsWith("/mixed_people/api_search")).length, 0);
  assert.deepEqual(body.data.rooftops[0].peopleSearch, { skipped: "no organization id resolved" });
});

test("a 404 from enrich is returned raw and the credit is kept (conservative)", async () => {
  orgAnswer = { status: 404, json: { error: "not found" } };
  const res = await post({ acknowledgeSpend: true });
  const body = await json<{ data: { creditsKept: number; rooftops: Array<{ orgResolution: { status: number; ok: boolean; body: unknown } }> } }>(res);
  assert.equal(body.data.creditsKept, 3);
  assert.equal(body.data.rooftops[0].orgResolution.status, 404);
  assert.equal(body.data.rooftops[0].orgResolution.ok, false);
  assert.deepEqual(body.data.rooftops[0].orgResolution.body, { error: "not found" });
});
