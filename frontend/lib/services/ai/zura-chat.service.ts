// lib/services/ai/zura-chat.service.ts
//
// THE shared Zura chat service — one entry point for all five web surfaces and
// the voice turn handler, replacing five independent route→agent wirings.
//
// The pipeline, in order:
//
//   context → prompt → provider → extract → propose → audit → persist
//
// Three properties hold across every surface, and they are the whole point:
//
//  1. IDENTITY IS ESTABLISHED ONLY AT THE ROUTE BOUNDARY. A route resolves its
//     session, builds a `ZuraActor`, and passes it in. Nothing in this file
//     reads an identity, a role, or a surface from a request body. `surface` is
//     a parameter the ROUTE supplies from the path it is mounted on — which is
//     why `agentType` could be deleted from the wire: there is no longer any
//     client-controlled input that selects which brain answers.
//
//  2. THE MODEL RECEIVES A BOUNDED PROJECTION, NEVER A RECORD. Prompt content
//     comes from `buildSystemPromptFromContext`, a fixed set of scalar fields.
//     No Prisma row, JSON blob or query result is ever serialised into a prompt.
//
//  3. PORTAL DIFFERENCE COLLAPSES TO THREE DECLARATIVE INPUTS — a context
//     builder, a persona block, and an intent slice. Everything else (kill
//     switch, rate limit, history policy, message cap, audit, persistence) is
//     shared, so a surface cannot accidentally opt out of a guarantee by
//     omission. That is how the four guarantees that previously existed on
//     exactly one surface each now reach all six.
//
// The four guarantees lifted from the dormant `/api/public/ai/chat` (Phase 2
// §1.3b) live here: kill switch before the model call (asserted in the provider
// adapter), a durable per-IP rate limit, a 2,000-character message cap, and an
// 8-message role-filtered, length-capped history.

import { createHash, randomUUID } from "crypto";
import { logger } from "@/lib/logger";
import { complete, type ChatMessage, type ChatModelId } from "@/lib/ai/provider";
import { CHAT_TRANSPORT_POLICY } from "@/lib/ai/transport-policy";
import { ZURA_SYSTEM_PROMPT } from "@/lib/ai/zura-knowledge";
import {
  buildAdminContext,
  buildAffiliateContext,
  buildBuyerContext,
  buildDealerContext,
  buildPublicContext,
  buildSystemPromptFromContext,
  type PlatformContext,
  type ZuraLocation,
  type ZuraSurface,
} from "@/lib/ai/context-builder";
import {
  adminPersona,
  affiliatePersona,
  buyerPersona,
  dealerPersona,
  publicPersona,
} from "@/lib/services/ai/zura-personas";
import {
  approverRoleSatisfies,
  buildActorGuidance,
  containsIntentEnvelope,
  createDurableEngineDeps,
  describeOutcomeForAgent,
  extractProposal,
  getIntentDefinition,
  isActionIntentSurfaceEnabled,
  listIntentsForActor,
  proposeIntent,
  riskClassFor,
  stripIntentEnvelopes,
  type ActorType,
  type EngineDeps,
  type AuthenticatedRole,
  type IntentDefinition,
  type ProposalOutcome,
} from "@/lib/services/ai/action-intent";
import { limitGeneral } from "@/lib/security/rate-limit";
import { recordAiEvent, type AiTurnOutcome } from "@/lib/services/ai/ai-audit.service";
import { persistTurn } from "@/lib/services/ai/zura-transcript.service";

// ─── Shared input policy (lifted from /api/public/ai/chat, now everywhere) ───
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_HISTORY_MESSAGES = 8;

// ─── The actor, resolved at the route boundary ───────────────────────────────
export interface ZuraActor {
  actorType: ActorType;
  actorId: string;
  /**
   * `null` ONLY for the anonymous surfaces. A null role is not a wildcard: it
   * makes intent proposal structurally impossible (see `canProposeIntents`),
   * because `ActorContext.authenticatedRole` cannot be constructed without one.
   */
  authenticatedRole: AuthenticatedRole | null;
  /** Admin email, for the admin audit trail only. Never enters a prompt. */
  actorEmail?: string;
}

