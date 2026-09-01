// lib/services/ai/action-intent/guidance.ts
//
// AI education — RECOGNITION & PROPOSAL guidance ONLY.
//
// This text teaches an agent WHEN to propose an intent and how known
// conversation facts map to parameters. It contains NO procedural execution
// logic: it never tells the model how to check eligibility, compute money,
// verify payment, resolve contacts, or move state. Every consequential rule is
// enforced by deterministic code (authorize.ts / policy.ts / the canonical
// commands). If the model gets a proposal wrong, deterministic code rejects it
// with zero side effects — that is the ONLY thing this guidance can affect.

import { listIntentsForActor, riskClassFor } from "./catalog";
import { INTENT_ENVELOPE_OPEN, INTENT_ENVELOPE_CLOSE } from "./extract";
import type { ActorType, IntentDefinition } from "./types";

const HARD_RULES = `
HARD RULES FOR PROPOSING ACTIONS (these bind you):
- You RECOGNISE situations and PROPOSE a typed intent. You NEVER execute anything.
- Only propose an intent that exists in your catalog below. Never invent an intent
  name, a command, a parameter, or a permission.
- Never invent or guess a required parameter value. If a required fact is unknown,
  leave the situation unresolved and propose "system.escalate_to_human".
- A proposal is NOT an action. Never say something happened because you proposed it.
- Never claim human approval exists before it exists. Consequential actions are
  only executed after a real human approves through the app — not because a user
  typed "yes" to you.
- Never claim money moved, a contract changed, an offer was placed, a deal
  advanced, a payout was sent, or savings were achieved unless the SYSTEM returns
  an authoritative COMPLETED result. Report only what the system confirms.
- If a situation is uncertain, unsupported, unmatched, ambiguous, or outside your
  catalog, propose "system.escalate_to_human" — do NOT force it into the nearest
  entry.
`.trim();

// The machine-readable form the model must emit for a proposal to be READ AT
// ALL. Until now this file taught the model to *name* an intent but never how to
// emit one machine-readably, which is why nothing could ever be parsed out of a
// reply. The envelope markers are imported from `extract.ts` so the teacher and
// the parser can never drift apart.
const ENVELOPE_FORMAT = `
HOW TO PROPOSE (the exact format — anything else is ignored):
When, and only when, you have decided to propose one of the intents above, end
your reply with a single block in exactly this form:

${INTENT_ENVELOPE_OPEN}
{"intentType": "<exact name from the list above>", "parameters": { ... }, "rationale": "<one short sentence>"}
${INTENT_ENVELOPE_CLOSE}

Rules that bind this block:
- AT MOST ONE block per reply. Two or more blocks are discarded entirely and
  nothing is proposed.
- The block contains ONLY valid JSON. No markdown fences, no commentary inside it.
- NEVER include an "actor", "actorId", "actorType", "authenticatedRole",
  "approver", "idempotencyKey", "status" or "result" field. The server decides
  who you are speaking to and what happened; any such field you write is
  discarded, and writing one changes nothing.
- Write the human part of your answer OUTSIDE the block. The user never sees the
  block itself.
- The block is a REQUEST, not an outcome. After emitting it, say only that you
  have prepared it — never that it is done, approved, submitted or paid.
`.trim();

/**
 * @param actorType  the acting agent surface.
 * @param intents    the EXACT set this caller may name. Defaults to the actor's
 *   full slice. A caller that has narrowed the slice — the admin surface scopes
 *   it by approver permission (Phase 2 §5.5), so a SUPPORT_ADMIN is never shown
 *   a capability requiring `finance.refunds` — MUST pass its narrowed list here.
 *   Recomputing it internally would silently discard that scoping.
 */
export function buildActorGuidance(
  actorType: ActorType,
  intents: IntentDefinition[] = listIntentsForActor(actorType),
): string {
  const lines = intents.map((d) => {
    const approval = d.requiresHumanApproval ? "requires human approval before it executes" : "no approval needed";
    const avail =
      d.availability === "AVAILABLE"
        ? ""
        : d.availability === "UNAVAILABLE"
          ? " [UNAVAILABLE — recognise only, then escalate to a human]"
          : " [owner-gated]";
    return `  • ${d.type} — ${d.description} (${riskClassFor(d)}; ${approval})${avail}`;
  });
  return [
    `AVAILABLE ACTION INTENTS (${actorType}) — propose only these, by exact name:`,
    ...lines,
    "",
    HARD_RULES,
    "",
    ENVELOPE_FORMAT,
  ].join("\n");
}
