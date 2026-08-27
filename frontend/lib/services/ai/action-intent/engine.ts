// lib/services/ai/action-intent/engine.ts
//
// The orchestration engine. It ties the deterministic pieces together into the
// one canonical flow:
//
//   AI proposal → catalog validation → parameter validation → actor auth →
//   role auth → deterministic policy → [human approval] → activation →
//   canonical command → authoritative result → audit → truthful outcome.
//
// The engine never trusts the model. Status is authoritative and only the
// engine sets it; a proposal is not execution, an approval is not completion,
// and only a COMPLETED record (from a real command result) is "done".

import { authorizeProposal } from "./authorize";
import { approverRoleSatisfies } from "./approval-permissions";
import { getIntentDefinition } from "./catalog";
import { COMMANDS } from "./commands";
import { evaluatePolicy, defaultPolicyDeps } from "./policy";
import {
  InMemoryActionIntentStore,
  auditLogRecorder,
  type ActionIntentAuditRecorder,
  type ActionIntentStore,
} from "./store";
import { envActivationResolver, type ActivationResolver } from "./activation";
import {
  ActionIntentRejected,
  isAdminRole,
  type ActionIntentProposal,
  type ActionIntentRecord,
  type ActorContext,
  type CommandFn,
  type IntentDefinition,
  type PolicyDeps,
  type RejectionCode,
} from "./types";

export interface EngineDeps {
  store: ActionIntentStore;
  audit: ActionIntentAuditRecorder;
  activation: ActivationResolver;
  policyDeps: PolicyDeps;
  commands: Record<string, CommandFn>;
  genId: () => string;
}

export type ProposalOutcome =
  | { status: "REJECTED"; code: RejectionCode; message: string; intentId?: string }
  | { status: "APPROVAL_REQUIRED"; intentId: string }
  | { status: "EXECUTING"; intentId: string }
  | { status: "COMPLETED"; intentId: string; result?: Record<string, unknown> }
  | { status: "FAILED"; intentId: string; failureReason?: string };

// Default production wiring: dormant (in-memory store, env activation that is
// fail-closed), real audit trail on the existing AuditLog table, real policy
// reads, real canonical commands. Nothing executes until an intent is activated.
export function defaultEngineDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    store: overrides.store ?? new InMemoryActionIntentStore(),
    audit: overrides.audit ?? auditLogRecorder,
    activation: overrides.activation ?? envActivationResolver(),
    policyDeps: overrides.policyDeps ?? defaultPolicyDeps(),
    commands: overrides.commands ?? COMMANDS,
    genId: overrides.genId ?? (() => cryptoRandomId()),
  };
}

function cryptoRandomId(): string {
  // Node & edge both expose globalThis.crypto.randomUUID.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `ai-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function actorFromRecord(record: ActionIntentRecord): ActorContext {
  return {
    actorType: record.actorType,
    actorId: record.actorId,
    authenticatedRole: record.authenticatedRole,
    subjectId: record.subjectId,
  };
}