// ─── The surface registry (Phase 2 §3.4 C.1/C.5 — a TABLE, not a dispatcher) ─
//
// The key is derived from the ROUTE the request arrived on, never from the
// request body. Building a router that DECIDES which agent answers would
// recreate the exact `routeToAgent` defect this design retires: that switch had
// no `admin` and no `affiliate` arm, so `"admin"` fell through to a buyer
// context built from an admin id — a silent authorization failure driven by a
// client-supplied string.

interface SurfaceDefinition {
  actorType: ActorType;
  /** Does this surface carry an authenticated principal? */
  authenticated: boolean;
  /**
   * May this surface propose ActionIntents at all? False for the anonymous
   * surfaces. This is stronger than relying on a role check: with no
   * `authenticatedRole` there is no `ActorContext` to construct, so `propose`
   * is unreachable rather than merely rejected.
   */
  canProposeIntents: boolean;
  buildContext: (actor: ZuraActor) => Promise<PlatformContext>;
  persona: (ctx: PlatformContext) => string;
  purpose: string;
  model: ChatModelId;
  fallbackModel?: ChatModelId;
  maxTokens: number;
  temperature: number;
  /**
   * Per-turn rate limit. Phase 1 found rate limiting on 1 of 6 surfaces; putting
   * it in the shared definition is what makes forgetting it impossible.
   *
   * The anonymous surfaces carry the tighter 20/hour the (dormant, best-guarded)
   * `/api/public/ai/chat` already used. Authenticated surfaces get a looser
   * 60/hour: they are bounded by a real session rather than an IP, so the limit
   * is an abuse ceiling rather than the primary control. Both are keyed
   * per-actor-or-IP, not globally, so one heavy user cannot starve everyone.
   */
  rateLimit: { tokens: number; window: `${number} ${"s" | "m" | "h"}` };
}

export const SURFACES: Record<ZuraSurface, SurfaceDefinition> = {
  "public-web": {
    actorType: "SYSTEM",
    authenticated: false,
    canProposeIntents: false,
    buildContext: () => buildPublicContext(),
    persona: () => publicPersona(),
    purpose: "zura.public.chat",
    model: "openai/gpt-oss-120b",
    fallbackModel: "openai/gpt-oss-20b",
    maxTokens: 300,
    temperature: 0.7,
    rateLimit: { tokens: 20, window: "1 h" },
  },
  voice: {
    actorType: "SYSTEM",
    authenticated: false,
    canProposeIntents: false,
    buildContext: () => buildPublicContext(),
    persona: () => publicPersona(),
    purpose: "zura.voice.turn",
    model: "openai/gpt-oss-120b",
    fallbackModel: "openai/gpt-oss-20b",
    maxTokens: 120,
    temperature: 0.85,
    rateLimit: { tokens: 20, window: "1 h" },
  },
  buyer: {
    actorType: "BUYER",
    authenticated: true,
    canProposeIntents: true,
    buildContext: (actor) => buildBuyerContext(actor.actorId),
    persona: (ctx) =>
      buyerPersona({
        journeyStage: ctx.journeyStage,
        hasActiveAuction: !!ctx.activeAuction,
        hasActiveDeal: !!ctx.activeDeal,
      }),
    purpose: "zura.buyer.chat",
    model: "openai/gpt-oss-120b",
    fallbackModel: "openai/gpt-oss-20b",
    maxTokens: 512,
    temperature: 0.7,
    rateLimit: { tokens: 60, window: "1 h" },
  },
  dealer: {
    actorType: "DEALER",
    authenticated: true,
    canProposeIntents: true,
    buildContext: (actor) => buildDealerContext(actor.actorId),
    persona: () => dealerPersona(),
    purpose: "zura.dealer.chat",
    model: "openai/gpt-oss-120b",
    fallbackModel: "openai/gpt-oss-20b",
    maxTokens: 512,
    temperature: 0.7,
    rateLimit: { tokens: 60, window: "1 h" },
  },
  affiliate: {
    actorType: "AFFILIATE",
    authenticated: true,
    canProposeIntents: true,
    buildContext: (actor) => buildAffiliateContext(actor.actorId),
    persona: () => affiliatePersona(),
    purpose: "zura.affiliate.chat",
    model: "openai/gpt-oss-120b",
    fallbackModel: "openai/gpt-oss-20b",
    maxTokens: 512,
    temperature: 0.7,
    rateLimit: { tokens: 60, window: "1 h" },
  },
  admin: {
    actorType: "ADMIN",
    authenticated: true,
    canProposeIntents: true,
    buildContext: (actor) =>
      buildAdminContext(actor.actorId, actor.authenticatedRole ?? "SUPPORT_ADMIN"),
    persona: () => adminPersona(),
    purpose: "zura.admin.chat",
    model: "openai/gpt-oss-120b",
    fallbackModel: "openai/gpt-oss-20b",
    maxTokens: 768,
    temperature: 0.5,
    rateLimit: { tokens: 60, window: "1 h" },
  },
};

