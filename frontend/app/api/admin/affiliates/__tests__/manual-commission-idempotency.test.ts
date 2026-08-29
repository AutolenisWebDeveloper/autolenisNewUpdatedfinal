// M10 — manual admin commission creation must be idempotent.
//
// The qualifyingEventId used to embed Date.now(), so a double-click or network
// retry created TWO approved commissions (≤$1,000 each). The key is now
// derived from a caller-supplied idempotencyKey: the same key can only ever
// create one commission — a replay returns the existing row (200), never a
// duplicate.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/affiliates/__tests__/manual-commission-idempotency.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

let created: Array<Record<string, unknown>> = [];

const prismaMock = {
  affiliate: { findUnique: async () => ({ id: "aff_1", status: "ACTIVE" }) },
  deal: { findUnique: async () => ({ id: "deal_1" }) },
  commission: {
    findUnique: async ({ where }: { where: { qualifyingEventId?: string } }) =>
      created.find((c) => c.qualifyingEventId === where.qualifyingEventId) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (created.some((c) => c.qualifyingEventId === data.qualifyingEventId)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const row = { id: `com_${created.length + 1}`, ...data };
      created.push(row);
      return row;
    },
  },
  adminAuditLog: { create: async () => ({ id: "log_1" }) },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({ adminId: "admin_1", email: "a@x.com", role: "FINANCE_ADMIN" }),
    adminSuccess: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/affiliates/aff_1/commissions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ affiliateId: "aff_1" }) };

const BODY = {
  dealId: "deal_1",
  level: 1,
  amountCents: 6000,
  reason: "Manual correction for missed referral.",
  idempotencyKey: "0f3b2c1d-aaaa-bbbb-cccc-111122223333",
};

beforeEach(() => {
  created = [];
});

test("same idempotencyKey twice → exactly one commission; replay returns it, not a duplicate", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/[affiliateId]/commissions/route");
  const first = await POST(req(BODY), params);
  assert.equal(first.status, 201);
  const second = await POST(req(BODY), params);
  assert.ok(second.status === 200 || second.status === 201);
  assert.equal(created.length, 1, "a retry must never create a second commission");
});

test("key is deterministic — no timestamp component", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/[affiliateId]/commissions/route");
  await POST(req(BODY), params);
  const key = created[0].qualifyingEventId as string;
  assert.equal(key, `admin-manual-aff_1-deal_1-${BODY.idempotencyKey}`);
});

test("missing idempotencyKey → 400, nothing created", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/[affiliateId]/commissions/route");
  const { idempotencyKey: _omit, ...withoutKey } = BODY;
  const res = await POST(req(withoutKey), params);
  assert.equal(res.status, 400);
  assert.equal(created.length, 0);
});

test("different keys create distinct commissions (two genuine adjustments)", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/[affiliateId]/commissions/route");
  await POST(req(BODY), params);
  await POST(req({ ...BODY, idempotencyKey: "0f3b2c1d-aaaa-bbbb-cccc-999988887777" }), params);
  assert.equal(created.length, 2);
});