// ─── Propose ─────────────────────────────────────────────────────────────────
export async function proposeIntent(
  proposal: ActionIntentProposal,
  deps: EngineDeps,
): Promise<ProposalOutcome> {
  // Idempotent proposal: a duplicate/replayed proposal with the same key
  // collapses to the existing record instead of creating (or executing) twice.
  if (proposal.idempotencyKey) {
    const existing = await deps.store.findByIdempotencyKey(proposal.idempotencyKey);
    if (existing) return outcomeFromRecord(existing);
  }

  // 1. Deterministic, fail-closed authorization (catalog, availability, actor,
  //    role, schema, activation). Any failure → hard reject, ZERO side effects.
  const authz = await authorizeProposal(proposal, { activation: deps.activation });
  if (!authz.ok) {
    await deps.audit.record({
      intentId: deps.genId(),
      intentType: proposal.intentType,
      status: "REJECTED",
      actor: proposal.actor,
      code: authz.code,
      reason: authz.message,
    });
    return { status: "REJECTED", code: authz.code, message: authz.message };
  }
  const { definition, params } = authz;

  // 2. Deterministic business policy (ownership/IDOR, eligibility, money/state
  //    preconditions). Denial → hard reject, ZERO side effects.
  const policyRes = await evaluatePolicy(definition.type, { params, actor: proposal.actor }, deps.policyDeps);
  if (!policyRes.allowed) {
    await deps.audit.record({
      intentId: deps.genId(),
      intentType: definition.type,
      status: "REJECTED",
      actor: proposal.actor,
      code: policyRes.code ?? "POLICY_DENIED",
      reason: policyRes.reason,
    });
    return { status: "REJECTED", code: policyRes.code ?? "POLICY_DENIED", message: policyRes.reason ?? "Policy denied." };
  }

  // 3. Persist the proposal record.
  const id = deps.genId();
  const created = await deps.store.create({
    id,
    intentType: definition.type,
    status: "PROPOSED",
    actorType: proposal.actor.actorType,
    actorId: proposal.actor.actorId,
    authenticatedRole: proposal.actor.authenticatedRole,
    subjectId: proposal.actor.subjectId,
    parameters: params,
    consequence: definition.consequence,
    requiresHumanApproval: definition.requiresHumanApproval,
    idempotencyKey: proposal.idempotencyKey,
    rationale: proposal.rationale,
    policyResult: { allowed: true },
  });
  // Concurrent idempotency collapse: another proposal with the same key won the
  // insert (the store returned the existing row, whose id differs from ours).
  // Return its current authoritative state instead of re-driving it — no throw,
  // no duplicate execution.
  if (created.id !== id) {
    return outcomeFromRecord(created);
  }
  let record = created;
  await deps.audit.record({ intentId: id, intentType: definition.type, status: "PROPOSED", actor: proposal.actor });

  // 4. Consequential intents STOP here awaiting server-authoritative human
  //    approval. No execution occurs from the proposal alone.
  if (definition.requiresHumanApproval) {
    record = await deps.store.transition(id, "PROPOSED", "APPROVAL_REQUIRED");
    await deps.audit.record({ intentId: id, intentType: definition.type, status: "APPROVAL_REQUIRED", actor: proposal.actor });
    return { status: "APPROVAL_REQUIRED", intentId: id };
  }

  // 5. Non-consequential (READ/LOW) intents execute immediately once activated.
  return executeRecord(record, "PROPOSED", deps);
}

// ─── Approve (server-authoritative human approval) ───────────────────────────
export async function approveIntent(
  intentId: string,
  approver: ActorContext,
  deps: EngineDeps,
): Promise<ProposalOutcome> {
  const record = await deps.store.get(intentId);
  if (!record) throw new ActionIntentRejected("INVALID_STATE", `Intent ${intentId} not found.`);

  // Idempotent: re-approving a record that already moved on returns its state.
  if (record.status !== "APPROVAL_REQUIRED") {
    if (record.status === "APPROVED") {
      return executeRecord(record, "APPROVED", deps);
    }
    return outcomeFromRecord(record);
  }

  const definition = getIntentDefinition(record.intentType);
  if (!definition) throw new ActionIntentRejected("UNKNOWN_INTENT", `Intent ${record.intentType} not in catalog.`);

  assertApprover(definition, record, approver);

  // CAS to APPROVED — concurrent double-approve: exactly one wins. The loser's
  // CAS throws INVALID_STATE; catch it and return the current authoritative
  // outcome idempotently rather than surfacing an exception.
  let approved: ActionIntentRecord;
  try {
    approved = await deps.store.transition(intentId, "APPROVAL_REQUIRED", "APPROVED", {
      approverId: approver.actorId,
      approverRole: approver.authenticatedRole,
    });
  } catch {
    const current = await deps.store.get(intentId);
    if (current && current.status === "APPROVED") return executeRecord(current, "APPROVED", deps);
    return current ? outcomeFromRecord(current) : { status: "FAILED", intentId, failureReason: "lost approval race" };
  }
  await deps.audit.record({
    intentId,
    intentType: record.intentType,
    status: "APPROVED",
    actor: actorFromRecord(record),
    approverId: approver.actorId,
  });

  return executeRecord(approved, "APPROVED", deps);
}

