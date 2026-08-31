// Unit tests for the acquisition communication orchestrator's pure core.
// Run with:  npx tsx --test lib/services/notifications/__tests__/acquisition-comms.test.ts
//
// These prove the event→plan mapping is total and correct, that the event-level
// idempotency key is stable and collision-free across transitions, and that
// channel eligibility honors both buyer preference and the SMS feature flag
// (without ever implying the TCPA/suppression gate can be bypassed — that lives
// in sendCrmSms and is not exercised here).

import test from "node:test";
import assert from "node:assert/strict";
import {
  dealStatusCommsPlan,
  dealCommsIdempotencyKey,
  resolveChannels,
  isInAppOwnedByCaller,
  INAPP_OWNED_BY_CALLERS,
  type DealCommPlan,
} from "../acquisition-comms";
import { DealStatus, NotificationType } from "@prisma/client";

const ALL_STATUSES = Object.values(DealStatus) as DealStatus[];
const VALID_TYPES = new Set(Object.values(NotificationType));

test("dealStatusCommsPlan is total over DealStatus (never throws)", () => {
  for (const s of ALL_STATUSES) {
    assert.doesNotThrow(() => dealStatusCommsPlan(s), `plan for ${s} threw`);
  }
});

test("pre-financing internal states carry no buyer message", () => {
  assert.equal(dealStatusCommsPlan("PENDING"), null);
  assert.equal(dealStatusCommsPlan("ACTIVE"), null);
});

test("every non-null plan uses a real NotificationType and a buyer deep-link", () => {
  for (const s of ALL_STATUSES) {
    const plan = dealStatusCommsPlan(s);
    if (!plan) continue;
    assert.ok(VALID_TYPES.has(plan.type), `${s} → invalid NotificationType ${plan.type}`);
    assert.ok(plan.title.trim().length > 0, `${s} → empty title`);
    assert.ok(plan.body.trim().length > 0, `${s} → empty body`);
    assert.ok(plan.actionUrl.startsWith("/buyer/"), `${s} → non-buyer actionUrl ${plan.actionUrl}`);
  }
});

test("action-required transitions prompt the customer to act and are SMS-worthy", () => {
  // These are the moments where the customer must do something next.
  const mustAct: DealStatus[] = [
    "FINANCING_PENDING",
    "FEE_PENDING",
    "INSURANCE_PENDING",
    "SIGNING_PENDING",
    "PICKUP_SCHEDULED",
  ];
  for (const s of mustAct) {
    const plan = dealStatusCommsPlan(s)!;
    assert.equal(plan.actionRequired, true, `${s} should require action`);
    assert.notEqual(plan.sms, null, `${s} should have an SMS body`);
  }
});

test("informational transitions do not over-text the customer", () => {
  // Purely informational states must not carry an SMS (keeps texting to useful
  // moments and avoids two texts back-to-back around signing).
  const infoNoSms: DealStatus[] = [
    "FEE_PAID",
    "CONTRACT_PENDING",
    "CONTRACT_REVIEW",
    "CONTRACT_APPROVED",
    "SIGNED",
    "PICKUP_COMPLETE",
  ];
  for (const s of infoNoSms) {
    const plan = dealStatusCommsPlan(s)!;
    assert.equal(plan.actionRequired, false, `${s} should not require action`);
    assert.equal(plan.sms, null, `${s} should not send an SMS`);
  }
});

test("terminal transitions notify the customer (incl. SMS)", () => {
  const completed = dealStatusCommsPlan("COMPLETED")!;
  assert.notEqual(completed.sms, null);
  const cancelled = dealStatusCommsPlan("CANCELLED")!;
  assert.notEqual(cancelled.sms, null);
  const refunded = dealStatusCommsPlan("REFUNDED")!;
  assert.notEqual(refunded.sms, null);
});

test("key lifecycle transitions map to their dedicated NotificationType + deep-link", () => {
  assert.equal(dealStatusCommsPlan("SIGNING_PENDING")!.type, NotificationType.SIGNING_READY);
  assert.equal(dealStatusCommsPlan("SIGNING_PENDING")!.actionUrl, "/buyer/esign");
  assert.equal(dealStatusCommsPlan("PICKUP_SCHEDULED")!.type, NotificationType.PICKUP_SCHEDULED);
  assert.equal(dealStatusCommsPlan("PICKUP_SCHEDULED")!.actionUrl, "/buyer/pickup");
  assert.equal(dealStatusCommsPlan("CONTRACT_APPROVED")!.type, NotificationType.CONTRACT_APPROVED);
  assert.equal(dealStatusCommsPlan("INSURANCE_PENDING")!.actionUrl, "/buyer/insurance");
  assert.equal(dealStatusCommsPlan("FEE_PAID")!.type, NotificationType.FEE_PAID);
});

