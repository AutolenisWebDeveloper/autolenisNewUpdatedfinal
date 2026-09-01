// Thin-route gating for the ActionIntent admin API. The heavy authorization,
// approval, revalidation, and exactly-once logic is proven at the engine/store
// level; here we prove the transport gates: dormant-by-default (404) and
// authentication required (401), with no consequential work reachable otherwise.
// `@/lib/auth/admin-api` is module-mocked so the handlers run outside a Next
// request scope (no cookies()); the mocked getAdminFromRequest is unauthenticated.
//
//   npx tsx --test --experimental-test-module-mocks app/api/admin/action-intents/__tests__/routes.test.ts

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => null, // unauthenticated
    adminError: (code: string, message: string, status = 400) =>
      new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "content-type": "application/json" } }),
    adminSuccess: (data: unknown, status = 200) =>
      new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } }),
    createAuditLog: async () => {},
  },
});

const APPROVE_URL = "http://localhost/api/admin/action-intents/ai-1/approve";

test("approve route is DORMANT by default → 404 (surface off)", async () => {
  delete process.env.ACTION_INTENT_EXECUTION_ENABLED;
  const { POST } = await import("../[id]/approve/route");
  const res = await POST(new NextRequest(APPROVE_URL, { method: "POST" }), { params: Promise.resolve({ id: "ai-1" }) });
  assert.equal(res.status, 404);
});

test("reject route is DORMANT by default → 404", async () => {
  delete process.env.ACTION_INTENT_EXECUTION_ENABLED;
  const { POST } = await import("../[id]/reject/route");
  const res = await POST(
    new NextRequest("http://localhost/api/admin/action-intents/ai-1/reject", { method: "POST" }),
    { params: Promise.resolve({ id: "ai-1" }) },
  );
  assert.equal(res.status, 404);
});

test("list route is DORMANT by default → 404", async () => {
  delete process.env.ACTION_INTENT_EXECUTION_ENABLED;
  const { GET } = await import("../route");
  const res = await GET(new NextRequest("http://localhost/api/admin/action-intents", { method: "GET" }));
  assert.equal(res.status, 404);
});

test("surface ON but caller unauthenticated → 401, never reaches execution", async () => {
  process.env.ACTION_INTENT_EXECUTION_ENABLED = "true";
  try {
    const { POST } = await import("../[id]/approve/route");
    const res = await POST(new NextRequest(APPROVE_URL, { method: "POST" }), { params: Promise.resolve({ id: "ai-1" }) });
    assert.equal(res.status, 401);
  } finally {
    delete process.env.ACTION_INTENT_EXECUTION_ENABLED;
  }
});