// The deterministic gate that makes "AI cannot approve its own proposal"
// enforceable. The AI acts as the SYSTEM actor and can NEVER approve. Admin
// intents require an admin role; self-service intents require the SAME
// authenticated principal (server-authoritative self-confirmation) or an admin.
function assertApprover(definition: IntentDefinition, record: ActionIntentRecord, approver: ActorContext): void {
  if (approver.actorType === "SYSTEM") {
    throw new ActionIntentRejected("SELF_APPROVAL_FORBIDDEN", "The AI/system may never approve an ActionIntent.");
  }
  if (definition.actorType === "ADMIN") {
    if (!isAdminRole(approver.authenticatedRole)) {
      throw new ActionIntentRejected("APPROVER_NOT_PERMITTED", "Admin approval requires an admin role.");
    }
    // Deterministically enforce the declared RBAC approver permission (e.g.
    // finance.refunds → SUPER/FINANCE only). The declared permission is not
    // just metadata — it is enforced here so a SUPPORT/OPS admin cannot approve
    // a money action they lack authority for.
    if (!approverRoleSatisfies(definition.approverPermission, approver.authenticatedRole)) {
      throw new ActionIntentRejected(
        "APPROVER_NOT_PERMITTED",
        `Approving "${definition.type}" requires permission "${definition.approverPermission}".`,
      );
    }
    return;
  }
  // Self-service (buyer/dealer/affiliate) consequential intents: the SAME
  // authenticated principal may confirm their own action (server-authoritative
  // self-confirmation), OR an admin holding the declared permission may approve.
  const selfConfirm = approver.actorType === record.actorType && approver.actorId === record.actorId;
  if (selfConfirm) return;
  const adminOverride =
    isAdminRole(approver.authenticatedRole) &&
    approverRoleSatisfies(definition.approverPermission, approver.authenticatedRole);
  if (!adminOverride) {
    throw new ActionIntentRejected(
      "APPROVER_NOT_PERMITTED",
      "Approval requires the authenticated principal or a permitted admin.",
    );
  }
}

// ─── Reject (explicit human rejection of a pending approval) ─────────────────
export async function rejectIntent(
  intentId: string,
  approver: ActorContext,
  reason: string,
  deps: EngineDeps,
): Promise<ProposalOutcome> {
  const record = await deps.store.get(intentId);
  if (!record) throw new ActionIntentRejected("INVALID_STATE", `Intent ${intentId} not found.`);
  if (record.status !== "APPROVAL_REQUIRED") return outcomeFromRecord(record);
  if (approver.actorType === "SYSTEM") {
    throw new ActionIntentRejected("SELF_APPROVAL_FORBIDDEN", "The AI/system may never resolve an ActionIntent.");
  }
  await deps.store.transition(intentId, "APPROVAL_REQUIRED", "REJECTED", {
    approverId: approver.actorId,
    rejectionCode: "POLICY_DENIED",
    failureReason: reason,
  });
  await deps.audit.record({
    intentId,
    intentType: record.intentType,
    status: "REJECTED",
    actor: actorFromRecord(record),
    approverId: approver.actorId,
    reason,
  });
  return { status: "REJECTED", code: "POLICY_DENIED", message: reason, intentId };
}

// ─── Revalidate (deterministic re-check against CURRENT authoritative state) ──
// Reconstructs the proposal from the durable record and re-runs the SAME
// deterministic authorization (catalog, availability, actor, role, schema,
// activation) and business policy (ownership/IDOR, eligibility, money/state
// gates) that gated the proposal — now, immediately before execution. Nothing
// here is prompt-driven; it reads the canonical authorities.
async function revalidate(
  record: ActionIntentRecord,
  deps: EngineDeps,
): Promise<{ ok: true } | { ok: false; code: RejectionCode; reason: string }> {
  const proposal: ActionIntentProposal = {
    intentType: record.intentType,
    parameters: record.parameters,
    actor: actorFromRecord(record),
    idempotencyKey: record.idempotencyKey,
  };
  const authz = await authorizeProposal(proposal, { activation: deps.activation });
  if (!authz.ok) {
    return { ok: false, code: authz.code, reason: `revalidation failed (${authz.code}): ${authz.message}` };
  }
  const policyRes = await evaluatePolicy(record.intentType, { params: authz.params, actor: proposal.actor }, deps.policyDeps);
  if (!policyRes.allowed) {
    return { ok: false, code: policyRes.code ?? "POLICY_DENIED", reason: `revalidation policy denied: ${policyRes.reason ?? "no reason"}` };
  }
  return { ok: true };
}

