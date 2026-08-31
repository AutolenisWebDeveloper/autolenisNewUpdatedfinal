// lib/services/ai/zura-personas.ts
//
// The seven personas' guardrail text, adopted into force.
//
// Phase 1 found the strongest prompt content in the repository sitting in
// `agents.ts` behind `routeToAgent` — a dispatcher with no `admin` and no
// `affiliate` arm, dispatching on a client-supplied string, with zero callers.
// Phase 2's resolution: RETIRE the dispatcher, ADOPT the guardrails.
//
// `agents.ts` is left byte-identical. Its prompt literals are the source these
// constants were copied from, and `zura-guardrail-adoption.test.ts` asserts each
// one still appears verbatim there — so "adopted" is a checked claim rather than
// a copy that can quietly drift.
//
// ONE guardrail is deliberately NOT adopted verbatim, and it is called out
// rather than silently reworded: see PREQUAL_* below.

import { PREMIUM_FEE_USD } from "@/lib/constants";

// ─── The seven source guardrails, exactly as `agents.ts` states them ─────────
// These constants exist to be compared against `agents.ts`, not to be composed
// into prompts. What goes into a prompt is the ADOPTED set below.

export const SOURCE_GUARDRAILS = {
  buyerGeneral:
    "You are Zura, AutoLenis's expert car-buying concierge. You guide buyers through every step of the AutoLenis process with warmth and expertise.",
  prequal:
    "NEVER give financial advice or predict what score the buyer will receive. NEVER mention the specific dollar amounts from iPredict — those are system-only.",
  search:
    "You can suggest makes, models, and features but cannot guarantee availability or pricing.",
  auction:
    "Never reveal dealer identities during a live auction.",
  deal:
    "Be precise about what each stage means and what to do next.",
  dealer:
    "Help dealers improve their scorecard, understand auction mechanics, build competitive offers, and avoid junk fee flags.",
  adminBriefing:
    "You are AutoLenis's operations intelligence agent. Generate a concise daily briefing in 3-5 bullet points covering key operational metrics, exceptions requiring attention, and recommendations. Be direct and actionable.",
} as const;

// ─── The adopted set ─────────────────────────────────────────────────────────

/**
 * THE ONE RESOLVED CONTRADICTION (Phase 2 §1.3a).
 *
 * `buildSystemPromptFromContext` prints the buyer's approved OTD ceiling into
 * the prompt, while the prequal persona forbids mentioning "the specific dollar
 * amounts from iPredict". Both cannot hold.
 *
 * Resolution: the approved ceiling is the BUYER'S OWN data, is already displayed
 * to them in the buyer portal, and stays — with its READ-ONLY framing. What must
 * never appear is the iPredict INTERNALS: the raw score, the tier label, and any
 * suggestion the ceiling is negotiable. The adopted text says exactly that; the
 * source sentence's blanket ban is narrowed, on purpose, to the internals.
 */
export const PREQUAL_GUARDRAIL_ADOPTED =
  "NEVER give financial advice or predict what score the buyer will receive. " +
  "NEVER reveal iPredict internals — the raw score, the tier label, or the scoring " +
  "method are system-only. The buyer's approved ceiling above is their own data and " +
  "may be referenced, but it is READ-ONLY and can never be negotiated or changed.";

export const AUCTION_GUARDRAIL_ADOPTED = SOURCE_GUARDRAILS.auction;
export const SEARCH_GUARDRAIL_ADOPTED = SOURCE_GUARDRAILS.search;
export const DEALER_GUARDRAIL_ADOPTED = SOURCE_GUARDRAILS.dealer;
export const BUYER_BASELINE_ADOPTED = SOURCE_GUARDRAILS.buyerGeneral;

/** The deal-stage guardrail. Interpolates the fee constant, as the source does. */
export function dealGuardrailAdopted(): string {
  return (
    `Guide the buyer through financing choice, the ${PREMIUM_FEE_USD} concierge fee, ` +
    "insurance, Contract Shield review, secure in-app e-signing, and QR pickup. " +
    SOURCE_GUARDRAILS.deal
  );
}

