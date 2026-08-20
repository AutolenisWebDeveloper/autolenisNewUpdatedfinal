// lib/services/financing/compliance-rule.service.ts
//
// Phase 5 Block 1 — compliance rule-injection layer. THE HARD RULE: no regulatory
// content lives in code. Every regulated point (adverse-action triggers + notice
// text, TILA disclosures, FCRA consent/retention, fair-lending boundaries) is a
// ComplianceRule row — EMPTY BY DEFAULT — injected later from a qualified
// compliance source. This module resolves the ACTIVE rule for a type and, when
// none is populated, FAILS CLOSED: the caller must not render the decision or send
// the notice. Fail-closed events are recorded on the tamper-evident audit trail.

import { prisma } from "@/lib/prisma";
import type { ComplianceRule, ComplianceRuleType } from "@prisma/client";
import { appendFinancingAuditEvent } from "./financing-audit.service";

export type RuleResolution =
  | { ok: true; rule: ComplianceRule }
  | { ok: false; reason: "RULE_ABSENT"; ruleType: ComplianceRuleType };

/** The highest ACTIVE version for a rule type, or null. */
export async function getActiveRule(ruleType: ComplianceRuleType): Promise<ComplianceRule | null> {
  return prisma.complianceRule.findFirst({
    where: { ruleType, status: "ACTIVE" },
    orderBy: { version: "desc" },
  });
}

/**
 * A rule is usable only if it actually carries injected content — either a
 * non-empty `content` object or a non-blank `templateBody`. An ACTIVE row whose
 * slots are still empty is treated as absent (the engine must not run on a shell).
 */
export function isRulePopulated(rule: ComplianceRule | null): boolean {
  if (!rule) return false;
  // Injected rule content is always a non-empty object/array (a structured rule
  // set) or a non-blank template body. A bare JSON primitive is NOT a valid rule
  // payload and deliberately fails closed (safe direction) — flagged explicitly so
  // the fail-closed is a decision, not an accident.
  const content = rule.content as unknown;
  const contentPopulated =
    content != null && typeof content === "object" && Object.keys(content as object).length > 0;
  const templatePopulated = typeof rule.templateBody === "string" && rule.templateBody.trim().length > 0;
  return contentPopulated || templatePopulated;
}

/** Resolve the ACTIVE populated rule, or fail closed with a typed reason. */
export async function requireActiveRule(ruleType: ComplianceRuleType): Promise<RuleResolution> {
  const rule = await getActiveRule(ruleType);
  if (!isRulePopulated(rule)) {
    return { ok: false, reason: "RULE_ABSENT", ruleType };
  }
  return { ok: true, rule: rule as ComplianceRule };
}

export interface RuleGuardContext {
  creditApplicationId?: string | null;
  dealId?: string | null;
  buyerId?: string | null;
  actorType?: "SYSTEM" | "ADMIN" | "BUYER" | "LENDER";
  actorId?: string | null;
}

/**
 * The decisioning/notice engine's guard: resolve the required rule, and when it is
 * absent, record a RULE_ABSENT_FAIL_CLOSED event on the tamper-evident trail
 * before returning the fail-closed result. Callers MUST NOT proceed on {ok:false}
 * — they block the decision/notice and route to human review (Block 4).
 */
export async function requireRuleOrFailClosed(
  ruleType: ComplianceRuleType,
  ctx: RuleGuardContext = {},
): Promise<RuleResolution> {
  const res = await requireActiveRule(ruleType);
  if (!res.ok) {
    await appendFinancingAuditEvent({
      eventType: "RULE_ABSENT_FAIL_CLOSED",
      actorType: ctx.actorType ?? "SYSTEM",
      actorId: ctx.actorId ?? null,
      creditApplicationId: ctx.creditApplicationId ?? null,
      dealId: ctx.dealId ?? null,
      buyerId: ctx.buyerId ?? null,
      payload: { ruleType, reason: "RULE_ABSENT", blocked: true },
    });
  }
  return res;
}