// ─── Intent slice (server-authoritative, role-scoped) ────────────────────────

/**
 * The intents this actor may even NAME.
 *
 * Admin slices are additionally filtered by the approver permission each intent
 * declares (Phase 2 §5.5): a `SUPPORT_ADMIN` never sees `admin.trigger_deposit_refund`,
 * which requires `finance.refunds`. This is defence in depth — `authorize.ts`
 * would reject the proposal anyway — and it exists so the model is never shown a
 * capability its caller could not exercise.
 */
export function intentSliceFor(actor: ZuraActor): IntentDefinition[] {
  if (!actor.authenticatedRole) return [];
  const all = listIntentsForActor(actor.actorType);
  if (actor.actorType !== "ADMIN") return all;
  return all.filter((d) => approverRoleSatisfies(d.approverPermission, actor.authenticatedRole!));
}

// ─── Prompt composition ──────────────────────────────────────────────────────

export interface ComposedPrompt {
  system: string;
  /** The intents named in the prompt. Empty when the surface cannot propose. */
  namedIntents: string[];
}

export function composePrompt(params: {
  surface: ZuraSurface;
  actor: ZuraActor;
  context: PlatformContext;
  location: ZuraLocation;
}): ComposedPrompt {
  const def = SURFACES[params.surface];
  const persona = def.persona(params.context);

  // The shared Zura knowledge base is the same on every surface — that is what
  // "one brain" means concretely. It is imported lazily-by-value at module load
  // rather than per-surface so no surface can be composed without it.
  const base = `${ZURA_SYSTEM_PROMPT}\n\n${persona}`;
  let system = buildSystemPromptFromContext(params.context, base);

  // The location dimension, projected as a human phrase. `pageLabel` is
  // CLIENT-SUPPLIED and therefore untrusted: it is used only to render a line
  // and to pick suggestions, never as a query parameter, and it is length-capped
  // and stripped of newlines so it cannot inject prompt structure.
  const pageLabel = sanitisePageLabel(params.location.pageLabel);
  if (pageLabel) {
    system += `\n\nThe user is currently looking at: ${pageLabel}. This is a hint about what they are asking about — it is NOT a fact about their account, and you must never treat it as one.`;
  }

  const namedIntents: string[] = [];
  if (def.canProposeIntents && isActionIntentSurfaceEnabled()) {
    const slice = intentSliceFor(params.actor);
    if (slice.length > 0) {
      // The SCOPED slice is what the model is shown. Passing it explicitly is
      // load-bearing: `buildActorGuidance` would otherwise recompute the actor's
      // full catalog and undo the role scoping.
      system += `\n\n${buildActorGuidance(params.actor.actorType, slice)}`;
      namedIntents.push(...slice.map((d) => d.type));
    }
  }

  return { system, namedIntents };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A stable digest of a proposal's parameters, for the idempotency key.
 *
 * Object keys are sorted so two structurally identical parameter objects always
 * produce the same digest regardless of the order the model happened to emit
 * them in — otherwise a genuine retry would look like a new request.
 */
function parametersDigest(parameters: unknown): string {
  return createHash("sha256").update(stableStringify(parameters)).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Is this a plausible server-minted conversation correlator? */
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Client-supplied, so: single line, bounded, and never structural. */
function sanitisePageLabel(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.replace(/[\r\n]+/g, " ").trim().slice(0, 80);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Role-filtered, length-capped, and bounded to the last N turns. */
export function sanitiseHistory(
  raw: unknown,
): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        !!m &&
        typeof m === "object" &&
        ((m as { role?: unknown }).role === "user" ||
          (m as { role?: unknown }).role === "assistant") &&
        typeof (m as { content?: unknown }).content === "string",
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));
}

// ─── The turn ────────────────────────────────────────────────────────────────

