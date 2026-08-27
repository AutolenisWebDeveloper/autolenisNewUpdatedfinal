// lib/services/ai/action-intent/types.ts
//
// Program 6 — Controlled AI Action Layer.
//
// This module defines the ONE typed boundary between probabilistic AI
// reasoning and consequential business execution. The AI never executes
// anything: it RECOGNISES a situation and PROPOSES a typed `ActionIntent`.
// Everything downstream — catalog membership, actor/role authorization,
// deterministic policy, human approval, activation, and the canonical
// command — is deterministic code that lives OUTSIDE the model.
//
// Nothing here imports a business service, `next/*`, or Prisma at module
// scope: the core is pure and unit-testable. Side effects live in
// `commands.ts` (lazy imports) and `store.ts`.

import type { ZodTypeAny } from "zod";

// ─── Actor population (which agent/actor is proposing) ───────────────────────
// This is the AI-agent surface, NOT the authenticated auth role. A single
// authenticated user may be served by exactly one actor agent.
export type ActorType = "BUYER" | "DEALER" | "ADMIN" | "AFFILIATE" | "SYSTEM";

// ─── Authenticated role vocabulary (mirrors Prisma UserRole / AdminRole) ─────
// The catalog authorizes against THIS, never against free-form model text.
export type AuthenticatedRole =
  | "BUYER"
  | "DEALER"
  | "AFFILIATE"
  | "SUPER_ADMIN"
  | "OPERATIONS_ADMIN"
  | "COMPLIANCE_ADMIN"
  | "FINANCE_ADMIN"
  | "SUPPORT_ADMIN";

export const ADMIN_ROLES: readonly AuthenticatedRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "COMPLIANCE_ADMIN",
  "FINANCE_ADMIN",
  "SUPPORT_ADMIN",
] as const;

export function isAdminRole(role: AuthenticatedRole): boolean {
  return ADMIN_ROLES.includes(role);
}

// ─── Consequence classification ──────────────────────────────────────────────
// READ         — no authoritative side effect (queries only).
// LOW           — a bounded, reversible write that deterministic policy fully
//                 guards; may execute without human approval when activated.
// CONSEQUENTIAL — money movement, contractual/irreversible/state-machine
//                 actions. ALWAYS requires server-authoritative human approval.
export type Consequence = "READ" | "LOW" | "CONSEQUENTIAL";

// ─── Availability of the underlying capability ───────────────────────────────
// AVAILABLE            — the canonical dependency exists and is safely callable.
// UNAVAILABLE          — the required dependency is absent or intentionally
//                        disabled upstream (e.g. affiliate payouts are gated
//                        off at the service). The intent is cataloged so the AI
//                        can recognise the situation, but it can NEVER execute.
// OWNER_GATED          — implemented but requires an explicit owner/business
//                        decision (e.g. a durable persistence table) before it
//                        can be activated in production.
export type Availability = "AVAILABLE" | "UNAVAILABLE" | "OWNER_GATED";

// ─── Actor context (server-constructed, never model-constructed) ─────────────
export interface ActorContext {
  /** Which agent surface is acting. */
  actorType: ActorType;
  /** Stable id of the acting principal (buyer/dealer/affiliate/admin id). */
  actorId: string;
  /** The authenticated role, resolved server-side from the session. */
  authenticatedRole: AuthenticatedRole;
  /**
   * The domain subject the action concerns (e.g. the buyer id an admin is
   * acting upon, or the buyer's own id). Deterministic policy uses this for
   * ownership / IDOR checks. Defaults to actorId for self-service actors.
   */
  subjectId?: string;
  /** Admin email, when the actor is an admin — used for the audit trail. */
  actorEmail?: string;
}

// ─── The proposal the AI emits ───────────────────────────────────────────────
export interface ActionIntentProposal {
  /** Canonical intent type. MUST exist in the catalog; unknown → rejected. */
  intentType: string;
  /** Raw parameters, exactly as the model produced them. Validated downstream. */
  parameters: unknown;
  /** The server-resolved actor. Never taken from conversation text. */
  actor: ActorContext;
  /** Optional short natural-language rationale from the AI (audited, not trusted). */
  rationale?: string;
  /**
   * Idempotency key for the PROPOSAL. Duplicate proposals with the same key
   * collapse to a single record so a retried/replayed request cannot create
   * (or execute) twice. Distinct from the underlying command's own idempotency.
   */
  idempotencyKey?: string;
}

// ─── Lifecycle status (authoritative state — the model can NEVER set this) ───
export type ActionIntentStatus =
  | "PROPOSED"
  | "REJECTED"
  | "APPROVAL_REQUIRED"
  | "APPROVED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED";