// ─── Execute (single-execution via CAS; delegates idempotency to the command) ─
async function executeRecord(
  record: ActionIntentRecord,
  from: ActionIntentRecord["status"],
  deps: EngineDeps,
): Promise<ProposalOutcome> {
  // CAS to EXECUTING. If it fails, another path already advanced this record —
  // do NOT execute again; return whatever authoritative state now holds.
  let executing: ActionIntentRecord;
  try {
    executing = await deps.store.transition(record.id, from, "EXECUTING");
  } catch {
    const current = await deps.store.get(record.id);
    return current ? outcomeFromRecord(current) : { status: "FAILED", intentId: record.id, failureReason: "lost race" };
  }
  await deps.audit.record({ intentId: record.id, intentType: record.intentType, status: "EXECUTING", actor: actorFromRecord(record) });

  // REVALIDATE immediately before the canonical command. Approval is not a
  // licence to run stale work: an intent that was valid at proposal time may be
  // invalid now (deactivated, ownership changed, deposit refunded, auction
  // closed, deal advanced). Re-run the deterministic authorization + policy
  // against CURRENT authoritative state; on any failure, fail closed with zero
  // consequential execution and persist the truthful failure.
  const reval = await revalidate(executing, deps);
  if (!reval.ok) {
    await deps.store.transition(record.id, "EXECUTING", "FAILED", { failureReason: reval.reason, rejectionCode: reval.code });
    await deps.audit.record({ intentId: record.id, intentType: record.intentType, status: "FAILED", actor: actorFromRecord(record), code: reval.code, reason: reval.reason });
    return { status: "FAILED", intentId: record.id, failureReason: reval.reason };
  }

  const command = deps.commands[record.intentType];
  if (!command) {
    await deps.store.transition(record.id, "EXECUTING", "FAILED", { failureReason: "no command registered" });
    await deps.audit.record({ intentId: record.id, intentType: record.intentType, status: "FAILED", actor: actorFromRecord(record), reason: "no command registered" });
    return { status: "FAILED", intentId: record.id, failureReason: "no command registered" };
  }

  try {
    const result = await command({ record: executing, params: executing.parameters, actor: actorFromRecord(executing) });
    if (result.ok) {
      await deps.store.transition(record.id, "EXECUTING", "COMPLETED", { result: result.data });
      await deps.audit.record({
        intentId: record.id,
        intentType: record.intentType,
        status: "COMPLETED",
        actor: actorFromRecord(record),
        resultSummary: result.data,
      });
      return { status: "COMPLETED", intentId: record.id, result: result.data };
    }
    await deps.store.transition(record.id, "EXECUTING", "FAILED", { failureReason: result.failureReason });
    await deps.audit.record({ intentId: record.id, intentType: record.intentType, status: "FAILED", actor: actorFromRecord(record), reason: result.failureReason });
    return { status: "FAILED", intentId: record.id, failureReason: result.failureReason };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await deps.store.transition(record.id, "EXECUTING", "FAILED", { failureReason: reason });
    await deps.audit.record({ intentId: record.id, intentType: record.intentType, status: "FAILED", actor: actorFromRecord(record), reason });
    return { status: "FAILED", intentId: record.id, failureReason: reason };
  }
}

function outcomeFromRecord(record: ActionIntentRecord): ProposalOutcome {
  switch (record.status) {
    case "COMPLETED":
      return { status: "COMPLETED", intentId: record.id, result: record.result };
    case "FAILED":
      return { status: "FAILED", intentId: record.id, failureReason: record.failureReason };
    case "REJECTED":
      return { status: "REJECTED", code: record.rejectionCode ?? "POLICY_DENIED", message: record.failureReason ?? "Rejected.", intentId: record.id };
    // APPROVED/EXECUTING are in-flight — report them truthfully as EXECUTING, not
    // as awaiting approval (which they no longer are).
    case "APPROVED":
    case "EXECUTING":
      return { status: "EXECUTING", intentId: record.id };
    case "APPROVAL_REQUIRED":
    case "PROPOSED":
    default:
      return { status: "APPROVAL_REQUIRED", intentId: record.id };
  }
}

// ─── Truthfulness: derive agent-facing language ONLY from authoritative state ─
// The model may communicate completion ONLY from a COMPLETED outcome. It must
// never claim an action happened because it proposed or approved one.
export function describeOutcomeForAgent(outcome: ProposalOutcome): string {
  switch (outcome.status) {
    case "APPROVAL_REQUIRED":
      return "I've prepared this and it is awaiting human approval. Nothing has been executed yet.";
    case "EXECUTING":
      return "This is approved and in progress. I'll confirm once the system reports it complete.";
    case "COMPLETED":
      return "Done — this has been completed and confirmed by the system.";
    case "FAILED":
      return `This did not go through${outcome.failureReason ? `: ${outcome.failureReason}` : "."}. I can escalate to a human.`;
    case "REJECTED":
      return `I can't do that${outcome.message ? `: ${outcome.message}` : "."}. I can escalate this to a human for you.`;
  }
}
