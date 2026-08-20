// lib/services/financing/lender/lender-service.ts
// Phase 5 Block 2 — the fail-closed, audited wrapper around a LenderAdapter, plus
// the adapter registry. Every submission FAILS CLOSED on missing credentials,
// entitlement, timeout, or adapter error (never a silent approval), and every call
// is recorded on the tamper-evident audit trail carrying ONLY non-PII decisioning
// metadata — applicant SSN/income never reach the audit.

import type { LenderAdapter, CreditApplicationSubmission, LenderResult } from "./types";
import { MockLenderAdapter } from "./mock-lender-adapter";
import { appendFinancingAuditEvent } from "../financing-audit.service";

export const LENDER_SUBMIT_TIMEOUT_MS = 20_000;

interface AuditCtx {
  creditApplicationId?: string | null;
  dealId?: string | null;
  buyerId?: string | null;
}

class LenderTimeoutError extends Error {
  constructor() {
    super("lender submit timed out");
    this.name = "LenderTimeoutError";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LenderTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Submit a credit application through an adapter, fail-closed + audited.
 * - unconfigured adapter → { ok:false, MISSING_CREDENTIALS } and submit() is never called
 * - thrown error → ADAPTER_ERROR ; timeout → TIMEOUT
 * Records an ADAPTER_CALL audit event (non-PII metadata only) for every outcome.
 */
export async function submitCreditApplication(
  adapter: LenderAdapter,
  submission: CreditApplicationSubmission,
  ctx: AuditCtx = {},
  opts: { timeoutMs?: number } = {},
): Promise<LenderResult> {
  if (!adapter.isConfigured()) {
    await auditCall(adapter.name, ctx, { ok: false, phase: "submit", error: "MISSING_CREDENTIALS" });
    return { ok: false, error: { code: "MISSING_CREDENTIALS", message: `${adapter.name} adapter is not configured` } };
  }

  let result: LenderResult;
  try {
    result = await withTimeout(adapter.submit(submission), opts.timeoutMs ?? LENDER_SUBMIT_TIMEOUT_MS);
  } catch (e) {
    const code = e instanceof LenderTimeoutError ? "TIMEOUT" : "ADAPTER_ERROR";
    result = { ok: false, error: { code, message: e instanceof Error ? e.message : String(e) } };
  }

  await auditCall(adapter.name, ctx, {
    ok: result.ok,
    phase: "submit",
    outcome: result.ok ? result.decision.outcome : undefined,
    error: result.ok ? undefined : result.error.code,
  });
  return result;
}

/**
 * Poll a lender decision by reference, through the same fail-closed + timeout +
 * audited wrapper as submit (so status-polling in Block 3 cannot bypass the
 * guarantees). Never calls a real getStatus on an unconfigured adapter.
 */
export async function getLenderStatus(
  adapter: LenderAdapter,
  lenderReferenceId: string,
  ctx: AuditCtx = {},
  opts: { timeoutMs?: number } = {},
): Promise<LenderResult> {
  if (!adapter.isConfigured()) {
    await auditCall(adapter.name, ctx, { ok: false, phase: "status", error: "MISSING_CREDENTIALS" });
    return { ok: false, error: { code: "MISSING_CREDENTIALS", message: `${adapter.name} adapter is not configured` } };
  }
  let result: LenderResult;
  try {
    result = await withTimeout(adapter.getStatus(lenderReferenceId), opts.timeoutMs ?? LENDER_SUBMIT_TIMEOUT_MS);
  } catch (e) {
    const code = e instanceof LenderTimeoutError ? "TIMEOUT" : "ADAPTER_ERROR";
    result = { ok: false, error: { code, message: e instanceof Error ? e.message : String(e) } };
  }
  await auditCall(adapter.name, ctx, {
    ok: result.ok,
    phase: "status",
    outcome: result.ok ? result.decision.outcome : undefined,
    error: result.ok ? undefined : result.error.code,
  });
  return result;
}

// Audit payload carries ONLY non-PII decisioning metadata.
async function auditCall(adapterName: string, ctx: AuditCtx, meta: Record<string, unknown>): Promise<void> {
  await appendFinancingAuditEvent({
    eventType: "ADAPTER_CALL",
    actorType: "SYSTEM",
    creditApplicationId: ctx.creditApplicationId ?? null,
    dealId: ctx.dealId ?? null,
    buyerId: ctx.buyerId ?? null,
    payload: { adapter: adapterName, ...meta },
  });
}

/**
 * Adapter registry. Real adapters are registered by name once their credentials +
 * entitlement are wired at go-live. Until then the default is the scripted mock
 * (which yields PENDING → human review, never a silent decision), and any unknown
 * named adapter resolves to an unconfigured placeholder that fails closed.
 */
export function getLenderAdapter(name?: string): LenderAdapter {
  const requested = name ?? process.env.FINANCING_LENDER_ADAPTER ?? "mock";
  if (requested === "mock") return new MockLenderAdapter({ configured: true });
  return new UnconfiguredLenderAdapter(requested);
}

class UnconfiguredLenderAdapter implements LenderAdapter {
  constructor(public readonly name: string) {}
  isConfigured(): boolean {
    return false;
  }
  async submit(): Promise<LenderResult> {
    return { ok: false, error: { code: "MISSING_CREDENTIALS", message: `${this.name} adapter is not registered` } };
  }
  async getStatus(): Promise<LenderResult> {
    return { ok: false, error: { code: "MISSING_CREDENTIALS", message: `${this.name} adapter is not registered` } };
  }
}
