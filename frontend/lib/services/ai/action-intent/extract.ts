// lib/services/ai/action-intent/extract.ts
//
// The ONE parser that turns model output into an `ActionIntentProposal`.
//
// Phase 1's decisive finding was that nothing anywhere performed this step: the
// whole deterministic spine existed, tested, with zero production callers,
// because there was no way to get a proposal INTO it. This module is that step,
// and it lives beside `guidance.ts` on purpose — `guidance.ts` teaches the model
// the envelope, this parses it, and splitting one contract across two packages
// would guarantee they drift.
//
// THE SIGNATURE IS THE SECURITY CONTROL.
//
// `extractProposal` returns `Omit<ActionIntentProposal, "actor" | "idempotencyKey">`.
// Two fields are structurally unreachable from model text:
//
//   • `actor` — `types.ts` already states the rule in prose ("The server-resolved
//     actor. Never taken from conversation text."). The return type makes it a
//     compile-time guarantee instead of a convention. A caller physically cannot
//     forward a model-authored actor, because there is no such field to forward.
//
//   • `idempotencyKey` — this goes beyond the Phase 2 design, deliberately.
//     `engine.ts` collapses a duplicate proposal by returning the EXISTING
//     record's outcome (`proposeIntent` → `findByIdempotencyKey` →
//     `outcomeFromRecord`). A model-authored key is therefore a read primitive:
//     a prompt-injected reply that guessed or replayed another actor's key would
//     be handed that actor's intent status. The key must be minted server-side
//     and scoped to the resolved actor, so it is omitted here too.
//
// What this module validates: SHAPE ONLY. It does not check catalog membership,
// actor, role, parameters, ownership or activation — `authorize.ts` and
// `policy.ts` own all six gates and reject fail-closed. Duplicating any of them
// here would create a second, weaker authorization surface.

import type { ActionIntentProposal } from "./types";

/**
 * The machine-readable envelope. Chosen to be un-guessable from ordinary prose
 * and trivially strippable, so a proposal can never be half-rendered to a user.
 * `guidance.ts` teaches this exact form; the two must change together.
 */
export const INTENT_ENVELOPE_OPEN = "<<<AUTOLENIS_ACTION_INTENT>>>";
export const INTENT_ENVELOPE_CLOSE = "<<<END_AUTOLENIS_ACTION_INTENT>>>";

/** Rationale is audited, never trusted. Cap it so a reply cannot bloat a row. */
export const MAX_RATIONALE_LENGTH = 500;

/**
 * Cap on the model-authored intent type.
 *
 * The longest catalog entry is 28 characters, so this is generous. It exists
 * because `intentType` is carried into the AI audit trail, whose contract is
 * that it records message LENGTH and never message CONTENT — an uncapped field
 * would let a prompt-injected reply smuggle the conversation into it. Anything
 * longer is refused rather than truncated: a truncated intent name is not a
 * name, and the catalog would reject it anyway.
 */
export const MAX_INTENT_TYPE_LENGTH = 100;

/** A proposal with every server-authoritative field structurally absent. */
export type ExtractedProposal = Omit<ActionIntentProposal, "actor" | "idempotencyKey">;

export interface ExtractionResult {
  proposal: ExtractedProposal;
  /** The reply with the envelope removed — what a human is actually shown. */
  visibleText: string;
}

/**
 * Does this reply contain an envelope marker at all — well-formed or not?
 *
 * `extractProposal` returns `null` for a MALFORMED envelope as well as for an
 * ordinary answer, and those two cases need different handling: an ordinary
 * answer is passed through, while a malformed envelope must still be stripped
 * before a human sees it and must still raise the injection signal.
 */
export function containsIntentEnvelope(replyText: string): boolean {
  if (typeof replyText !== "string") return false;
  return replyText.includes(INTENT_ENVELOPE_OPEN) || replyText.includes(INTENT_ENVELOPE_CLOSE);
}

/**
 * Remove every envelope marker and anything between a matched pair.
 *
 * Deliberately unconditional and total: whatever shape the model emitted, no
 * machine payload reaches a human. Unmatched markers are removed on their own so
 * a half-written envelope cannot leak either.
 */
export function stripIntentEnvelopes(replyText: string): string {
  if (typeof replyText !== "string") return "";
  const paired = new RegExp(
    `${escapeRegExp(INTENT_ENVELOPE_OPEN)}[\\s\\S]*?${escapeRegExp(INTENT_ENVELOPE_CLOSE)}`,
    "g",
  );
  return replyText
    .replace(paired, "")
    // An unmatched OPEN swallows the rest of the reply: everything after it was
    // meant to be machine payload, so showing any of it would leak.
    .replace(new RegExp(`${escapeRegExp(INTENT_ENVELOPE_OPEN)}[\\s\\S]*$`), "")
    .replace(new RegExp(escapeRegExp(INTENT_ENVELOPE_CLOSE), "g"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse at most ONE proposal out of a model reply.
 *
 * Returns `null` — meaning "this turn proposed nothing" — for a reply with no
 * envelope, a malformed envelope, or MORE THAN ONE envelope. The multi-envelope
 * rule is load-bearing: one proposal per turn means a prompt-injected reply
 * cannot fan a single turn out into a batch of actions.
 */
export function extractProposal(replyText: string): ExtractionResult | null {
  if (typeof replyText !== "string" || replyText.length === 0) return null;

  const opens = countOccurrences(replyText, INTENT_ENVELOPE_OPEN);
  const closes = countOccurrences(replyText, INTENT_ENVELOPE_CLOSE);

  // No envelope at all is the overwhelmingly common case: an ordinary answer.
  if (opens === 0 && closes === 0) return null;

  // Anything other than exactly one well-formed pair is refused outright rather
  // than "repaired" — a repaired proposal is a guess about intent, and guessing
  // is the one thing this boundary must never do.
  if (opens !== 1 || closes !== 1) return null;

  const start = replyText.indexOf(INTENT_ENVELOPE_OPEN);
  const end = replyText.indexOf(INTENT_ENVELOPE_CLOSE);
  if (end < start) return null;

  const payload = replyText.slice(start + INTENT_ENVELOPE_OPEN.length, end).trim();
  if (!payload) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const intentType = parsed.intentType;
  if (typeof intentType !== "string") return null;
  const trimmedIntentType = intentType.trim();
  if (trimmedIntentType.length === 0) return null;
  if (trimmedIntentType.length > MAX_INTENT_TYPE_LENGTH) return null;

  // `parameters` must be an object. A missing one is read as "no parameters",
  // which the four zero-parameter READ intents legitimately produce; anything
  // present but not an object is malformed, not empty.
  const rawParams = parsed.parameters;
  if (rawParams !== undefined && !isPlainObject(rawParams)) return null;
  const parameters: Record<string, unknown> = isPlainObject(rawParams) ? rawParams : {};

  const rationale =
    typeof parsed.rationale === "string" && parsed.rationale.trim().length > 0
      ? parsed.rationale.trim().slice(0, MAX_RATIONALE_LENGTH)
      : undefined;

  // Any `actor` or `idempotencyKey` the model emitted is dropped here and is
  // unrepresentable in the return type. Both belt and braces: the type stops a
  // caller forwarding one, and this stops the value existing at runtime.
  const proposal: ExtractedProposal = {
    intentType: trimmedIntentType,
    parameters,
    ...(rationale ? { rationale } : {}),
  };

  return { proposal, visibleText: stripIntentEnvelopes(replyText) };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}
