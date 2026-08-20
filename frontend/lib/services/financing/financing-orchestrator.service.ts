// lib/services/financing/financing-orchestrator.service.ts
//
// Phase 5 Block 3 — the decisioning orchestrator. Ties the rule layer (B1), the
// audit trail (B1), the lender adapter (B2), the CreditApplication machine (B3),
// and the EXISTING Deal machine + Financing outcome together. It never invents a
// decision or a notice: the lender decides; the ECOA adverse-action notice comes
// from an injected ComplianceRule, and when that rule is absent the decline FAILS
// CLOSED to human review (no notice generated/sent).

import { prisma } from "@/lib/prisma";
import { decryptOptionalField } from "@/lib/security/field-encryption";
import { advanceApplication } from "./credit-application.service";
import { getLenderAdapter, submitCreditApplication } from "./lender/lender-service";
import type { CreditApplicationSubmission } from "./lender/types";
import { requireRuleOrFailClosed } from "./compliance-rule.service";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { appendFinancingAuditEvent } from "./financing-audit.service";
import { routeToReview } from "./review-queue.service";

export interface LenderDecisionResult {
  applicationId: string;
  finalStatus: string;
  decisionOutcome?: string;
  dealAdvanced: boolean;
  adverseAction?: "PENDING" | "BLOCKED_RULE_ABSENT";
}

/**
 * Drive a SUBMITTED application to a decision. SUBMITTED → PENDING_LENDER → call the
 * lender → apply the outcome. Fail-closed everywhere: adapter failure or a
 * decline-without-an-injected-notice both route to human review rather than guessing.
 */