test("idempotency key is stable and includes all identity components", () => {
  const k = dealCommsIdempotencyKey("deal-1", "SIGNING_PENDING", "buyer-9");
  assert.equal(k, dealCommsIdempotencyKey("deal-1", "SIGNING_PENDING", "buyer-9"));
  assert.match(k, /deal-1/);
  assert.match(k, /SIGNING_PENDING/);
  assert.match(k, /buyer-9/);
});

test("idempotency key is unique per (deal, status, buyer) tuple", () => {
  const keys = new Set<string>();
  for (const dealId of ["d1", "d2"]) {
    for (const s of ALL_STATUSES) {
      for (const buyerId of ["b1", "b2"]) {
        keys.add(dealCommsIdempotencyKey(dealId, s, buyerId));
      }
    }
  }
  // 2 deals × 16 statuses × 2 buyers = 64 distinct keys, no collisions.
  assert.equal(keys.size, 2 * ALL_STATUSES.length * 2);
});

test("resolveChannels honors the in-app preference", () => {
  const smsPlan = dealStatusCommsPlan("SIGNING_PENDING")!;
  assert.deepEqual(
    resolveChannels({ plan: smsPlan, inAppEnabled: true, smsFeatureEnabled: false }),
    { inApp: true, sms: false },
  );
  assert.deepEqual(
    resolveChannels({ plan: smsPlan, inAppEnabled: false, smsFeatureEnabled: false }),
    { inApp: false, sms: false },
  );
});

test("resolveChannels only allows SMS when the flag is on AND the plan has an SMS body", () => {
  const smsPlan = dealStatusCommsPlan("SIGNING_PENDING")!;
  const noSmsPlan = dealStatusCommsPlan("FEE_PAID")!;

  // Flag on + SMS body present → SMS candidate.
  assert.equal(resolveChannels({ plan: smsPlan, inAppEnabled: true, smsFeatureEnabled: true }).sms, true);
  // Flag on but plan has no SMS body → no SMS.
  assert.equal(resolveChannels({ plan: noSmsPlan, inAppEnabled: true, smsFeatureEnabled: true }).sms, false);
  // Flag off → never SMS, regardless of plan.
  assert.equal(resolveChannels({ plan: smsPlan, inAppEnabled: true, smsFeatureEnabled: false }).sms, false);
});

test("caller-owned in-app statuses are exactly the five verified duplicates", () => {
  // SIGNED was removed from this set. It was listed as caller-owned on the basis
  // that esign.service created the notification, but that DocuSign-era handler was
  // deleted and the ownership entry outlived it — so the orchestrator skipped
  // SIGNED and NOTHING created a notification. With sms:null on the SIGNED plan the
  // buyer got no signal at all at the moment their contract became binding. This
  // assertion previously pinned that bug in place; it now pins the fix.
  assert.deepEqual(
    [...INAPP_OWNED_BY_CALLERS].sort(),
    ["CANCELLED", "COMPLETED", "CONTRACT_APPROVED", "PICKUP_SCHEDULED", "REFUNDED"].sort(),
  );
  for (const s of INAPP_OWNED_BY_CALLERS) {
    assert.equal(isInAppOwnedByCaller(s), true, `${s} should be caller-owned`);
  }
});

test("genuinely-silent transitions are owned by the orchestrator's in-app channel", () => {
  // These previously had no buyer in-app notification — the orchestrator fills them.
  const orchestratorOwned: DealStatus[] = [
    "FINANCING_PENDING",
    "FEE_PENDING",
    "FEE_PAID",
    "INSURANCE_PENDING",
    "CONTRACT_PENDING",
    "CONTRACT_REVIEW",
    "SIGNING_PENDING",
    "PICKUP_COMPLETE",
  ];
  for (const s of orchestratorOwned) {
    assert.equal(isInAppOwnedByCaller(s), false, `${s} should be orchestrator-owned`);
  }
});

test("caller-owned statuses still receive SMS candidacy where action is required", () => {
  // Skipping in-app for a caller-owned status must NOT suppress its SMS — SMS is
  // a channel the lifecycle otherwise lacks entirely.
  const pickup = dealStatusCommsPlan("PICKUP_SCHEDULED")!;
  assert.equal(isInAppOwnedByCaller("PICKUP_SCHEDULED"), true);
  assert.notEqual(pickup.sms, null);
  assert.equal(resolveChannels({ plan: pickup, inAppEnabled: false, smsFeatureEnabled: true }).sms, true);
});

test("a plan's SMS body excludes the URL and opt-out disclosure (added downstream)", () => {
  // The dispatcher appends the deep-link URL and sendCrmSms appends the STOP
  // disclosure — the plan text must contain neither, to avoid duplication.
  for (const s of ALL_STATUSES) {
    const plan: DealCommPlan | null = dealStatusCommsPlan(s);
    if (!plan?.sms) continue;
    assert.doesNotMatch(plan.sms, /https?:\/\//, `${s} SMS body should not embed a URL`);
    assert.doesNotMatch(plan.sms, /reply stop/i, `${s} SMS body should not embed the STOP disclosure`);
  }
});
