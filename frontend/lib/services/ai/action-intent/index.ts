// lib/services/ai/action-intent/index.ts
//
// Program 6 — the ONE controlled AI→business boundary. Public surface.
//
// Flow:  AI proposes a typed ActionIntent → deterministic authorization →
//        deterministic policy → (server-authoritative human approval) →
//        activation → canonical AutoLenis service → authoritative result →
//        audit → truthful outcome.
//
// The AI recognises and proposes; it is never the execution authority. See the
// individual modules for the deterministic guarantees.

export * from "./types";
export {
  ACTION_INTENT_CATALOG,
  getIntentDefinition,
  listIntentsForActor,
  allIntentTypes,
} from "./catalog";
export { authorizeProposal, type AuthorizationResult } from "./authorize";
export {
  envActivationResolver,
  featureFlagActivationResolver,
  alwaysClosedResolver,
  isActionIntentSurfaceEnabled,
  parseActiveKeys,
  type ActivationResolver,
} from "./activation";
export { POLICIES, evaluatePolicy, defaultPolicyDeps } from "./policy";
export { APPROVER_PERMISSION_ROLES, approverRoleSatisfies } from "./approval-permissions";
export { COMMANDS, getCommand } from "./commands";
export {
  InMemoryActionIntentStore,
  auditLogRecorder,
  noopAuditRecorder,
  type ActionIntentStore,
  type ActionIntentAuditRecorder,
  type ActionIntentAuditEvent,
} from "./store";
export {
  proposeIntent,
  approveIntent,
  rejectIntent,
  describeOutcomeForAgent,
  defaultEngineDeps,
  type EngineDeps,
  type ProposalOutcome,
} from "./engine";
export { buildActorGuidance } from "./guidance";
