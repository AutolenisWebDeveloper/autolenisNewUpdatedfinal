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

import { listIntentsForActor } from "./catalog";
import type { ActorType } from "./types";

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

export function buildActorGuidance(actorType: ActorType): string {
  const intents = listIntentsForActor(actorType);
  const lines = intents.map((d) => {
    const approval = d.requiresHumanApproval ? "requires human approval before it executes" : "no approval needed";
    const avail =
      d.availability === "AVAILABLE"
        ? ""
        : d.availability === "UNAVAILABLE"
          ? " [UNAVAILABLE — recognise only, then escalate to a human]"
          : " [owner-gated]";
    return `  • ${d.type} — ${d.description} (${d.consequence}; ${approval})${avail}`;
  });
  return [
    `AVAILABLE ACTION INTENTS (${actorType}) — propose only these, by exact name:`,
    ...lines,
    "",
    HARD_RULES,
  ].join("\n");
}