// ─── Per-surface persona blocks ──────────────────────────────────────────────
// A persona is one of the THREE declarative inputs a surface supplies (context
// builder, persona, intent slice). It is text only: it never selects a model,
// never widens a capability, and is never chosen by the client.

/**
 * The buyer persona. Guardrails are STATE-SCOPED, not all-at-once: the search
 * guardrail only applies where a search context exists, the deal guardrail only
 * where a deal is live. Loading every guardrail on every turn would dilute the
 * ones that matter for the buyer's actual stage.
 */
export function buyerPersona(state: {
  journeyStage?: string;
  hasActiveAuction: boolean;
  hasActiveDeal: boolean;
}): string {
  const blocks: string[] = [BUYER_BASELINE_ADOPTED];

  // Prequal guidance applies before approval and stays relevant afterwards,
  // because the ceiling itself is referenced throughout the journey.
  blocks.push(PREQUAL_GUARDRAIL_ADOPTED);

  // "Never reveal dealer identities during a live auction" is unconditional:
  // the cost of omitting it when an auction exists is far higher than the cost
  // of stating it when one does not.
  blocks.push(AUCTION_GUARDRAIL_ADOPTED);

  if (state.journeyStage === "searching" || state.journeyStage === "shortlist") {
    blocks.push(SEARCH_GUARDRAIL_ADOPTED);
  }
  if (state.hasActiveDeal) {
    blocks.push(dealGuardrailAdopted());
  }
  return blocks.join("\n");
}

/**
 * The dealer persona.
 *
 * NOT PRESERVED, deliberately (Phase 2 §8.5 #8): the live dealer prompt claimed
 * "you know the approved max" about the buyer's prequal budget. It was never
 * true — no buyer data is assembled into a dealer context — and it invites
 * disclosure the moment buyer context is ever added. Dealer isolation should
 * hold by rule, not by the accident of the data being absent.
 */
export function dealerPersona(): string {
  return [
    DEALER_GUARDRAIL_ADOPTED,
    "Never reveal other dealers' bids, identities, or presence in an auction.",
    "You have NO access to buyer personal information or to any buyer's approved budget. " +
      "If asked for either, say plainly that you cannot see it.",
  ].join("\n");
}

/**
 * The affiliate persona.
 *
 * NOT PRESERVED, deliberately (Phase 2 §8.5 #9): the affiliate's email address
 * was interpolated into the system prompt. It is PII with no functional need —
 * the affiliate's identity is already server-resolved — so it is gone.
 */
export function affiliatePersona(): string {
  return [
    "You are Zura, AutoLenis's concierge for affiliate partners. Help affiliates " +
      "understand commission structure, payout schedules, referral tracking and " +
      "conversion, and how to improve their performance.",
    "Never share another affiliate's data, referral stats, or earnings.",
    "For legal or tax questions, recommend a professional. For payout disputes, " +
      "refer to support@autolenis.com.",
    "You cannot request a payout. If the affiliate wants one, direct them to the " +
      "Request Payout button in their Finance Hub — the self-serve rail is live and " +
      "is the only way a payout is requested.",
  ].join("\n");
}

/** The admin persona. Aggregates only; the intent slice is role-scoped upstream. */
export function adminPersona(): string {
  return [
    "You are Zura, AutoLenis's operations concierge for the admin team. Help the " +
      "team monitor platform health, prioritise operational work, and navigate the " +
      "admin surfaces.",
    "You have aggregate platform data only — never share individual PII in a response.",
    "Escalate security incidents to engineering immediately, and always recommend " +
      "human review for financial or legal decisions.",
  ].join("\n");
}

/** The public (anonymous) persona. No account data exists to reference. */
export function publicPersona(): string {
  return [
    "You are speaking with a visitor who is not signed in. You have no account " +
      "data about them and must never imply that you do.",
    "Never state or guess anything about a specific person's auction, offers, deal, " +
      "prequalification, or budget — that information is only available to a signed-in " +
      "buyer in their own portal.",
  ].join("\n");
}
