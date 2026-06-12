// Route contract tests for GET /api/admin/content/[id] — the endpoint behind
// the bulk dashboard "Preview" drawer.
//
// Regression target: a thrown error in the read path used to escape the handler,
// so Next returned a 500 with an EMPTY body. The client then called res.json()
// on it, which throws "Unexpected end of JSON input". These tests pin the
// contract: every path (success, not-found, internal error) returns a non-empty
// JSON body with the right status.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/content/__tests__/preview-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

// ── Controllable service behaviour ───────────────────────────────────────────
let articleResult: unknown = null;
let serviceError: Error | null = null;

mock.module("@/lib/services/admin/admin-content.service", {
  namedExports: {
    getContentArticleById: async (_id: string) => {
      if (serviceError) throw serviceError;
      return articleResult;
    },
  },
});

// Stub the auth layer as authenticated, but keep the real JSON envelope shape so
// we are exercising the actual success/error contract the client parses.
mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({
      adminId: "admin_1",
      email: "ops@autolenis.com",
      role: "SUPER_ADMIN",
      mfaVerified: true,
    }),
    adminSuccess: (data: unknown, status = 200) =>
      NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
    createAuditLog: async () => undefined,
  },
});

// Import lazily (after mocks are registered) so the route resolves the mocked
// service/auth modules.
async function loadGET() {
  const mod = await import("../[id]/route");
  return mod.GET;
}

function req() {
  return new NextRequest("http://localhost/api/admin/content/art_1");
}

async function rawBody(res: Response) {
  return (await res.text()).trim();
}

beforeEach(() => {
  articleResult = null;
  serviceError = null;
});

test("success returns JSON with the article payload", async () => {
  articleResult = {
    id: "art_1",
    slug: "toyota-camry-dealer-quotes-dallas-tx",
    title: "Toyota Camry Dealer Quotes in Dallas, TX",
    body: "<p>preview</p>",
    metaDescription: "meta",
    h1: "h1",
    status: "PUBLISHED",
  };

  const GET = await loadGET();
  const res = await GET(req(), { params: Promise.resolve({ id: "art_1" }) });

  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = JSON.parse(await rawBody(res));
  assert.equal(body.success, true);
  assert.equal(body.data.article.id, "art_1");
});

test("not found returns a JSON 404 with a non-empty body", async () => {
  articleResult = null; // findUnique miss

  const GET = await loadGET();
  const res = await GET(req(), { params: Promise.resolve({ id: "missing" }) });

  assert.equal(res.status, 404);
  const text = await rawBody(res);
  assert.ok(text.length > 0, "404 body must not be empty");
  const body = JSON.parse(text);
  assert.equal(body.error.code, "NOT_FOUND");
});

test("an internal read error returns JSON 500 — never an empty body", async () => {
  // This is the exact failure mode that produced "Unexpected end of JSON input".
  serviceError = new Error('column "lifecycle_status" does not exist');

  const GET = await loadGET();
  const res = await GET(req(), { params: Promise.resolve({ id: "art_1" }) });

  assert.equal(res.status, 500);
  const text = await rawBody(res);
  assert.ok(text.length > 0, "500 body must not be empty — the client parses it as JSON");
  const body = JSON.parse(text); // must not throw
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.match(body.error.message, /lifecycle_status/);
});
