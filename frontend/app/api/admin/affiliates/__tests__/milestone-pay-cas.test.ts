// M9 — marking a referral milestone paid must be a compare-and-set on
// paidAt: two concurrent clicks stamp (and audit) exactly once; the loser
// gets ALREADY_PAID instead of silently double-logging.
//
// Lives in this __tests__ dir (not next to the [id] route) because node:test
// cannot take "[" glob metacharacters on the CLI; the route is imported via
// the @/ alias — same precedent as commission-authz-route.test.ts.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/affiliates/__tests__/milestone-pay-cas.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

let milestone: { id: string; buyerId: string; milestone: string; rewardType: string; rewardValue: number; paidAt: Date | null };
let auditCalls = 0;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      referralMilestone: {
        findUnique: async () => milestone,
        updateMany: async ({ where, data }: { where: { id: string; paidAt: null }; data: { paidAt: Date } }) => {
          if (milestone.id === where.id && milestone.paidAt === null) {
            milestone.paidAt = data.paidAt;
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
    },
  },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminWithRole: async () => ({ adminId: "admin_1", email: "a@x.com", role: "FINANCE_ADMIN" }),
    adminSuccess: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
    createAuditLog: async () => {
      auditCalls += 1;
    },
  },
});

function req() {
  return new NextRequest("http://localhost/api/admin/referral-milestones/m_1/pay", {
    method: "POST",
    body: JSON.stringify({ reason: "reward processed" }),
  });
}
const params = { params: Promise.resolve({ id: "m_1" }) };

beforeEach(() => {
  milestone = { id: "m_1", buyerId: "buyer_1", milestone: "5 referrals", rewardType: "CASH", rewardValue: 5000, paidAt: null };
  auditCalls = 0;
});

test("pays once: stamp set, audited once", async () => {
  const { POST } = await import("@/app/api/admin/referral-milestones/[id]/pay/route");
  const res = await POST(req(), params);
  assert.equal(res.status, 200);
  assert.ok(milestone.paidAt instanceof Date);
  assert.equal(auditCalls, 1);
});

test("concurrent second pay (read saw null, CAS lost): ALREADY_PAID, not double-audited", async () => {
  const { POST } = await import("@/app/api/admin/referral-milestones/[id]/pay/route");
  // Simulate the race: the route's initial findUnique still sees paidAt null,
  // but by CAS time another request has stamped it.
  const original = milestone;
  let reads = 0;
  const raceView = new Proxy(original, {
    get(target, prop) {
      if (prop === "paidAt") {
        reads += 1;
        // first read (pre-check) sees null; the CAS uses live state
        return reads === 1 ? null : target.paidAt;
      }
      return target[prop as keyof typeof target];
    },
  });
  milestone = raceView as typeof milestone;
  original.paidAt = new Date("2026-08-29T00:00:00Z"); // the concurrent winner's stamp

  const res = await POST(req(), params);
  assert.equal(res.status, 400);
  const body = JSON.parse(await res.text());
  assert.equal(body.error.code, "ALREADY_PAID");
  assert.equal(auditCalls, 0, "the losing pay must not write an audit row");
});
