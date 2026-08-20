// lib/services/financing/lender/types.ts
// Phase 5 Block 2 — lender adapter contract. Pluggable so a real credit source
// (RouteOne/Dealertrack-style) can be registered at go-live; the engine is built
// and tested against a scripted mock. Decisions are DATA returned by the lender —
// stipulations and decline reason codes are the LENDER's, never our invented
// regulatory content (adverse-action notice text/triggers come from ComplianceRule).

export type LenderOutcome = "APPROVED" | "CONDITIONAL" | "DECLINED" | "PENDING";

export interface CreditApplicationSubmission {
  applicationId: string;
  amountRequestedCents: number;
  termMonths: number;
  vehicle: { vin?: string; year?: number; priceCents: number };
  // Applicant decisioning inputs. Handled in-memory for the lender call only;
  // durable storage is the encrypted application store (Block 3). NEVER logged to
  // the audit trail.
  applicant: { ssn?: string; annualIncomeCents?: number; [k: string]: unknown };
}

export interface LenderDecision {
  outcome: LenderOutcome;
  lenderReferenceId?: string;
  approvedAmountCents?: number;
  aprRate?: number;
  termMonths?: number;
  monthlyPaymentCents?: number;
  stipulations?: string[]; // lender-supplied conditions ("stips") — data, not our rules
  declineReasonCodes?: string[]; // lender-supplied codes — NOT the ECOA notice content
  raw?: unknown;
}

export type LenderErrorCode =
  | "MISSING_CREDENTIALS"
  | "NOT_ENTITLED"
  | "TIMEOUT"
  | "ADAPTER_ERROR"
  | "INVALID_RESPONSE";

export interface LenderError {
  code: LenderErrorCode;
  message: string;
}

export type LenderResult = { ok: true; decision: LenderDecision } | { ok: false; error: LenderError };

export interface LenderAdapter {
  readonly name: string;
  /** Credentials + entitlement present. When false, callers fail closed. */
  isConfigured(): boolean;
  submit(app: CreditApplicationSubmission): Promise<LenderResult>;
  getStatus(lenderReferenceId: string): Promise<LenderResult>;
}
