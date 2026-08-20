// lib/services/financing/credit-application.service.ts
//
// Phase 5 Block 3 — the CreditApplication guarded state machine + encrypted PII.
// This is the "financing states" machine (verify-first decision: a new sub-machine
// inside the Deal's FINANCING_PENDING window, NOT new DealStatus values). It mirrors
// the Deal `canTransition`/CAS idiom exactly: illegal transitions are rejected, and
// every forward move is a compare-and-swap on (id, expectedStatus) so concurrent
// transitions cannot both win. PII is encrypted at rest on create — never plaintext.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { CreditApplication, CreditApplicationStatus, FinancingPath } from "@prisma/client";
import { encryptOptionalField } from "@/lib/security/field-encryption";
import { appendFinancingAuditEvent } from "./financing-audit.service";

// The only legal moves. Terminals (APPROVED, WITHDRAWN) have no outgoing edges.
const CA_TRANSITIONS: Record<CreditApplicationStatus, CreditApplicationStatus[]> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["PENDING_LENDER", "HUMAN_REVIEW", "WITHDRAWN"],
  PENDING_LENDER: ["CONDITIONAL", "APPROVED", "DECLINED", "HUMAN_REVIEW"],
  CONDITIONAL: ["APPROVED", "DECLINED", "HUMAN_REVIEW"],
  APPROVED: [],
  DECLINED: ["ADVERSE_ACTION_PENDING"],
  ADVERSE_ACTION_PENDING: ["HUMAN_REVIEW"],
  HUMAN_REVIEW: ["APPROVED", "DECLINED", "CONDITIONAL", "ADVERSE_ACTION_PENDING", "WITHDRAWN"],
  WITHDRAWN: [],
};

export function canTransitionApplication(from: CreditApplicationStatus, to: CreditApplicationStatus): boolean {
  if (from === to) return false;
  return CA_TRANSITIONS[from]?.includes(to) ?? false;
}

export class CreditApplicationTransitionError extends Error {
  constructor(from: CreditApplicationStatus, to: CreditApplicationStatus) {
    super(`Invalid credit application transition: ${from} → ${to}`);
    this.name = "CreditApplicationTransitionError";
  }
}

export class CreditApplicationConcurrencyError extends Error {
  constructor(id: string, from: CreditApplicationStatus, to: CreditApplicationStatus) {
    super(`Concurrency conflict advancing ${id} ${from}→${to}: 0 rows matched the compare-and-swap`);
    this.name = "CreditApplicationConcurrencyError";
  }
}

export interface CreateCreditApplicationInput {
  dealId: string;
  buyerId: string;
  financingPath?: FinancingPath;
  amountRequestedCents?: number;
  termMonths?: number;
  // Plaintext PII inputs — encrypted before storage, never persisted raw.
  ssn?: string;
  annualIncomeCents?: number;
  employment?: string;
  dob?: string;
}

export async function createCreditApplication(input: CreateCreditApplicationInput): Promise<CreditApplication> {
  return prisma.creditApplication.create({
    data: {
      dealId: input.dealId,
      buyerId: input.buyerId,
      status: "DRAFT",
      financingPath: input.financingPath ?? "DEALER",
      amountRequestedCents: input.amountRequestedCents ?? null,
      termMonths: input.termMonths ?? null,
      ssnEncrypted: encryptOptionalField(input.ssn),
      annualIncomeEncrypted: encryptOptionalField(input.annualIncomeCents != null ? String(input.annualIncomeCents) : null),
      employmentEncrypted: encryptOptionalField(input.employment),
      dobEncrypted: encryptOptionalField(input.dob),
    },
  });
}

export interface AdvanceApplicationOpts {
  actorType?: "SYSTEM" | "ADMIN" | "BUYER" | "LENDER";
  actorId?: string | null;
  reason?: string;
  /** Extra columns written atomically with the status transition (non-PII). */
  data?: Prisma.CreditApplicationUpdateManyMutationInput;
  force?: boolean;
}

/**
 * The ONLY sanctioned way to move a credit application forward. Rejects illegal
 * transitions before any write, then performs a compare-and-swap on
 * (id, expectedStatus) — only the caller who still sees the pre-image wins, so two
 * concurrent transitions cannot both apply. Records a STATE_TRANSITION audit event.
 */
export async function advanceApplication(
  appId: string,
  to: CreditApplicationStatus,
  opts: AdvanceApplicationOpts = {},
): Promise<void> {
  const app = await prisma.creditApplication.findUnique({ where: { id: appId } });
  if (!app) throw new Error(`credit application ${appId} not found`);
  const from = app.status;
  if (from === to) return;
  if (!opts.force && !canTransitionApplication(from, to)) {
    throw new CreditApplicationTransitionError(from, to);
  }

  const res = await prisma.creditApplication.updateMany({
    where: { id: appId, status: from },
    data: { status: to, ...(opts.data ?? {}) },
  });
  if (res.count !== 1) throw new CreditApplicationConcurrencyError(appId, from, to);

  await appendFinancingAuditEvent({
    eventType: "STATE_TRANSITION",
    actorType: opts.actorType ?? "SYSTEM",
    actorId: opts.actorId ?? null,
    creditApplicationId: appId,
    dealId: app.dealId,
    buyerId: app.buyerId,
    payload: { from, to, reason: opts.reason ?? null },
  });
}