export const TERMINAL_STATUSES: readonly ActionIntentStatus[] = [
  "REJECTED",
  "COMPLETED",
  "FAILED",
] as const;

// ─── Deterministic rejection codes (fail-closed) ─────────────────────────────
export type RejectionCode =
  | "UNKNOWN_INTENT"
  | "UNAVAILABLE_INTENT"
  | "MALFORMED_PARAMETERS"
  | "UNAUTHORIZED_ACTOR"
  | "UNAUTHORIZED_ROLE"
  | "OWNERSHIP_DENIED"
  | "POLICY_DENIED"
  | "NOT_ACTIVATED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_MISSING"
  | "SELF_APPROVAL_FORBIDDEN"
  | "INVALID_STATE"
  | "APPROVER_NOT_PERMITTED";

export class ActionIntentRejected extends Error {
  readonly code: RejectionCode;
  constructor(code: RejectionCode, message: string) {
    super(message);
    this.name = "ActionIntentRejected";
    this.code = code;
  }
}

// ─── The persisted lifecycle record ──────────────────────────────────────────
export interface ActionIntentRecord {
  id: string;
  intentType: string;
  status: ActionIntentStatus;
  actorType: ActorType;
  actorId: string;
  authenticatedRole: AuthenticatedRole;
  subjectId?: string;
  /** Validated parameters (safe representation — never raw secrets). */
  parameters: Record<string, unknown>;
  consequence: Consequence;
  requiresHumanApproval: boolean;
  idempotencyKey?: string;
  rationale?: string;
  approverId?: string;
  rejectionCode?: RejectionCode;
  failureReason?: string;
  /** Authoritative result from the canonical command (never model output). */
  result?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Command contract ────────────────────────────────────────────────────────
// A command is the ONLY thing that invokes a canonical business service. It
// runs only after full authorization + policy + (approval) + activation.
export interface CommandContext {
  record: ActionIntentRecord;
  /** Validated, typed parameters for this intent. */
  params: Record<string, unknown>;
  actor: ActorContext;
}

export interface CommandResult {
  ok: boolean;
  /** Authoritative data to persist on the record and surface to the AI. */
  data?: Record<string, unknown>;
  failureReason?: string;
}

export type CommandFn = (ctx: CommandContext) => Promise<CommandResult>;

// ─── Policy contract ─────────────────────────────────────────────────────────
export interface PolicyResult {
  allowed: boolean;
  code?: RejectionCode;
  reason?: string;
}

export type PolicyFn = (
  ctx: { params: Record<string, unknown>; actor: ActorContext },
  deps: PolicyDeps,
) => Promise<PolicyResult>;

// Injectable dependency surface for deterministic policy. Defaults resolve to
// the real canonical services via lazy import; tests pass fakes. Every function
// here reads authoritative state — none of it trusts the model.
export interface PolicyDeps {
  isFulfillmentUnlocked: (buyerId: string | null | undefined) => Promise<boolean>;
  getOfferContext: (
    offerId: string,
  ) => Promise<{ auctionId: string; auctionBuyerId: string; auctionStatus: string; offerStatus: string } | null>;
  getDealContext: (
    dealId: string,
  ) => Promise<{ buyerId: string; status: string } | null>;
  getAuctionContext: (
    auctionId: string,
  ) => Promise<{ buyerId: string; status: string } | null>;
  getDepositContext: (
    depositId: string,
  ) => Promise<{ buyerId: string; status: string } | null>;
  getDealerInvited: (auctionId: string, dealerId: string) => Promise<boolean>;
}

// ─── Catalog definition ──────────────────────────────────────────────────────
export interface IntentDefinition {
  type: string;
  title: string;
  /** What the intent represents. Declarative only — NOT enforcement. */
  description: string;
  actorType: ActorType;
  permittedRoles: readonly AuthenticatedRole[];
  /** Zod schema for the parameters. Malformed input → deterministic reject. */
  parameters: ZodTypeAny;
  consequence: Consequence;
  requiresHumanApproval: boolean;
  /**
   * The existing RBAC permission a human approver MUST hold to approve this
   * intent (reuses `lib/auth/permissions.ts` PERMISSION_ROLES). Required for
   * every CONSEQUENTIAL intent. Read/low intents may omit it.
   */
  approverPermission?: string;
  availability: Availability;
  /** Granular activation key: `${actorType}:${type}`. Fail-closed by default. */
  activationKey: string;
  /** Canonical service(s) this intent ultimately invokes (for the audit map). */
  canonicalService: string;
  /**
   * Idempotency posture. "delegated" means the underlying canonical command is
   * already idempotent/CAS-guarded and the engine only needs single-execution
   * per record; "none" for pure reads.
   */
  idempotency: "delegated" | "none";
}
