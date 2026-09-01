// Authorization contract tests for POST /api/admin/crm/campaigns.
//
// Regression target (admin authz audit, batch 1 — found by the security review of
// the batch's own fix): hard-enforcing comms.bulk_send on campaigns/bulk-send is
// worthless while an equivalent mass send is reachable through campaign creation.
//
// This route leaves a campaign as status='scheduled' by TWO paths:
//   1. scheduled_at supplied  → CampaignService.createCampaign derives
//      status = scheduled_at ? 'scheduled' : 'draft'
//   2. send_immediately: true → the route stamps status='scheduled', scheduled_at=now
// Either way the campaign-dispatch cron's drainDueCampaigns() picks it up
// (status='scheduled' AND scheduled_at <= now) and fanoutCampaign() enqueues to
// every segment contact via the SAME enqueueEmail/enqueueSms outbox that
// campaigns/bulk-send uses. Both were gated only on the shadow crm.manage check,
// so a SUPPORT_ADMIN 403'd at bulk-send could fan out the identical blast here.
//
// A pure draft (neither field) has no send path and deliberately keeps the
// existing crm.manage gate, which stays shadow pending the owner's CRM ruling.
//
// Run: pnpm test:admin-authz

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Controllable caller role + write spies ───────────────────────────────────
let callerRole = "OPERATIONS_ADMIN";
let createCalls = 0;
let scheduleUpdates = 0;

mock.module("@/lib/supabase-service", {
  namedExports: {
    getServiceSupabase: () => ({
      from: () => ({
        update: () => {
          scheduleUpdates += 1;
          return { eq: async () => ({ data: null, error: null }) };
        },
      }),
    }),
  },
});

mock.module("@/lib/services/campaign.service", {
  namedExports: {
    CampaignService: {
      createCampaign: async () => {
        createCalls += 1;
        return { id: "camp_1", status: "draft" };
      },
      listCampaigns: async () => [],
    },
  },
});

// Real semantics: the shadow helper ALLOWS an out-of-allow-list role; the strict
// helper denies it. Mocking both faithfully is what makes this test meaningful.
const ROLES: Record<string, readonly string[]> = {
  "crm.manage": ["SUPER_ADMIN", "OPERATIONS_ADMIN"],
  "comms.bulk_send": ["SUPER_ADMIN", "OPERATIONS_ADMIN"],
};

mock.module("@/lib/auth/permissions", {
  namedExports: {
    requirePermissionActor: async () => ({
      adminId: "admin_1",
      adminEmail: "caller@autolenis.com",
    }),
    requirePermissionActorStrict: async (permission: string) =>
      ROLES[permission]?.includes(callerRole)
        ? { ok: true, actor: { adminId: "admin_1", adminEmail: "caller@autolenis.com" } }
        : { ok: false, status: 403 },
  },
});

async function loadPOST() {
  const mod = await import("@/app/api/admin/crm/campaigns/route");
  return mod.POST;
}

function req(body: unknown) {
  return new Request("http://localhost/api/admin/crm/campaigns", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const BASE = { name: "Blast", type: "sms", segment_id: "seg_1", sms_body: "hi" };
const UNDER_PRIVILEGED = ["SUPPORT_ADMIN", "COMPLIANCE_ADMIN", "FINANCE_ADMIN"] as const;

beforeEach(() => {
  callerRole = "OPERATIONS_ADMIN";
  createCalls = 0;
  scheduleUpdates = 0;
});

// ── Vector 1: send_immediately ───────────────────────────────────────────────
for (const role of UNDER_PRIVILEGED) {
  test(`send_immediately: ${role} → 403 and NO campaign is created`, async () => {
    callerRole = role;

    const POST = await loadPOST();
    const res = await POST(req({ ...BASE, send_immediately: true }));

    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "FORBIDDEN");
    assert.equal(createCalls, 0, `${role} must not create a sending campaign`);
    assert.equal(scheduleUpdates, 0, "must never reach the schedule stamp");
  });
}

// ── Vector 2: scheduled_at (the path a send_immediately-only fix would miss) ──
for (const role of UNDER_PRIVILEGED) {
  test(`scheduled_at: ${role} → 403 and NO campaign is created`, async () => {
    callerRole = role;

    const POST = await loadPOST();
    // createCampaign turns any scheduled_at into status='scheduled', which the
    // dispatch cron fans out once scheduled_at <= now.
    const res = await POST(req({ ...BASE, scheduled_at: "2020-01-01T00:00:00.000Z" }));

    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "FORBIDDEN");
    assert.equal(createCalls, 0, `${role} must not schedule a sending campaign`);
  });
}

// ── The authorized roles keep working ────────────────────────────────────────
for (const role of ["SUPER_ADMIN", "OPERATIONS_ADMIN"] as const) {
  test(`send_immediately: ${role} still creates and schedules (no regression)`, async () => {
    callerRole = role;

    const POST = await loadPOST();
    const res = await POST(req({ ...BASE, send_immediately: true }));

    assert.equal(res.status, 201);
    assert.equal(createCalls, 1);
    assert.equal(scheduleUpdates, 1, "send_immediately must still stamp the schedule");
  });

  test(`scheduled_at: ${role} still creates the scheduled campaign (no regression)`, async () => {
    callerRole = role;

    const POST = await loadPOST();
    const res = await POST(req({ ...BASE, scheduled_at: "2099-01-01T00:00:00.000Z" }));

    assert.equal(res.status, 201);
    assert.equal(createCalls, 1);
    // createCampaign owns the scheduled status here; the route must not re-stamp.
    assert.equal(scheduleUpdates, 0);
  });
}

// ── Draft creation is deliberately unchanged ─────────────────────────────────
test("pure draft keeps the existing crm.manage gate (no send path, not hardened)", async () => {
  callerRole = "SUPPORT_ADMIN"; // shadow-allowed today, by design

  const POST = await loadPOST();
  const res = await POST(req(BASE));

  assert.equal(res.status, 201, "draft creation must not regress for CRM users");
  assert.equal(createCalls, 1);
  assert.equal(scheduleUpdates, 0, "a draft must never be stamped as scheduled");
});
