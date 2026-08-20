// Phase 5 Block 1 — compliance rule-injection layer. THE HARD RULE: no regulatory
// content lives in code. Every regulated point is a ComplianceRule row that is
// EMPTY BY DEFAULT. The engine enforces whatever it is given; when no ACTIVE,
// populated rule exists for a type, callers FAIL CLOSED (no decision / no notice)
// and the fail-closed event is written to the tamper-evident audit trail.
//
// Run: pnpm test:financing

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const state = {
  rules: [] as Array<Record<string, unknown>>,
  auditCreated: [] as Array<Record<string, unknown>>,
  auditTail: null as { sequence: number; hash: string } | null,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      complianceRule: {
        findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: unknown }) => {
          void orderBy;
          const matches = state.rules.filter(
            (r) => r.ruleType === where.ruleType && (where.status ? r.status === where.status : true),
          );
          matches.sort((a, b) => Number(b.version) - Number(a.version));
          return matches[0] ?? null;
        },
      },
      financingAuditEvent: {
        findFirst: async () => state.auditTail,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.auditCreated.push(data);
          return { id: "evt", ...data };
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        // The service uses prisma.$transaction(fn); pass the same mocked prisma in.
        const { prisma } = await import("@/lib/prisma");
        return fn(prisma);
      },
    },
  },
});

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule_1",
    ruleType: "ADVERSE_ACTION_NOTICE",
    version: 1,
    status: "ACTIVE",
    content: { reasonCodes: ["A"] },
    templateBody: "You were declined for {{reason}}.",
    ...overrides,
  };
}

beforeEach(() => {
  state.rules = [];
  state.auditCreated = [];
  state.auditTail = null;
});

test("getActiveRule returns the highest ACTIVE version, ignoring DRAFT/RETIRED", async () => {
  const { getActiveRule } = await import("@/lib/services/financing/compliance-rule.service");
  state.rules = [
    rule({ id: "v1", version: 1, status: "RETIRED" }),
    rule({ id: "v2", version: 2, status: "ACTIVE" }),
    rule({ id: "v3", version: 3, status: "DRAFT" }),
  ];
  const r = await getActiveRule("ADVERSE_ACTION_NOTICE" as never);
  assert.equal(r?.id, "v2", "picks the highest ACTIVE version, not the DRAFT");
});

test("isRulePopulated: empty content AND empty template ⇒ NOT populated (fail closed)", async () => {
  const { isRulePopulated } = await import("@/lib/services/financing/compliance-rule.service");
  assert.equal(isRulePopulated(null), false);
  assert.equal(isRulePopulated(rule({ content: null, templateBody: null }) as never), false);
  assert.equal(isRulePopulated(rule({ content: {}, templateBody: "   " }) as never), false, "blank template + {} content is empty");
  assert.equal(isRulePopulated(rule({ content: { x: 1 }, templateBody: null }) as never), true);
  assert.equal(isRulePopulated(rule({ content: null, templateBody: "real text" }) as never), true);
});

test("requireActiveRule ⇒ ok when an ACTIVE populated rule exists", async () => {
  const { requireActiveRule } = await import("@/lib/services/financing/compliance-rule.service");
  state.rules = [rule()];
  const res = await requireActiveRule("ADVERSE_ACTION_NOTICE" as never);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.rule.id, "rule_1");
});

test("requireActiveRule ⇒ FAIL CLOSED when no rule exists (empty by default)", async () => {
  const { requireActiveRule } = await import("@/lib/services/financing/compliance-rule.service");
  state.rules = []; // nothing injected yet
  const res = await requireActiveRule("TILA_DISCLOSURE" as never);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, "RULE_ABSENT");
    assert.equal(res.ruleType, "TILA_DISCLOSURE");
  }
});

test("requireActiveRule ⇒ FAIL CLOSED when a rule is ACTIVE but its content is still empty", async () => {
  const { requireActiveRule } = await import("@/lib/services/financing/compliance-rule.service");
  state.rules = [rule({ content: null, templateBody: null, status: "ACTIVE" })];
  const res = await requireActiveRule("ADVERSE_ACTION_NOTICE" as never);
  assert.equal(res.ok, false, "an ACTIVE but empty rule must not be treated as usable");
});

test("requireRuleOrFailClosed writes a RULE_ABSENT_FAIL_CLOSED audit event on absence", async () => {
  const { requireRuleOrFailClosed } = await import("@/lib/services/financing/compliance-rule.service");
  state.rules = [];
  const res = await requireRuleOrFailClosed("ADVERSE_ACTION_TRIGGER" as never, {
    creditApplicationId: "app_1",
    dealId: "deal_1",
    buyerId: "buyer_1",
  });
  assert.equal(res.ok, false);
  assert.equal(state.auditCreated.length, 1, "the fail-closed event is recorded");
  assert.equal(state.auditCreated[0]!.eventType, "RULE_ABSENT_FAIL_CLOSED");
  assert.equal(state.auditCreated[0]!.creditApplicationId, "app_1");
  assert.match(String((state.auditCreated[0]!.payload as { ruleType: string }).ruleType), /ADVERSE_ACTION_TRIGGER/);
});

test("requireRuleOrFailClosed writes NO audit event when the rule is present (no false alarm)", async () => {
  const { requireRuleOrFailClosed } = await import("@/lib/services/financing/compliance-rule.service");
  state.rules = [rule()];
  const res = await requireRuleOrFailClosed("ADVERSE_ACTION_NOTICE" as never, { dealId: "deal_1" });
  assert.equal(res.ok, true);
  assert.equal(state.auditCreated.length, 0);
});
