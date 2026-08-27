// Authorization contract tests for the admin e-sign routes:
//   POST /api/admin/deals/[dealId]/esign/void      (irreversible envelope void)
//   GET  /api/admin/deals/[dealId]/esign/evidence  (raw forensic PII export)
//
// Lives here (not co-located under the [dealId] segment) because node:test treats
// "[" as a glob metacharacter, so a path containing the [dealId] segment cannot be
// passed to the runner. Routes are imported via the @/ alias, which tsx resolves
// from tsconfig paths without shell globbing.
//
// Regression target (admin authz audit, batch 1): both routes gated only on
// requirePermission("deals.esign.void"), which is SHADOW-ONLY — under the default
// runtime (RBAC_ENFORCE unset) a role outside the permission's allow-list is
// recorded as RBAC_SHADOW_DENY and then ALLOWED. So any authenticated admin could
// void a live signing envelope, and any authenticated admin could export the raw
// evidence package (IP, user-agent, consent snapshot — the only surface exposing
// that unredacted).
//
// The intended policy is OPS, not FINANCE: PERMISSION_ROLES["deals.esign.void"]
// is ["SUPER_ADMIN", "OPERATIONS_ADMIN"], the sibling deals/[dealId]/action route
// hard-checks that same pair inline, and the evidence route's own header documents
// it as "OPS-gated". These tests pin that hard gate.

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

// ── Controllable caller role + side-effect spies ─────────────────────────────
let callerRole = "OPERATIONS_ADMIN";
let envelopeStatus = "SENT";
let voidCalls = 0;
let evidenceCalls = 0;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      eSignEnvelope: {
        findUnique: async () => ({ id: "env_1", dealId: "deal_1", status: envelopeStatus }),
      },
      eSignEnvelopeHistory: { findMany: async () => [] },
    },
  },
});

mock.module("@/lib/services/esign/esign.service", {
  namedExports: {
    voidEnvelope: async () => {
      voidCalls += 1;
    },
  },
});

mock.module("@/lib/services/esign/esign-dto", {
  namedExports: {
    toAdminEvidencePackage: () => {
      evidenceCalls += 1;
      return { envelope: { id: "env_1" }, history: [] };
    },
  },
});

// requirePermission is SHADOW-ONLY by design: it returns the authenticated admin
// even when the role is outside the permission's allow-list. Mocking that real
// behaviour is the point — it proves the route's own hard check is what blocks.
mock.module("@/lib/auth/permissions", {
  namedExports: {
    requirePermission: async () => ({
      adminId: "admin_1",
      email: "caller@autolenis.com",
      role: callerRole,
      mfaVerified: true,
    }),
  },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    adminSuccess: (data: unknown, status = 200) =>
      NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message }, correlationId: "test-corr-id" }, { status }),
    createAuditLog: async () => ({ id: "log_1" }),
  },
});

async function loadVoid() {
  const mod = await import("@/app/api/admin/deals/[dealId]/esign/void/route");
  return mod.POST;
}
async function loadEvidence() {
  const mod = await import("@/app/api/admin/deals/[dealId]/esign/evidence/route");
  return mod.GET;
}

function voidReq(body: unknown = { reason: "Buyer requested a corrected contract." }) {
  return new NextRequest("http://localhost/api/admin/deals/deal_1/esign/void", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
function evidenceReq() {
  return new NextRequest("http://localhost/api/admin/deals/deal_1/esign/evidence", {
    method: "GET",
  });
}
const params = { params: Promise.resolve({ dealId: "deal_1" }) };

// Roles outside the OPS pair. FINANCE_ADMIN is included deliberately: money
// authority does not confer e-sign authority — the role sets are distinct.
const UNDER_PRIVILEGED = ["SUPPORT_ADMIN", "COMPLIANCE_ADMIN", "FINANCE_ADMIN"] as const;

beforeEach(() => {
  callerRole = "OPERATIONS_ADMIN";
  envelopeStatus = "SENT";
  voidCalls = 0;
  evidenceCalls = 0;
});

// ── void ─────────────────────────────────────────────────────────────────────
for (const role of UNDER_PRIVILEGED) {
  test(`void: ${role} → 403 and the envelope is NEVER voided`, async () => {
    callerRole = role;

    const POST = await loadVoid();
    const res = await POST(voidReq(), params);

    assert.equal(res.status, 403);
    const body = JSON.parse((await res.text()).trim());
    assert.equal(body.error.code, "FORBIDDEN");
    assert.equal(voidCalls, 0, `${role} must not void a signing envelope`);
  });
}

test("void: OPERATIONS_ADMIN still voids (no regression)", async () => {
  callerRole = "OPERATIONS_ADMIN";

  const POST = await loadVoid();
  const res = await POST(voidReq(), params);

  assert.equal(res.status, 200);
  assert.equal(voidCalls, 1);
});

test("void: SUPER_ADMIN still voids (no regression)", async () => {
  callerRole = "SUPER_ADMIN";

  const POST = await loadVoid();
  const res = await POST(voidReq(), params);

  assert.equal(res.status, 200);
  assert.equal(voidCalls, 1);
});

test("void: authorization is checked BEFORE envelope state validation", async () => {
  callerRole = "SUPPORT_ADMIN";
  envelopeStatus = "COMPLETED"; // would otherwise short-circuit with 409

  const POST = await loadVoid();
  const res = await POST(voidReq(), params);

  assert.equal(res.status, 403, "role check must short-circuit ahead of the state check");
  assert.equal(voidCalls, 0);
});

// ── evidence (raw forensic PII export) ───────────────────────────────────────
for (const role of UNDER_PRIVILEGED) {
  test(`evidence: ${role} → 403 and no evidence package is built`, async () => {
    callerRole = role;

    const GET = await loadEvidence();
    const res = await GET(evidenceReq(), params);

    assert.equal(res.status, 403);
    const body = JSON.parse((await res.text()).trim());
    assert.equal(body.error.code, "FORBIDDEN");
    assert.equal(evidenceCalls, 0, `${role} must not export raw e-sign forensic evidence`);
  });
}

test("evidence: OPERATIONS_ADMIN still exports the package (no regression)", async () => {
  callerRole = "OPERATIONS_ADMIN";

  const GET = await loadEvidence();
  const res = await GET(evidenceReq(), params);

  assert.equal(res.status, 200);
  assert.equal(evidenceCalls, 1);
});

test("evidence: SUPER_ADMIN still exports the package (no regression)", async () => {
  callerRole = "SUPER_ADMIN";

  const GET = await loadEvidence();
  const res = await GET(evidenceReq(), params);

  assert.equal(res.status, 200);
  assert.equal(evidenceCalls, 1);
});