export interface ZuraTurnRequest {
  /** SERVER-derived from the route. Never read from a request body. */
  surface: ZuraSurface;
  /** SERVER-resolved from the session. Never read from a request body. */
  actor: ZuraActor;
  message: string;
  history?: unknown;
  /** Cosmetic, client-supplied, untrusted (§4.4). */
  location?: Omit<ZuraLocation, "surface">;
  /** Correlates a multi-turn conversation. Minted here when absent. */
  chatSessionId?: string;
  /**
   * The caller's IP, from `clientIpKey(request.headers)`. Supplied by the route
   * because only the route holds the request. Absent falls back to the actor id,
   * so a missing header can never mean "unlimited".
   */
  clientIp?: string;
}

export type ZuraTurnResult =
  | {
      ok: true;
      content: string;
      model: string;
      chatSessionId: string;
      /** Present only when the turn produced an authoritative proposal outcome. */
      proposal?: {
        intentType: string;
        riskClass: string;
        outcome: ProposalOutcome;
      };
    }
  | {
      ok: false;
      code:
        | "VALIDATION_ERROR"
        | "RATE_LIMITED"
        | "AI_DISABLED"
        | "AI_NOT_CONFIGURED"
        | "AI_ERROR";
      message: string;
      status?: number;
    };

/**
 * Dependency overrides. Follows the pattern the ActionIntent layer already
 * establishes (`defaultEngineDeps(overrides)` / `createDurableEngineDeps(overrides)`):
 * production passes nothing and gets the real, fail-closed wiring; tests inject
 * an in-memory store and a controllable activation resolver so the six
 * authorization gates can be exercised hermetically.
 */
export interface ZuraTurnOverrides {
  engineDeps?: Partial<EngineDeps>;
}

/**
 * Run one Zura turn. This is the only function any surface calls.
 */
