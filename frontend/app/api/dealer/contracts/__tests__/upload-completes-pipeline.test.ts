// POST /api/dealer/contracts/upload-file must COMPLETE the contract pipeline.
//
// Regression target: contract attachment was a TWO-STEP flow that nobody ever
// completed. ContractUploadButton.tsx:32 posts the PDF to
// /api/dealer/contracts/upload-file and then sets state "done" — it never calls
// /api/dealer/contracts/upload, the JSON route that actually creates the
// ContractVersion. Grepping the repo, that second route has ZERO callers.
//
// The consequence: the dealer's PDF lands in Supabase Storage, the dealer is told
// "Uploaded: contract.pdf", and NO ContractVersion row exists. With no
// ContractVersion there is no Contract Shield scan, no APPROVED version, no
// signing envelope — the deal dead-ends at CONTRACT_PENDING exactly like the
// concierge track, for a different reason. The contract-shield cron queries
// `contractVersion where status UPLOADED`, so it finds nothing and reports healthy.
//
// The fix makes the storage route complete the flow itself through the SAME
// service the JSON route uses (uploadDealerContract), so the pipeline cannot be
// left half-done by a caller that forgets step two.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/dealer/contracts/__tests__/upload-completes-pipeline.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

let uploadCalls: Array<{ dealId: string; dealerId: string; documentUrl: string }> = [];
let storageUploads: Array<{ path: string; bytes: number }> = [];
let storageError: string | null = null;
let ownsDeal = true;

mock.module("@/lib/supabase", {
  namedExports: {
    createServiceSupabaseClient: () => ({
      storage: {
        from: () => ({
          upload: async (path: string, buffer: Buffer) => {
            storageUploads.push({ path, bytes: buffer.length });
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
    assertDealerOwnsDeal: async () => { if (!ownsDeal) throw new DealOwnershipError(); },
    uploadDealerContract: async (dealId: string, dealerId: string, documentUrl: string) => {
      uploadCalls.push({ dealId, dealerId, documentUrl });
      return { id: "cv_1", dealId, documentUrl, version: 1, uploadedBy: dealerId, status: "UPLOADED" };
    },
  },
});

mock.module("@/lib/auth/dealer-api", {
  namedExports: {
    getRequestDealer: async () => ({ id: "dealer_1" }),
    successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function loadPOST() {
  const mod = await import("@/app/api/dealer/contracts/upload-file/route");
  return mod.POST;
}

function pdfRequest(name = "contract.pdf", type = "application/pdf", size = 4096) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(size)], name, { type }));
  form.append("dealId", "deal_1");
  return new NextRequest("http://localhost/api/dealer/contracts/upload-file", { method: "POST", body: form });
}

beforeEach(() => {
  uploadCalls = [];
  storageUploads = [];
  storageError = null;
  ownsDeal = true;
});

test("a successful upload CREATES the ContractVersion — storage alone is not 'uploaded'", async () => {
  const POST = await loadPOST();
  const res = await POST(pdfRequest());

  assert.equal(res.status, 200);
  assert.equal(storageUploads.length, 1, "the PDF still goes to storage");
  assert.equal(
    uploadCalls.length,
    1,
    "the storage route must complete the pipeline — a stored file with no ContractVersion is the defect",
  );
  assert.equal(uploadCalls[0]!.dealId, "deal_1");
  assert.equal(uploadCalls[0]!.dealerId, "dealer_1", "provenance is the authenticated dealer, never a client-supplied id");
  assert.equal(
    uploadCalls[0]!.documentUrl,
    storageUploads[0]!.path,
    "the ContractVersion must point at the object that was just stored",
  );
});

test("the response carries the created ContractVersion so the client has a record id", async () => {
  const POST = await loadPOST();
  const res = await POST(pdfRequest());
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.data.contractVersion.id, "cv_1");
  assert.equal(body.data.contractVersion.status, "UPLOADED", "must enter the fail-closed scan pipeline, not pre-approved");
});

test("a deal this dealer does not own is refused BEFORE anything is stored", async () => {
  ownsDeal = false;
  const POST = await loadPOST();
  const res = await POST(pdfRequest());

  assert.equal(res.status, 403);
  assert.deepEqual(storageUploads, [], "no bytes may be written for a deal the dealer does not own");
  assert.deepEqual(uploadCalls, [], "no ContractVersion may be created");
});

test("a non-PDF is refused and never reaches storage or the pipeline", async () => {
  const POST = await loadPOST();
  const res = await POST(pdfRequest("evil.html", "text/html"));

  assert.equal(res.status, 400);
  assert.deepEqual(storageUploads, []);
  assert.deepEqual(uploadCalls, []);
});

test("a storage failure does NOT create a ContractVersion pointing at a missing object", async () => {
  storageError = "bucket unavailable";
  const POST = await loadPOST();
  const res = await POST(pdfRequest());

  assert.equal(res.status, 500);
  assert.deepEqual(uploadCalls, [], "a ContractVersion whose document does not exist would fail every scan forever");
});
