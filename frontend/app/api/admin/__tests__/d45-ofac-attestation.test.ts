// §13-D45 — the OFAC attestation is the sanctions control on the external
// pre-approval path, and it is load-bearing.
//
// THE RULING. D45 asked whether the human attestation should stay as the control
// or be demoted to a second check behind automated screening. The owner ruled:
// keep it, record it as a deliberate control, and ASSERT THE APPROVE ROUTE CANNOT
// WRITE `APPROVED` WITHOUT IT. Automated screening is a vendor decision, not an
// intake-phase change.
//
// WHY IT MATTERS HERE. Every iPredict approval runs a MicroBilt OFAC screen.
// The external pre-approval path skips that screen entirely — a buyer arrives with
// a lender's letter and an admin approves it — so the attestation is the ONLY
// sanctions gate on that path. A schema change that made `ofacAttested` optional,
// or a refactor that read the body before validating it, would remove a sanctions
// control and leave the route looking exactly the same.
//
// This is behavioural, not a source scan: it drives the real route module and
// asserts on what was WRITTEN. `z.literal(true)` is asserted through its effect —
// `false` and a missing key both refuse — rather than by matching the literal.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/__tests__/d45-ofac-attestation.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

mock.module("server-only", { namedExports: {}, defaultExport: {} });

/** Every write the route performs, in order. The order is part of the control. */
let writes: Array<{ model: string; op: string; data?: Record<string, unknown> }> = [];
let emailsSent = 0;

const ADMIN = { adminId: "a1", email: "finance@autolenis.test", role: "FINANCE_ADMIN" };

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ADMIN,
    getAdminWithRole: async () => ADMIN,
    adminSuccess: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
    createAuditLog: async () => undefined,
    getClientIp: () => "127.0.0.1",
  },
});
mock.module("@/lib/auth/admin-session", { namedExports: { getAuthenticatedAdmin: async () => ADMIN } });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const SUBMISSION = {
  id: "ext_1",
  status: "SUBMITTED",
  buyerId: "buyer_1",
  buyer: { id: "buyer_1", user: { email: "buyer@example.invalid", firstName: "Sam" } },
};

function model(name: string) {
  return new Proxy({} as Record<string, unknown>, {
    get: (_t, op: string) => async (args?: { data?: Record<string, unknown> }) => {
      if (name === "externalPreApproval" && (op === "findUnique" || op === "findFirst")) return SUBMISSION;
      writes.push({ model: name, op, data: args?.data });
      return { id: "row_1", ...(args?.data ?? {}) };
    },
  });
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => {
        if (prop === "$transaction") {
          return async (arg: unknown) =>
            typeof arg === "function"
              ? (arg as (tx: unknown) => Promise<unknown>)(
                  new Proxy({}, { get: (_t2, p: string) => model(p) }),
                )
              : arg;
        }
        return model(prop);
      },
    }),
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: new Proxy({}, { get: () => async () => { emailsSent++; return { outcome: "SENT" }; } }) as Record<string, unknown>,
});

async function route() {
  return import("@/app/api/admin/external-preapprovals/[id]/approve/route");
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/admin/external-preapprovals/ext_1/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const REASON = "Verified the lender letter and the buyer's identity documents.";

/** Did anything record an APPROVED decision or status? */
function approvedWrites() {
  return writes.filter((w) => {
    const d = w.data ?? {};
    return Object.values(d).includes("APPROVED") || d.decision === "APPROVED" || d.status === "APPROVED";
  });
}

beforeEach(() => { writes = []; emailsSent = 0; });

test("a missing attestation refuses, and writes NO approval", async () => {
  const { POST } = await route();
  const res = await POST(post({ reason: REASON }), { params: Promise.resolve({ id: "ext_1" }) });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.match(body.error.message, /OFAC|sanctions/i, "the refusal must name the control that refused");
  assert.deepEqual(approvedWrites(), [], "no APPROVED status or decision may be written");
  assert.equal(emailsSent, 0, "and no approval email may go to the buyer");
});

test("an attestation of FALSE refuses too — the literal is the control, not the key's presence", async () => {
  const { POST } = await route();
  const res = await POST(post({ reason: REASON, ofacAttested: false }), { params: Promise.resolve({ id: "ext_1" }) });

  assert.equal(res.status, 400);
  assert.deepEqual(approvedWrites(), [], "declining to attest is not a way through");
  assert.equal(emailsSent, 0);
});

test("with the attestation, the approval proceeds AND the attestation is recorded BEFORE it", async () => {
  const { POST } = await route();
  const res = await POST(
    post({ reason: REASON, ofacAttested: true }),
    { params: Promise.resolve({ id: "ext_1" }) },
  );

  assert.ok(res.status < 400, `expected the approval to proceed, got ${res.status}`);

  const attestedAt = writes.findIndex(
    (w) => w.model === "complianceEvent" && w.data?.eventType === "EXTERNAL_PREQUAL_OFAC_ATTESTED",
  );
  assert.ok(attestedAt >= 0, "the attestation must be recorded as a ComplianceEvent — it is the audit trail for a path with no automated screen");

  const firstApproval = writes.findIndex((w) => {
    const d = w.data ?? {};
    return Object.values(d).includes("APPROVED") || d.decision === "APPROVED" || d.status === "APPROVED";
  });
  assert.ok(firstApproval >= 0, "the approval must actually be written — otherwise this test proves nothing");
  assert.ok(
    attestedAt < firstApproval,
    "the sanctions attestation must be durable BEFORE the approval takes effect; a crash between them must not leave an approval with no screening record",
  );
});
