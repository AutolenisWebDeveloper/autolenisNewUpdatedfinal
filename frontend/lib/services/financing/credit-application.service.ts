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

// Terminals may NEVER be left — not even with force. This bounds a human override:
// an admin can drive a parked app to a decision, but cannot resurrect an APPROVED
// or WITHDRAWN application.
export const CA_TERMINAL: CreditApplicationStatus[] = ["APPROVED", "WITHDRAWN"];

export function canTransitionApplication(from: CreditApplicationStatus, to: CreditApplicationStatus): boolean {
  if (from === to) return false;
  if (CA_TERMINAL.includes(from)) return false;
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

/** A non-withdrawn application already exists for this deal (idempotency guard). */
export class DuplicateApplicationError extends Error {
  constructor(dealId: string) {
    super(`A non-withdrawn credit application already exists for deal ${dealId}`);
    this.name = "DuplicateApplicationError";
  }
}

// Buyer-safe projection: the encrypted PII columns are NEVER selected into an
// object that could reach a client. Anything read for a buyer surface uses this.
const PUBLIC_APPLICATION_SELECT = {
  id: true,
  dealId: true,
  buyerId: true,
  status: true,
  financingPath: true,
  amountRequestedCents: true,
  termMonths: true,
  lenderName: true,
  decisionOutcome: true,
  approvedAmountCents: true,
  aprRate: true,
  monthlyPaymentCents: true,
  submittedAt: true,
  decidedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CreditApplicationSelect;

export type PublicCreditApplication = Prisma.CreditApplicationGetPayload<{ select: typeof PUBLIC_APPLICATION_SELECT }>;

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
  try {
    return await prisma.creditApplication.create({
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
  } catch (e) {
    // The partial-unique index (one non-WITHDRAWN application per deal) rejected a
    // duplicate — a double-submit / retry race. Surface a typed conflict so the
    // route returns 409 rather than creating a second SUBMITTED application.
    if ((e as { code?: string } | null)?.code === "P2002") {
      throw new DuplicateApplicationError(input.dealId);
    }
    throw e;
  }
}

/** Buyer submits their DRAFT application (DRAFT → SUBMITTED), audited as submitted. */
export async function submitApplication(appId: string, opts: { actorId?: string | null } = {}): Promise<void> {
  await advanceApplication(appId, "SUBMITTED", {
    actorType: "BUYER",
    actorId: opts.actorId ?? null,
    reason: "buyer submitted application",
    data: { submittedAt: new Date() },
  });
  const app = await prisma.creditApplication.findUnique({ where: { id: appId }, select: { dealId: true, buyerId: true } });
  await appendFinancingAuditEvent({
    eventType: "APPLICATION_SUBMITTED",
    actorType: "BUYER",
    actorId: opts.actorId ?? null,
    creditApplicationId: appId,
    dealId: app?.dealId ?? null,
    buyerId: app?.buyerId ?? null,
    payload: { submitted: true },
  });
}

/** Buyer-scoped read (ownership enforced) — NEVER returns the encrypted PII columns. */
export async function getApplicationForBuyer(buyerId: string, appId: string): Promise<PublicCreditApplication | null> {
  return prisma.creditApplication.findFirst({ where: { id: appId, buyerId }, select: PUBLIC_APPLICATION_SELECT });
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
  // A terminal is never left, even under force — force only relaxes the edge table
  // for a deliberate human override between non-terminal states.
  if (CA_TERMINAL.includes(from)) {
    throw new CreditApplicationTransitionError(from, to);
  }
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
