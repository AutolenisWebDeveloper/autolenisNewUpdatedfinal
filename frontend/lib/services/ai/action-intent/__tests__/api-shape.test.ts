// Server-side response shaping. The admin API must expose only a whitelisted
// view — never the raw record — so a future column addition cannot leak by
// default, and no unexpected/secret field is returned.
//
//   npx tsx --test lib/services/ai/action-intent/__tests__/api-shape.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { shapeIntentForAdmin } from "../api-shape";
import type { ActionIntentRecord } from "../types";

function record(over: Partial<ActionIntentRecord> = {}): ActionIntentRecord {
  return {
    id: "ai-1",
    intentType: "admin.trigger_deposit_refund",
    status: "APPROVAL_REQUIRED",
    actorType: "ADMIN",
    actorId: "admin-1",
    authenticatedRole: "OPERATIONS_ADMIN",
    parameters: { depositId: "dep1", reason: "dup" },
    consequence: "CONSEQUENTIAL",
    requiresHumanApproval: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

test("shape returns ONLY the whitelisted keys (no raw-record spread)", () => {
  const view = shapeIntentForAdmin(record());
  const allowed = new Set([
    "id", "intentType", "status", "consequence", "requiresHumanApproval",
    "actorType", "actorId", "subjectId", "parameters", "rationale",
    "approverId", "approverRole", "rejectionCode", "failureReason", "result",
    "createdAt", "updatedAt",
  ]);
  for (const k of Object.keys(view)) {
    assert.ok(allowed.has(k), `unexpected exposed key: ${k}`);
  }
});

test("a secret-looking field injected onto the record is NOT surfaced", () => {
  const rec = record();
  // Simulate a future column / accidental field.
  (rec as unknown as Record<string, unknown>).internalSecretToken = "sk_live_should_never_leak";
  const view = shapeIntentForAdmin(rec) as unknown as Record<string, unknown>;
  assert.equal(view.internalSecretToken, undefined);
  assert.ok(!JSON.stringify(view).includes("sk_live_should_never_leak"));
});

test("timestamps are serialized as ISO strings", () => {
  const view = shapeIntentForAdmin(record());
  assert.equal(view.createdAt, "2026-01-01T00:00:00.000Z");
});