export async function runZuraTurn(
  req: ZuraTurnRequest,
  overrides: ZuraTurnOverrides = {},
): Promise<ZuraTurnResult> {
  const def = SURFACES[req.surface];
  // The correlator is CLIENT-SUPPLIED and lands in an indexed audit column, so
  // anything that is not a UUID this service could itself have minted is
  // replaced rather than stored. The idempotency key is separately namespaced by
  // the server-resolved actor, so a caller reusing a correlator can only ever
  // collide with their OWN records — never another actor's.
  const chatSessionId = isUuid(req.chatSessionId) ? req.chatSessionId : randomUUID();
  const auditActor = {
    actorType: req.actor.actorType,
    actorId: req.actor.actorId,
    authenticatedRole: req.actor.authenticatedRole,
  };

  const message = typeof req.message === "string" ? req.message.trim() : "";
  if (!message) {
    return { ok: false, code: "VALIDATION_ERROR", message: "message is required" };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "message is too long" };
  }

  const audit = (outcome: AiTurnOutcome, extra: Record<string, unknown> = {}) =>
    recordAiEvent({
      actor: auditActor,
      surface: req.surface,
      purpose: def.purpose,
      outcome,
      messageLength: message.length,
      chatSessionId,
      ...extra,
    });

  // 0. RATE LIMIT — before the context read and before any model call, so an
  //    abusive caller costs neither a database round trip nor a token.
  //
  //    The subject differs by surface on purpose. An AUTHENTICATED surface keys
  //    on the server-resolved actor id, which is the strongest discriminator
  //    available. An ANONYMOUS surface must key on the IP: its actor id is not a
  //    per-caller value, so keying on it would put every visitor in ONE bucket —
  //    and a single visitor could then rate-limit the whole public surface.
  const limitSubject = def.authenticated
    ? req.actor.actorId || req.clientIp || "unknown"
    : req.clientIp || req.actor.actorId || "unknown";
  const rl = await limitGeneral(`zura:${req.surface}:${limitSubject}`, def.rateLimit);
  if (!rl.ok) {
    await audit("RATE_LIMITED");
    return { ok: false, code: "RATE_LIMITED", message: rl.message, status: rl.status };
  }

  // 1. CONTEXT — built from the server-resolved id, never from the request.
  let context: PlatformContext;
  try {
    context = await def.buildContext(req.actor);
  } catch (err) {
    logger.error("[zura-chat] context build failed", { surface: req.surface, err });
    await audit("ERROR", { errorCode: "CONTEXT_BUILD_FAILED" });
    return { ok: false, code: "AI_ERROR", message: "AI service error — please try again" };
  }

  // 2. PROMPT.
  const location: ZuraLocation = { surface: req.surface, ...(req.location ?? {}) };
  const { system } = composePrompt({ surface: req.surface, actor: req.actor, context, location });
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...sanitiseHistory(req.history),
    { role: "user", content: message },
  ];

  // 3. PROVIDER — the kill switch is asserted inside `complete`, once, for every
  //    surface. No surface can forget it, because no surface performs the call.
  let completion;
  try {
    completion = await complete({
      purpose: def.purpose,
      model: def.model,
      fallbackModel: def.fallbackModel,
      messages,
      maxTokens: def.maxTokens,
      temperature: def.temperature,
      topP: 1.0,
      // Every surface this service now serves previously reached the model
      // through `groqChat` -> the groq-sdk, which bounded each request at 60s
      // and retried a transient failure twice. The SDK is no longer in this
      // path and `complete()` injects no defaults (bare-fetch callers must not
      // gain retries they never had), so the policy is carried explicitly.
      // Without it a stalled provider socket pins the lambda — holding the
      // Prisma connection `buildContext` opened — until the platform timeout.
      maxRetries: CHAT_TRANSPORT_POLICY.maxRetries,
      timeoutMs: CHAT_TRANSPORT_POLICY.timeoutMs,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("AI_KILL_SWITCH") || msg.includes("kill-switch")) {
      await audit("AI_DISABLED");
      return { ok: false, code: "AI_DISABLED", message: "AI services are currently unavailable" };
    }
    if (msg.includes("API_KEY") || msg.includes("not configured")) {
      await audit("ERROR", { errorCode: "AI_NOT_CONFIGURED" });
      return { ok: false, code: "AI_NOT_CONFIGURED", message: "AI service not yet configured" };
    }
    logger.error("[zura-chat] provider call failed", { surface: req.surface, err });
    await audit("ERROR", { errorCode: "PROVIDER_ERROR" });
    return { ok: false, code: "AI_ERROR", message: "AI service error — please try again" };
  }

  // 4. EXTRACT — runs on EVERY surface, including the ones that cannot propose,
  //    so a machine payload is stripped from what a human sees even when the
  //    model emitted one it was never taught about.
  //
  //    Stripping is UNCONDITIONAL and independent of parsing. `extractProposal`
  //    returns null both for an ordinary answer and for a MALFORMED or
  //    multi-envelope reply, and those must not be treated alike: the malformed
  //    case still has to be scrubbed before a human sees it, and still has to
  //    raise the injection signal below.
  const hadEnvelope = containsIntentEnvelope(completion.content);
  const extracted = extractProposal(completion.content);
  let visibleText = hadEnvelope
    ? stripIntentEnvelopes(completion.content)
    : completion.content;

  // 5. PROPOSE.
  let proposal: { intentType: string; riskClass: string; outcome: ProposalOutcome } | undefined;

  if (extracted && (!def.canProposeIntents || !req.actor.authenticatedRole)) {
    // An anonymous surface produced a proposal envelope. It cannot be forwarded:
    // there is no authenticated role to build an ActorContext from. Record it —
    // an envelope appearing where none was taught is exactly the signal a
    // prompt-injection attempt leaves behind.
    logger.warn("[zura-chat] proposal envelope suppressed on a non-proposing surface", {
      surface: req.surface,
      intentType: extracted.proposal.intentType,
    });
    await audit("PROPOSAL_SUPPRESSED", { proposalIntentType: extracted.proposal.intentType });
  } else if (extracted) {
    const outcome = await proposeExtracted({
      extracted: extracted.proposal,
      actor: req.actor,
      chatSessionId,
      engineDeps: overrides.engineDeps,
    });
    const definition = getIntentDefinition(extracted.proposal.intentType);
    const riskClass = definition ? riskClassFor(definition) : "CONSEQUENTIAL";
    proposal = { intentType: extracted.proposal.intentType, riskClass, outcome };

    // TRUTHFULNESS: the sentence the user reads about the outcome is derived
    // from the AUTHORITATIVE status, never from the model's own restatement.
    visibleText = [visibleText, describeOutcomeForAgent(outcome)].filter(Boolean).join("\n\n");

    await audit(outcome.status === "REJECTED" ? "REFUSED" : "PROPOSED", {
      model: completion.model,
      proposalIntentType: extracted.proposal.intentType,
      proposalRiskClass: riskClass,
      ...(outcome.status === "REJECTED" ? { rejectionCode: outcome.code } : {}),
    });
  } else if (hadEnvelope) {
    // An envelope was present but unparseable — malformed JSON, an unterminated
    // marker, or MORE THAN ONE envelope. Nothing is proposed (correct: a
    // repaired proposal would be a guess), but this is not an ordinary answer
    // either. A reply trying to fan one turn out into a batch of actions leaves
    // exactly this trace, so it is recorded rather than silently discarded.
    logger.warn("[zura-chat] unparseable proposal envelope discarded", {
      surface: req.surface,
    });
    await audit("PROPOSAL_SUPPRESSED", { model: completion.model });
  } else {
    // 6. AUDIT — one row per turn, on every surface.
    await audit("ANSWERED", { model: completion.model });
  }

  // 7. PERSIST — a no-op seam in Stage 3A (schema change is 3B, ledger-gated).
  //    Fail-open by construction: `persistTurn` never throws.
  await persistTurn({
    chatSessionId,
    surface: req.surface,
    actor: auditActor,
    userMessage: message,
    assistantMessage: visibleText,
    model: completion.model,
  });

  return {
    ok: true,
    content: visibleText,
    model: completion.model,
    chatSessionId,
    ...(proposal ? { proposal } : {}),
  };
}

