// Route contract tests for POST /api/admin/contract-shield/[reviewId] — APPROVE.
//
// Lives here (not co-located under the [reviewId] segment) because node:test treats
// "[" as a glob metacharacter, so a path containing the [reviewId] segment cannot be
// passed to the runner. The route is imported via the @/ alias, which tsx resolves
// from tsconfig paths without shell globbing.
//
// Regression target: the route knew exactly which ContractScan the admin reviewed
// (reviewId IS the scan id) and then threw that identity away — it called
// approveContractVersionByAdmin(deal.id), which approved whichever ContractVersion
// was NEWEST. A dealer revision uploaded while the scan sat in the review queue was
// therefore approved unreviewed, and buyer-signing.service binds the buyer's binding
// signature and tamper hash to whichever version is APPROVED.
//
// These tests pin two things end to end at the route seam:
//   (1) the route hands the approval the scan's OWN contractVersionId, and
//   (2) when that gate refuses, the route fails CLOSED — no scan PASS write, no
//       deal advance to CONTRACT_APPROVED, no signing envelope, no buyer "you can
//       sign now" notification.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/contract-shield/__tests__/approve-binds-to-reviewed-version.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

// ── Controllable scan row + call spies ───────────────────────────────────────
let scanRow: Record<string, unknown> | null = null;
let approveCalls: Array<{ dealId: string; contractVersionId: string | null }> = [];
let approveResult: { ok: boolean; contractVersionId?: string; code?: string; message?: string } = {
  ok: true,
  contractVersionId: "cv_1",
};
let scanUpdates: Array<Record<string, unknown>> = [];
let advanceCalls: Array<{ dealId: string; to: string }> = [];
let envelopeCalls = 0;
let notifications: Array<Record<string, unknown>> = [];
let auditLogs: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      contractScan: {
        findUnique: async () => scanRow,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          scanUpdates.push(data);
          return { id: "scan_1", ...data };
        },
      },
      deal: { update: async () => ({ id: "deal_1" }) },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          auditLogs.push(data);
          return data;
        },
      },
      notification: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          notifications.push(data);
          return data;
        },
      },
    },
  },
});

mock.module("@/lib/services/dealer/dealer-contract.service", {
  namedExports: {
    approveContractVersionByAdmin: async (dealId: string, contractVersionId: string | null) => {
      approveCalls.push({ dealId, contractVersionId });
      return approveResult;
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (dealId: string, to: string) => {
      advanceCalls.push({ dealId, to });
      return true;
    },
  },
});

mock.module("@/lib/services/esign/buyer-signing.service", {
  namedExports: {
    prepareBuyerSigningEnvelope: async () => {
      envelopeCalls += 1;
      return { envelopeId: "env_1", documentVersionId: "cv_1", documentHash: "hash", status: "SENT" };
    },
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendContractApprovedEmail: async () => undefined,
    sendContractShieldAlertEmail: async () => undefined,
    sendDealerContractIssuesEmail: async () => undefined,
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({
      adminId: "admin_1",
      email: "ops@autolenis.com",
      role: "SUPER_ADMIN",
      mfaVerified: true,
    }),
    adminSuccess: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message }, correlationId: "test-corr-id" }, { status }),
  },
});

async function loadPOST() {
  const mod = await import("@/app/api/admin/contract-shield/[reviewId]/route");
  return mod.POST;
}

function req() {
  return new NextRequest("http://localhost/api/admin/contract-shield/scan_1", {
    method: "POST",
    body: JSON.stringify({ action: "APPROVE" }),
    headers: { "content-type": "application/json" },
  });
}

const call = () => loadPOST().then((POST) => POST(req(), { params: Promise.resolve({ reviewId: "scan_1" }) }));

beforeEach(() => {
  scanRow = {
    id: "scan_1",
    dealId: "deal_1",
    contractVersionId: "cv_1",
    score: 62,
    status: "FAIL",
    changeLog: null,
    deal: {
      id: "deal_1",
      buyerId: "buyer_1",
      buyer: { firstName: "Sam", lastName: "Buyer", user: { email: "buyer@example.com" } },
      offer: null,
    },
  };
  approveCalls = [];
  approveResult = { ok: true, contractVersionId: "cv_1" };
  scanUpdates = [];
  advanceCalls = [];
  envelopeCalls = 0;
  notifications = [];
  auditLogs = [];
});

test("APPROVE binds to the scan's OWN contract version, not the deal's newest", async () => {
  scanRow!.contractVersionId = "cv_reviewed";

  const res = await call();

  assert.equal(res.status, 200);
  assert.deepEqual(
    approveCalls,
    [{ dealId: "deal_1", contractVersionId: "cv_reviewed" }],
    "the reviewed version id must reach the approval — passing only the deal id is the defect",
  );
});

test("a refused approval fails CLOSED — 409, no PASS write, no advance, no envelope, no buyer notice", async () => {
  approveResult = { ok: false, code: "SUPERSEDED_BY_NEWER_UPLOAD", message: "A newer contract version was uploaded after this review." };

  const res = await call();

  assert.equal(res.status, 409, "the admin must be told the approval was refused, not silently succeed");
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "CONTRACT_VERSION_NOT_APPROVABLE");
  assert.deepEqual(scanUpdates, [], "the scan must NOT be marked PASS when the version could not be approved");
  assert.deepEqual(advanceCalls, [], "the deal must NOT reach CONTRACT_APPROVED on a refused approval");
  assert.equal(envelopeCalls, 0, "no signing envelope may be prepared for an unapproved document");
  assert.deepEqual(notifications, [], "the buyer must NOT be told to sign a contract that was not approved");
});

test("a legacy scan with no linked version is refused, not guessed", async () => {
  scanRow!.contractVersionId = null;
  approveResult = { ok: false, code: "NO_LINKED_VERSION", message: "This review is not linked to a contract version. Re-scan the contract." };

  const res = await call();

  assert.equal(res.status, 409);
  assert.deepEqual(approveCalls, [{ dealId: "deal_1", contractVersionId: null }]);
  assert.deepEqual(advanceCalls, [], "an unlinked legacy review must never advance the deal");
});

test("a successful approval still advances the deal and prepares signing (no regression)", async () => {
  const res = await call();

  assert.equal(res.status, 200);
  assert.equal(scanUpdates.length, 1);
  assert.equal(scanUpdates[0]!.status, "PASS");
  assert.deepEqual(advanceCalls, [{ dealId: "deal_1", to: "CONTRACT_APPROVED" }]);
  assert.equal(envelopeCalls, 1);
  assert.equal(notifications.length, 1, "the buyer is told to sign only on a real approval");
});
