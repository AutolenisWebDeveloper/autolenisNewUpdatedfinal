// lib/services/ai/action-intent/authorize.ts
//
// Deterministic, FAIL-CLOSED authorization. No ActionIntent proceeds unless
// every applicable condition passes, in order. Any failure is a hard reject
// with a typed code and ZERO side effects. The model cannot invent an intent,
// widen its own role, or map an unknown string to the "nearest" command —
// unknown/unmapped/malformed/unauthorized/disabled all reject here.

import type { ActivationResolver } from "./activation";
import { getIntentDefinition } from "./catalog";
import type {
  ActionIntentProposal,
  IntentDefinition,
  RejectionCode,
} from "./types";

export type AuthorizationResult =
  | { ok: true; definition: IntentDefinition; params: Record<string, unknown> }
  | { ok: false; code: RejectionCode; message: string };

export interface AuthorizeDeps {
  activation: ActivationResolver;
}

export async function authorizeProposal(
  proposal: ActionIntentProposal,
  deps: AuthorizeDeps,
): Promise<AuthorizationResult> {
  // 1. Intent must exist in the canonical catalog. Unknown/unmapped → reject.
  const definition = getIntentDefinition(proposal.intentType);
  if (!definition) {
    return {
      ok: false,
      code: "UNKNOWN_INTENT",
      message: `Intent "${proposal.intentType}" is not in the catalog.`,
    };
  }

  // 2. The underlying capability must be available. UNAVAILABLE intents are
  //    cataloged for recognition only and can NEVER execute.
  if (definition.availability === "UNAVAILABLE") {
    return {
      ok: false,
      code: "UNAVAILABLE_INTENT",
      message: `Intent "${definition.type}" is unavailable: ${definition.canonicalService}.`,
    };
  }

  // 3. The requesting agent surface must match the intent's actor. SYSTEM
  //    (shared) intents like escalation are exempt and rely on the role check.
  if (definition.actorType !== "SYSTEM" && proposal.actor.actorType !== definition.actorType) {
    return {
      ok: false,
      code: "UNAUTHORIZED_ACTOR",
      message: `Actor "${proposal.actor.actorType}" may not propose "${definition.type}".`,
    };
  }

  // 4. The authenticated role must be explicitly permitted.
  if (!definition.permittedRoles.includes(proposal.actor.authenticatedRole)) {
    return {
      ok: false,
      code: "UNAUTHORIZED_ROLE",
      message: `Role "${proposal.actor.authenticatedRole}" may not propose "${definition.type}".`,
    };
  }

  // 5. Parameters must satisfy the typed schema. Malformed → reject.
  const parsed = definition.parameters.safeParse(proposal.parameters);
  if (!parsed.success) {
    return {
      ok: false,
      code: "MALFORMED_PARAMETERS",
      message: `Parameters for "${definition.type}" failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    };
  }

  // 6. The actor+intent must be explicitly activated. Dormant by default;
  //    missing configuration fails closed.
  const activated = await deps.activation(definition.activationKey);
  if (!activated) {
    return {
      ok: false,
      code: "NOT_ACTIVATED",
      message: `Intent "${definition.type}" is not activated for ${definition.activationKey}.`,
    };
  }

  return { ok: true, definition, params: parsed.data as Record<string, unknown> };
}
