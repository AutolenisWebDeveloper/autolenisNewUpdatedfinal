// POST /api/admin/deals/[dealId]/contract/upload-file — the concierge contract
// attachment path.
//
// Lives here (not co-located under the [dealId] segment) because node:test treats
// "[" as a glob metacharacter. The route is imported via the @/ alias.
//
// Regression target (Finding 2): the concierge track could never obtain a
// ContractVersion. The ONLY writer of the "dealer-contracts" bucket was
// app/api/dealer/contracts/upload-file, gated by assertDealerOwnsDeal →
// offer.dealerId — and a concierge deal is created with vehicleRequestOfferId and
// NO offerId, so that gate can never pass. No admin route wrote to storage at all,
// and the storage key was `${dealer.id}/...`, which a concierge deal has no value
// for. With no ContractVersion there is no scan, no APPROVED version and no
// signing envelope: the deal parked at CONTRACT_PENDING forever while the buyer
// was nudged every 24h that a contract was ready.
//
// This route is the admin mirror of the dealer one — same bucket, same service,
// same fail-closed scan — with admin authorization and a dealer-independent key.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/deals/__tests__/admin-contract-upload-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

let adminUploadCalls: Array<{ dealId: string; documentUrl: string; adminId: string }> = [];
let storageUploads: Array<{ path: string }> = [];
let storageError: string | null = null;
let dealExists = true;
let authenticated = true;
let auditLogs: Array<Record<string, unknown>> = [];

mock.module("@/lib/supabase", {
  namedExports: {
    createServiceSupabaseClient: () => ({
      storage: {
        from: () => ({
          upload: async (path: string) => {
            storageUploads.push({ path });
            return storageError ? { error: { message: storageError } } : { error: null };
          },
        }),
      },
    }),
  },
});

class DealOwnershipError extends Error {
  constructor() { super("This deal is not associated with your dealership."); this.name = "DealOwnershipError"; }
}

mock.module("@/lib/services/dealer/dealer-contract.service", {
  namedExports: {
    DealOwnershipError,
    uploadContractForDealByAdmin: async (dealId: string, documentUrl: string, adminId: string) => {
      if (!dealExists) throw new DealOwnershipError();
      adminUploadCalls.push({ dealId, documentUrl, adminId });
      return { id: "cv_1", dealId, documentUrl, version: 1, uploadedBy: adminId, status: "UPLOADED" };
    },
  },
});

mock.module("@/lib/auth/permissions", {
  namedExports: {
    requirePermission: async () => (authenticated ? { adminId: "admin_1", email: "ops@autolenis.com", role: "OPERATIONS_ADMIN" } : null),
  },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    adminSuccess: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
    createAuditLog: async (_a: unknown, _r: unknown, entry: Record<string, unknown>) => { auditLogs.push(entry); },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function loadPOST() {
  const mod = await import("@/app/api/admin/deals/[dealId]/contract/upload-file/route");
  return mod.POST;
}

function pdfRequest(name = "contract.pdf", type = "application/pdf", size = 4096) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(size)], name, { type }));
  return new NextRequest("http://localhost/api/admin/deals/deal_1/contract/upload-file", { method: "POST", body: form });
}

const call = () => loadPOST().then((POST) => POST(pdfRequest(), { params: Promise.resolve({ dealId: "deal_1" }) }));

beforeEach(() => {
  adminUploadCalls = [];
  storageUploads = [];
  storageError = null;
  dealExists = true;
  authenticated = true;
  auditLogs = [];
});

test("an admin can attach a contract to a concierge deal — storage AND ContractVersion", async () => {
  const res = await call();

  assert.equal(res.status, 201);
  assert.equal(storageUploads.length, 1, "the PDF reaches the private bucket");
  assert.equal(adminUploadCalls.length, 1, "and the ContractVersion is created — this is what unblocks the track");
  assert.equal(adminUploadCalls[0]!.dealId, "deal_1");
  assert.equal(adminUploadCalls[0]!.adminId, "admin_1", "provenance records the admin");
  assert.equal(adminUploadCalls[0]!.documentUrl, storageUploads[0]!.path);
});

test("the storage key does NOT depend on a dealer id — a concierge deal has none", async () => {
  await call();
  const path = storageUploads[0]!.path;
  assert.match(path, /\.pdf$/, "stored as a PDF object");
  assert.ok(path.includes("deal_1"), "the key is scoped by deal so objects stay attributable");
  assert.ok(
    !path.startsWith("undefined/") && !path.startsWith("null/"),
    `key must not be built from an absent dealer id: ${path}`,
  );
});

test("an unauthenticated caller is refused before any bytes are written", async () => {
  authenticated = false;
  const res = await call();

  assert.equal(res.status, 401);
  assert.deepEqual(storageUploads, []);
  assert.deepEqual(adminUploadCalls, []);
});

test("a non-PDF is refused and never stored", async () => {
  const POST = await loadPOST();
  const res = await POST(pdfRequest("x.html", "text/html"), { params: Promise.resolve({ dealId: "deal_1" }) });

  assert.equal(res.status, 400);
  assert.deepEqual(storageUploads, []);
  assert.deepEqual(adminUploadCalls, []);
});

test("a missing deal is a 404, not a stored orphan object", async () => {
  dealExists = false;
  const res = await call();
  assert.equal(res.status, 404);
});

test("a traversal dealId never reaches the storage key", async () => {
  // The object is written BEFORE uploadContractForDealByAdmin confirms the deal
  // exists, so an id that escapes its prefix would place an admin-supplied file at
  // an arbitrary key in the private bucket and only then 404. The id is validated
  // before it is interpolated, so nothing is written at all.
  const POST = await loadPOST();
  for (const dealId of ["../../evil", "..%2F..%2Fevil", "a/b", "deal 1", "deal_1/../x"]) {
    storageUploads = [];
    adminUploadCalls = [];
    const res = await POST(pdfRequest(), { params: Promise.resolve({ dealId }) });
    assert.equal(res.status, 400, `must reject an unsafe deal id: ${dealId}`);
    assert.deepEqual(storageUploads, [], `nothing may be stored for deal id: ${dealId}`);
    assert.deepEqual(adminUploadCalls, [], `no ContractVersion for deal id: ${dealId}`);
  }
});

test("the attachment is audit-logged", async () => {
  await call();
  assert.equal(auditLogs.length, 1, "an admin attaching a legal document must leave an audit trail");
  assert.equal(auditLogs[0]!.entityId, "deal_1");
});