/**
 * Hand an extracted proposal to the deterministic engine.
 *
 * THIS LAYER — and only this layer — supplies the actor. The extractor's return
 * type has no `actor` field, so there is nothing to forward; the `ActorContext`
 * below is built from the server-resolved session and nothing else.
 *
 * The idempotency key is likewise minted HERE and scoped to the actor. A
 * model-authored key would be a read primitive: `proposeIntent` collapses a
 * duplicate by returning the existing record's outcome, so a guessed or replayed
 * key would hand the caller another actor's intent status.
 */
async function proposeExtracted(params: {
  extracted: { intentType: string; parameters: unknown; rationale?: string };
  actor: ZuraActor;
  chatSessionId: string;
  engineDeps?: Partial<EngineDeps>;
}): Promise<ProposalOutcome> {
  const { extracted, actor, chatSessionId } = params;

  // Unreachable when `authenticatedRole` is null — the caller checks — but
  // asserted here so this function is safe in isolation.
  if (!actor.authenticatedRole) {
    return {
      status: "REJECTED",
      code: "UNAUTHORIZED_ROLE",
      message: "An anonymous surface may not propose an action.",
    };
  }

  // `createDurableEngineDeps` already resolves activation through the
  // FeatureFlag substrate — the SAME authority the admin approve/reject routes
  // use, so a runtime deactivation stops an intent at execution as well as at
  // proposal. Overriding it here would re-introduce that split.
  const deps = createDurableEngineDeps({ ...params.engineDeps });

  try {
    return await proposeIntent(
      {
        intentType: extracted.intentType,
        parameters: extracted.parameters,
        rationale: extracted.rationale,
        actor: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          authenticatedRole: actor.authenticatedRole,
          subjectId: actor.actorId,
          ...(actor.actorEmail ? { actorEmail: actor.actorEmail } : {}),
        },
        // Scoped to the actor, the conversation, the intent AND the exact
        // parameters.
        //
        // The parameter digest is not decoration. `proposeIntent` collapses a
        // duplicate key by returning the EXISTING record's outcome, so a key
        // that ignored parameters would answer a second, different proposal in
        // the same conversation ("select offer B") with the first record's state
        // ("offer A is awaiting approval") — a false statement about what the
        // user just asked for. Including the digest means a genuine RETRY (same
        // parameters) still collapses, which is the behaviour we want, while a
        // distinct request gets its own record.
        idempotencyKey: [
          "zura",
          actor.actorType,
          actor.actorId,
          chatSessionId,
          extracted.intentType,
          parametersDigest(extracted.parameters),
        ].join(":"),
      },
      deps,
    );
  } catch (err) {
    // The durable store is unavailable while the ActionIntent surface is
    // dormant. That is fail-closed and correct: report it truthfully as a
    // rejection rather than as a success the user did not get.
    logger.warn("[zura-chat] proposal could not be recorded", {
      intentType: extracted.intentType,
      err,
    });
    return {
      status: "REJECTED",
      code: "NOT_ACTIVATED",
      message: "That capability is not switched on yet.",
    };
  }
}