export async function requestLenderDecision(
  appId: string,
  opts: { adapterName?: string } = {},
): Promise<LenderDecisionResult> {
  const app = await prisma.creditApplication.findUnique({ where: { id: appId } });
  if (!app) throw new Error(`credit application ${appId} not found`);
  if (app.status !== "SUBMITTED") {
    throw new Error(`credit application ${appId} must be SUBMITTED to request a decision (is ${app.status})`);
  }
  const ctx = { creditApplicationId: app.id, dealId: app.dealId, buyerId: app.buyerId };

  await advanceApplication(appId, "PENDING_LENDER", { actorType: "SYSTEM", reason: "sent to lender" });

  // Decrypt PII in-memory only for the lender call — never persisted/logged raw.
  const submission: CreditApplicationSubmission = {
    applicationId: app.id,
    amountRequestedCents: app.amountRequestedCents ?? 0,
    termMonths: app.termMonths ?? 0,
    vehicle: { priceCents: app.amountRequestedCents ?? 0 },
    applicant: {
      ssn: decryptOptionalField(app.ssnEncrypted) ?? undefined,
      annualIncomeCents: app.annualIncomeEncrypted ? Number(decryptOptionalField(app.annualIncomeEncrypted)) : undefined,
    },
  };

  const adapter = getLenderAdapter(opts.adapterName);
  const result = await submitCreditApplication(adapter, submission, ctx);

  if (!result.ok) {
    await advanceApplication(appId, "HUMAN_REVIEW", { actorType: "SYSTEM", reason: `lender call failed: ${result.error.code}` });
    await routeToReview({ ...ctx, taskType: "LENDER_FAILURE_REVIEW", reason: `lender call failed: ${result.error.code}` });
    return { applicationId: appId, finalStatus: "HUMAN_REVIEW", dealAdvanced: false };
  }

  const decision = result.decision;
  await appendFinancingAuditEvent({
    eventType: "DECISION_RENDERED",
    actorType: "LENDER",
    ...ctx,
    payload: {
      outcome: decision.outcome,
      lenderReferenceId: decision.lenderReferenceId ?? null,
      approvedAmountCents: decision.approvedAmountCents ?? null,
      aprRate: decision.aprRate ?? null,
    },
  });

  const decisionData = {
    lenderName: adapter.name,
    lenderReferenceId: decision.lenderReferenceId ?? null,
    decisionOutcome: decision.outcome,
    approvedAmountCents: decision.approvedAmountCents ?? null,
    aprRate: decision.aprRate ?? null,
    monthlyPaymentCents: decision.monthlyPaymentCents ?? null,
    stipulations: (decision.stipulations ?? undefined) as object | undefined,
    declineReasonCodes: (decision.declineReasonCodes ?? undefined) as object | undefined,
    decidedAt: new Date(),
  };

  switch (decision.outcome) {
    case "APPROVED": {
      await advanceApplication(appId, "APPROVED", { actorType: "SYSTEM", data: decisionData });
      // Update the EXISTING Financing outcome (one-per-deal), never a parallel model.
      await prisma.financing.upsert({
        where: { dealId: app.dealId },
        create: {
          dealId: app.dealId,
          path: app.financingPath,
          status: "APPROVED",
          lenderName: adapter.name,
          approvedAmountCents: decision.approvedAmountCents ?? null,
          aprRate: decision.aprRate ?? null,
          termMonths: decision.termMonths ?? null,
          monthlyPaymentCents: decision.monthlyPaymentCents ?? null,
        },
        update: {
          status: "APPROVED",
          lenderName: adapter.name,
          approvedAmountCents: decision.approvedAmountCents ?? null,
          aprRate: decision.aprRate ?? null,
          termMonths: decision.termMonths ?? null,
          monthlyPaymentCents: decision.monthlyPaymentCents ?? null,
        },
      });
      // Advance the Deal through the EXISTING guarded machine (FINANCING_PENDING →
      // FEE_PENDING). The financing approval is already durable; if the downstream
      // deal advance fails (e.g. the deal is not in the expected state), don't throw
      // and undo it — record the gap for reconciliation and report dealAdvanced:false.
      let dealAdvanced = false;
      try {
        await advanceDealStatus(app.dealId, "FEE_PENDING", { actorRole: "SYSTEM", reason: "financing approved" });
        dealAdvanced = true;
      } catch (e) {
        await appendFinancingAuditEvent({
          eventType: "STATE_TRANSITION",
          actorType: "SYSTEM",
          ...ctx,
          payload: { dealAdvanceFailed: true, error: e instanceof Error ? e.message : String(e), note: "financing APPROVED but deal advance failed — needs reconciliation" },
        });
      }
      return { applicationId: appId, finalStatus: "APPROVED", decisionOutcome: "APPROVED", dealAdvanced };
    }
    case "CONDITIONAL": {
      await advanceApplication(appId, "CONDITIONAL", { actorType: "SYSTEM", data: decisionData });
      await routeToReview({ ...ctx, taskType: "STIP_REVIEW", reason: "conditional approval — clear stipulations" });
      return { applicationId: appId, finalStatus: "CONDITIONAL", decisionOutcome: "CONDITIONAL", dealAdvanced: false };
    }
    case "DECLINED": {
      await advanceApplication(appId, "DECLINED", { actorType: "SYSTEM", data: decisionData });
      await advanceApplication(appId, "ADVERSE_ACTION_PENDING", { actorType: "SYSTEM", reason: "decline requires adverse-action notice" });
      // ECOA notice content is a ComplianceRule — EMPTY BY DEFAULT. Resolve it; when
      // absent, FAIL CLOSED (no invented notice), route to human review.
      const rule = await requireRuleOrFailClosed("ADVERSE_ACTION_NOTICE", { ...ctx, actorType: "SYSTEM" });
      if (!rule.ok) {
        await advanceApplication(appId, "HUMAN_REVIEW", { actorType: "SYSTEM", reason: "adverse-action notice rule absent (fail-closed)" });
        await routeToReview({ ...ctx, taskType: "ADVERSE_ACTION_REVIEW", reason: "decline needs an ECOA adverse-action notice, but no rule is injected (fail-closed)" });
        return { applicationId: appId, finalStatus: "HUMAN_REVIEW", decisionOutcome: "DECLINED", dealAdvanced: false, adverseAction: "BLOCKED_RULE_ABSENT" };
      }
      // Rule present → the notice is rendered from the injected template (Block 4/5
      // notice engine). No content is invented here.
      return { applicationId: appId, finalStatus: "ADVERSE_ACTION_PENDING", decisionOutcome: "DECLINED", dealAdvanced: false, adverseAction: "PENDING" };
    }
    default: {
      await advanceApplication(appId, "HUMAN_REVIEW", { actorType: "SYSTEM", reason: `lender outcome ${decision.outcome} needs human review` });
      await routeToReview({ ...ctx, taskType: "MANUAL_DECISION_REVIEW", reason: `lender outcome ${decision.outcome} needs human review` });
      return { applicationId: appId, finalStatus: "HUMAN_REVIEW", decisionOutcome: decision.outcome, dealAdvanced: false };
    }
  }
}
