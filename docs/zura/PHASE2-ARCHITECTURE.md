# AutoLenis — Zura Unified AI Experience
## PHASE 2: Architecture and UX Design

**Baseline SHA (`main`):** `3ccd51340d0e478055ea69ed42e915e73c6f7691`
**Branch:** `claude/zura-unified-design-bp6lbh`
**Input:** [`docs/zura/PHASE1-AI-REGISTRY.md`](./PHASE1-AI-REGISTRY.md) (1,401 lines, on `main`)
**Design date:** 2026-08-31
**Status:** DESIGN ONLY — stops at an owner approval gate. Nothing implemented.

> **Branch-name note.** The brief specifies `claude/zura-unified-design`. This session's
> environment designates `claude/zura-unified-design-bp6lbh` as the mandatory development
> branch and forbids pushing elsewhere, so the work was committed there. Both are cut from
> the baseline SHA above, which is the current tip of `main` (the merge of PR #375).

---

## 0. What this document is, and what it is not

Phase 1 delivered the inventory (24 registry entries, 31 capabilities), the surface
list, the orchestration audit (15 components, 9 present), and the security findings
(3 HIGH, 2 MEDIUM, 2 LOW). **This document does not restate any of that.** Where a
Phase 1 fact is load-bearing it is cited by section (`§A.8`, `§C.14`, …) rather than
reproduced.

This document is design: three resolved decisions, one target architecture, one
context model, one security model, one routing matrix, one UX, one before→after map,
and one implementation sequence.

### 0.1 Boundary — what did not happen

No application code was written, modified, or deleted. No Prisma schema change, no
migration, no test, no refactor. No agent was created, consolidated, or removed. No
production record was read or mutated. No merge, no deploy. **The only file this
phase adds is this one.**

### 0.2 Evidence classes

| Label | Meaning |
| --- | --- |
| `VERIFIED` | Traced to `file:line` **in this session**, or supplied as a production fact in the Phase 2 brief |
| `VERIFIED (P1)` | Established in Phase 1 and cited by its section; Phase 1's 279/279 mechanical citation check covers the location |
| `ASSUMPTION` | A stated working assumption, not confirmed |
| `NOT VERIFIED` | Requires access this session does not have |

Every `path:line` in this document is relative to `frontend/` unless it begins with
`docs/` or `.claude/`.

### 0.3 Environment constraints

- **No database access.** The production facts in §0.4 were supplied by the brief
  from direct queries against `aieybibvewmvrubcpthm`. They are treated as given and
  are never contradicted here.
- **No browser verification.** Phase 1 established the network policy returns `403`
  on CONNECT for all hosts (`§0`). Playwright was not attempted in this phase and
  **no `BROWSER-VERIFIED` claim appears anywhere in this document.** Every UX claim
  about *current* behaviour is read from source; every UX claim about *proposed*
  behaviour is a design proposal, labelled as such.
- **`buffer`, `context7`, `graphify` MCP servers require interactive OAuth** and are
  unavailable in this non-interactive session. None was needed.

### 0.4 Production facts held as given (not re-derived)

1. **AI persistence is entirely unwritten.** Nine tables, all zero rows:
   `ai_chat_sessions`, `ai_chat_messages`, `ai_conversation_contexts`,
   `ai_context_cache`, `ai_kill_switch_logs`, `ai_media_generations`,
   `conversation_messages`, `acquisition_conversations`, `conversations`.
2. **`conversations` is not an AI table.** In production it carries the CRM inbox
   shape (`contact_id`, `phone`, `channel`, `assigned_to`, `unread_count`, `status`,
   `last_message_at` — 10 columns, no `session_id`). **No Zura persistence is
   designed onto it.**
3. **`ai_kill_switch_logs` has never been written.**
4. **Audit tables — three exist, one is live.** `admin_audit_logs` (1,368 rows) is
   live and is what `model AdminAuditLog` maps to. `admin_audit_log` (singular, 3
   rows) is orphaned drift with no Prisma model. `audit_logs` is `model AuditLog`,
   five call sites.
5. **`contacts` is ~94% seed data** — 375 rows, 351 sharing one phone number.
6. **Pre-traffic system:** 0 completed deals, 2 dealers (both Frisco TX 75035),
   1,532 dealer prospects with 0 contacted, 16 buyers. **This design optimises for
   correctness and observability, never for scale.**
7. **`/api/finder` HIGH is closed** — deleted in PR #375, live in production. It is
   not re-reported. The remaining two HIGHs (`/api/concierge:60`, `kill-switch.ts`)
   are addressed in §5.

> **Consequence of fact 7 for Phase 1's text.** Phase 1 §A.21, §A.24
> (`extractVehicleData`), §D.3, §D.9 and §E.2 all describe `/api/finder`. Those
> sections are superseded by the deletion. Where this document must refer to that
> route it does so only to record that it is gone.

### 0.5 What was re-verified this session, and why

Phase 1 discovery was **not** re-run. Nine claims were re-read because the design
turns on a detail Phase 1 left ambiguous or did not need:

| # | Claim re-verified | Why the design needed it | Result |
| --- | --- | --- | --- |
| 1 | `AdminAuditLog` column nullability | The brief requires the unified AI audit to target `admin_audit_logs` **or state why not**. That decision turns entirely on whether a non-admin actor can be represented. | `adminId String` and `adminEmail String` are **non-nullable** — `schema.prisma:1396-1397`. `AuditLog` has `adminId String?` / `userId String?` — `:2588-2589`. Decision in §3.6. `VERIFIED` |
| 2 | `routeToAgent`'s switch arms | Phase 1 said "adopt or retire" the dormant router. Adopting requires knowing whether it is correct. | The `AgentType` union includes `"admin"` (`agents.ts:85`) but the switch (`:96-104`) has **no `admin` case and no `affiliate` case**; `"admin"` falls through `default` to `buyerConciergeAgent`, which calls `buildBuyerContext(adminId)`. Decision in §1.3. `VERIFIED` |
| 3 | `featureFlagActivationResolver` exists and is fail-closed | The design proposes admin-controllable activation without a redeploy. If it had to be built, that is new infrastructure. | It already exists and already fails closed — `activation.ts:47-60`. Pure wiring. `VERIFIED` |
| 4 | `FeatureFlag` substrate + `setFeatureFlag` | Same question for a runtime, admin-controllable kill switch. | `model FeatureFlag` (`schema.prisma:3340-3350`), `getFeatureFlag`/`setFeatureFlag` (`lib/services/admin/admin-platform.service.ts:24,29`), `FLAGS` registry (`lib/services/system/feature-flags.service.ts:4`). **No admin API route sets a flag today** — a repo-wide grep for `setFeatureFlag` under `app/api/` returns nothing. `VERIFIED` |
| 5 | `AiChatSession` / `AiChatMessage` shape | The persistence decision needs to know whether the models can hold non-buyer sessions. | `AiChatSession.buyerId String` is **required and buyer-only**, with **no `@relation` to `Buyer`** (`schema.prisma:3460-3470`). Decision in §1.1. `VERIFIED` |
| 6 | `AiContextCache` vs `AiConversationContext` overlap | Phase 1 §E.4 called them near-identical; retiring one requires knowing how near. | Both keyed `buyerId @unique`, both carry a summary + `concerns` JSON; they differ in `keyFacts` vs `preferences` and a `lastSessionAt` column — `schema.prisma:3278-3287`, `:1380-1390`. `VERIFIED` |
| 7 | The exact guard set on `/api/public/ai/chat` | The design lifts these guarantees rather than reinventing them. | Kill switch first (`:16`), `limitGeneral(…, {tokens:20, window:"1 h"})` keyed by `clientIpKey` (`:22`), 2,000-char cap (`:39`), 8-message role-filtered history (`:44-48`). `VERIFIED` |
| 8 | An existing HMAC-token pattern | §5.4 proposes a server-issued public session handle. Building a new signing scheme would be new infrastructure. | `lib/services/dealer-recruitment/unsubscribe-token.service.ts:18-23,31` — `createHmac("sha256")` + `timingSafeEqual`, secret-optional with graceful degradation. Reusable shape. `VERIFIED` |
| 9 | Whether any `.tsx` reaches the ActionIntent admin routes | The design proposes an approval queue page; if one existed, building it would be duplication. | `app/api/admin/action-intents/{route.ts,[id]/approve/route.ts,[id]/reject/route.ts}` exist; a grep for `action-intents` across `app/` and `components/` `--include=*.tsx` returns **zero hits**. `VERIFIED` |

### 0.6 Skills used

| Skill | Applicable here? | What it contributed |
| --- | --- | --- |
| **Superpowers** (`superpowers-brainstorming`, `-writing-plans`) | Yes | Design and planning discipline for §1 and §9. Its TDD/implementation workflows were **not** used — nothing is implemented in this phase. |
| **`autolenis-ui-design-system`** | Yes — this is the phase where UX is in scope | The token layer (`app/globals.css:49-82`), the source-of-truth hierarchy, the promote-don't-create directive for `components/admin/crm/ui/`. This is the substitute for "Frontend Design", which does not exist under that name in this environment (Phase 1 §0.1). |
| **`autolenis-system-architecture`** | Yes | Extend-don't-fork; the four-layer rule that puts the new chat service in `lib/services/ai/` and keeps route handlers thin. |
| **Impeccable** | **Yes — it has real scope here.** | `critique` was run against the UX section's target. Full log, including a degradation banner, in §7.9. |
| **Playwright** | **No — unusable.** | Not attempted. See §0.3. |
| **`task-observer`** | Yes | Invoked at session start per `CLAUDE.md`; two observations logged. |


---

## SECTION 1 — The three questions Phase 1 left open

Each is answered with one recommendation and its reason. No menus.

### 1.1 Conversation persistence — lapsed or deferred?

> **RECOMMENDATION: deferred, but narrowed. Persist transcripts on
> `AiChatSession` + `AiChatMessage` (extended). Retire `AiConversationContext`
> and `AiContextCache` as design targets.**

**Why persist at all, at 16 buyers.** Not for "memory". Cross-session memory is a
product feature nobody has asked for at this volume, and proposing it would be
designing for hypothetical scale. The justification is the action boundary:

1. **A proposal outlives its request.** The moment Zura can propose an
   `ActionIntent` (§2), a consequential proposal halts at `APPROVAL_REQUIRED`
   (`engine.ts:156-159`) and an admin approves it minutes later in a *different
   request, from a different portal*. The intent record persists
   (`AiActionIntent`); the conversation that produced it does not. An approver
   looking at "buyer X wants to select offer Y" has no way to see what was actually
   said. That is the concrete gap, and it is a correctness gap, not a scale one.
2. **Four of six surfaces produce no record of what Zura said** (Phase 1 §C.12).
   When a model says something wrong about a buyer's budget or a dealer's
   invitations, there is currently nothing to investigate. The transcript is the
   evidence.
3. **`BuyerActivityEvent` is not a substitute.** `app/api/buyer/ai/chat/route.ts:33-40`
   writes a 50-character message preview under a comment claiming it logs "for
   cross-session memory (`AiConversationContext`)". It writes neither the reply nor
   the context model. The comment is wrong and the row is a breadcrumb.

**Onto which models.** `AiChatSession` + `AiChatMessage` (`schema.prisma:3460-3482`),
**extended**. As shipped they cannot carry the design:

| Blocker (`VERIFIED`) | Required change (Phase 3, owner-gated) |
| --- | --- |
| `AiChatSession.buyerId String` is required and buyer-only (`:3462`) — dealer, affiliate, admin and public sessions cannot be represented | Replace with `actorType` + `actorId` (mirroring the existing `ActorContext` vocabulary in `action-intent/types.ts`), plus a nullable `buyerId` retained for the buyer FK below |
| **No `@relation` to `Buyer`** — a buyer account deletion does not cascade to their transcripts | Add the FK with `onDelete: Cascade`. Privacy deletion must reach transcripts or the retention promise is unenforceable |
| `AiChatMessage.model` comment names `llama-3.3-70b-versatile \| mixtral-8x7b-32768` (`:3478`) — neither is a model this codebase calls | Comment correction only |
| No surface column | Add `surface` so a transcript is attributable to public-web / buyer / dealer / affiliate / admin / voice |

`AiChatMessage` needs no structural change: `sessionId` + `role` + `content` +
`model` + `sentAt` with `onDelete: Cascade` (`:3472-3482`) is the right shape.

**Retire, do not extend: `AiConversationContext` and `AiContextCache`.** They are a
duplicated pair (Phase 1 §E.4, re-verified §0.5 #6): both `buyerId @unique`, both a
summary + `concerns` JSON, differing in two columns. Both are zero-row. The only
code that touches either is `lib/services/ai/context-cache.service.ts`, which has
zero importers (Phase 1 §A.25). A rolling conversation summary is a token-budget
optimisation for long histories; at 16 buyers with a 7-turn window
(`ChatWidget.tsx:162`, `VERIFIED (P1)`) there is nothing to summarise.
**Retiring means: they are not targets of this design.** The `DROP TABLE` is an
owner decision (§9.3).

**Retention and PII posture.**

| Question | Decision |
| --- | --- |
| Classification | **PII.** Transcripts contain the buyer's first name, budget ceiling, vehicle interest, and whatever the user types (which in practice includes phone numbers and addresses). Treated at the same level as `BuyerActivityEvent`, not at the SSN/credit-report level. |
| Encryption at rest | **None beyond Supabase's.** `lib/security/field-encryption.ts` is reserved for SSN, credit reports and TOTP secrets; encrypting free text would make the transcript unsearchable by support for no proportionate gain. Stated explicitly so it is an accepted decision, not an oversight. |
| Retention | **90 days for authenticated transcripts**, then hard delete, drained by a cron following the existing `app/api/cron/*` + `withCronRun` pattern. The public path is **unchanged** — `BuyerOpportunity.messages` already persists and already has a lifecycle; this design does not touch what works. |
| Deletion | Buyer account deletion cascades via the new FK. Dealer/affiliate/admin transcripts are deleted by the retention drain and by an explicit admin action. |
| Disclosure | Behaviour changes from "nothing is saved" to "saved". The panel gains one visible line (§7.7) and the public lead gate's disclosure (`app/api/concierge/route.ts:46`) gains one sentence. **This is a legal-review item (§9.3).** |
| What is never written | Model system prompts, the actor's role token, session tokens, and the raw `parameters` of a rejected proposal (the rejection code and intent name go to the audit trail instead). |

### 1.2 Where proposal extraction belongs

> **RECOMMENDATION: one layer — `lib/services/ai/action-intent/extract.ts`, called
> by one shared chat service. Never by an agent. Never by a route handler.**

Phase 1's decisive finding (§C.16): nothing anywhere converts model output into an
`ActionIntentProposal`. Four agents with divergent prompts feed one catalog. The
question is which layer closes that.

**Not the agent.** Four agents means four extractors, four parsers drifting from one
`guidance.ts` contract, and four places to get the actor wrong. The four concierge
agents share no base class, no interface, no context builder (Phase 1 §B.8).

**Not the route handler.** `CLAUDE.md` and `autolenis-system-architecture` both
require thin handlers with business logic in `lib/services/**`. Five handlers each
parsing model output is the same duplication one layer down.

**Inside `action-intent/`, because the contract is already there.** `guidance.ts:35`
(`buildActorGuidance`) is what *teaches* the model the proposal format. An extractor
that *parses* that format must stay in lockstep with it; splitting one contract
across two modules guarantees drift. `types.ts` already defines the target shape.

**The signature is the security control:**

```
// lib/services/ai/action-intent/extract.ts  (PROPOSED — not implemented)
export function extractProposal(
  replyText: string,
): { proposal: Omit<ActionIntentProposal, "actor">; visibleText: string } | null
```

- It returns `Omit<…, "actor">`. **The extractor is structurally incapable of
  setting the actor.** `types.ts` already states the rule in prose — "The
  server-resolved actor. Never taken from conversation text." — and this signature
  makes it a compile-time guarantee rather than a convention.
- It returns `visibleText` with the proposal envelope stripped, so the user never
  sees the machine payload.
- It validates **shape only** (an envelope containing an `intentType` string and a
  `parameters` object). It does **not** check catalog membership, roles, or
  parameters — `authorize.ts` owns all three and rejects fail-closed.
- It returns `null` for any reply with no envelope, a malformed envelope, or more
  than one envelope. **One proposal per turn**, so a prompt-injected reply cannot
  fan out into a batch.

**The caller** is the shared chat service (§3.2), which supplies the `ActorContext`
built from the server-resolved session and calls `proposeIntent`. That is the entire
missing step. `guidance.ts` gains the exact envelope format it currently omits — it
teaches the model to *name* an intent but never says how to emit one machine-readably.

### 1.3 The two dormant-but-stronger assets

#### (a) The seven-agent roster and `routeToAgent` — **adopt the guardrails, retire the router**

**Retire `routeToAgent` as a dispatcher.** Three reasons, one of them a live defect:

1. **It is wrong today.** `AgentType` includes `"admin"` (`agents.ts:85`) but the
   switch (`:96-104`) has **no `admin` case and no `affiliate` case**. A call to
   `routeToAgent("admin", adminId, …)` falls through `default` into
   `buyerConciergeAgent(adminId, …)`, which calls `buildBuyerContext(adminId)` — an
   admin id used as a buyer id. It returns `{ role: "BUYER" }` for a missing buyer
   rather than throwing (`context-builder.ts:33`), so the failure is silent.
   `VERIFIED` this session. Wiring this router would ship that defect.
2. **It dispatches on a client-supplied string.** Phase 1 §D.9 identified exactly
   this shape as the latent escalation risk and named the dormant `agentType` prop
   (`ChatWidget.tsx:12,174`) as the selector already on the wire. Adopting
   `routeToAgent` would connect the selector to the dispatcher.
3. **It has no affiliate path at all**, so it cannot serve all five surfaces anyway.

**Adopt the guardrail text.** The per-persona rules are the strongest prompt content
in the repository and are in force nowhere:

| Persona | Guardrail | Where it goes |
| --- | --- | --- |
| Prequal (`agents.ts:17`) | "NEVER mention the specific dollar amounts from iPredict — those are system-only" | Buyer prompt, **scoped** — see the contradiction below |
| Auction (`:32`) | "Never reveal dealer identities during a live auction" | Buyer prompt, always |
| Search (`:24`) | "cannot guarantee availability or pricing" | Buyer prompt when a search context is present |
| Deal (`:39`) | Stage-precise financing / fee / Contract Shield / e-sign / pickup language | Buyer prompt when a deal is active |
| Dealer (`:46`) | Scorecard, tier, junk-fee-flag framing | Dealer prompt |
| Buyer general (`:10`) | Warmth + step guidance | Buyer prompt baseline |
| Admin briefing (`:54`) | Stays as its own capability (§3.5) | — |

**A contradiction this adoption must resolve (`VERIFIED`).**
`buildSystemPromptFromContext` prints the buyer's exact budget ceiling *and* the
prequal tier into the prompt (`context-builder.ts:99-104`), while the prequal
persona forbids mentioning "the specific dollar amounts from iPredict"
(`agents.ts:17`). Both cannot hold. **Resolution:** the buyer's approved OTD ceiling
is the buyer's own data, is already displayed in the buyer portal, and stays in the
prompt with its existing READ-ONLY framing. What must never appear is the **iPredict
internals** — the raw score, the tier label, and any suggestion the ceiling is
negotiable. `ctx.prequal.tier` therefore leaves the prompt projection (§4.3).

**Adopt `context-builder.ts`, extended.** It is the only shared context abstraction
in the repository (`:22,67,76,81`), and its `PlatformContext` is close to what §4
needs. Three extensions: an `AFFILIATE` role (absent today), a `DEALER` context
richer than the single `tier` field it returns at `:67-74` (the live dealer agent
reads more than that, so adopting it as-is would be a regression), and the
`location` dimension of §4. Its buyer branch already implements "never reveal dealer
identities" and "the ceiling is immutable" — adopted verbatim.

#### (b) `/api/public/ai/chat` — **adopt the guarantees, retire the endpoint**

This is Phase 1's sharpest finding (§A.6): the *guarded* public endpoint is dead and
the *unguarded* one carries all public traffic.

**Adopt all four guarantees by lifting them into the shared service (§3.2)**, where
every surface inherits them instead of one dormant route owning them:

| Guarantee | Source | Where it lands |
| --- | --- | --- |
| Kill switch checked before the model call | `route.ts:16` | The provider adapter (§3.4) — asserted once, structurally |
| Durable per-IP rate limit, 20/hour | `route.ts:22` → `lib/security/rate-limit.ts:174,111` | Shared service, per surface (§5.4) |
| 2,000-character message cap | `route.ts:39` | Shared service input contract |
| 8-message role-filtered, length-capped history | `route.ts:44-48` | Shared service history policy |

**Retire the endpoint.** Once its guards live in the shared service it is a
publicly-POST-able route with no UI, no persistence, no data access, and a header
comment that misdescribes it (`:8` claims the homepage widget uses it; the widget
posts to `/api/concierge` — `ChatWidget.tsx:96`, `VERIFIED (P1)`). Deleting a route
is an owner decision (§9.3); this design simply stops treating it as a target and
removes its reason to exist.

**Neither asset is left dormant.** Both are resolved in one direction.

---

## SECTION 2 — Extending the ActionIntent engine

> **VERDICT: EXTENDED. Not replaced. No second router is built.**

Phase 1 §A.8/§C.16 established that the deterministic spine is complete, tested (10
module test files + a route suite), and has **zero production callers of
`proposeIntent`**. This design wires that spine.

### 2.1 The test that would justify replacement, and its result

The brief requires file-level evidence before proposing anything new. I looked for a
requirement the existing engine cannot satisfy. **I found none.** The four
candidates and why each fails:

| Candidate requirement | Could the existing engine serve it? | Evidence |
| --- | --- | --- |
| A proposal must carry a natural-language rationale for the approver | Yes — `ActionIntentProposal.rationale` already exists and is explicitly "audited, not trusted" (`types.ts`) | `VERIFIED` |
| A retried HTTP request must not create two proposals | Yes — `idempotencyKey` collapse at `engine.ts:90-94` | `VERIFIED` |
| Approval must survive a process restart between propose and execute | Yes — `PrismaActionIntentStore` with conditional `updateMany` CAS transitions (`prisma-store.ts:8-18`) | `VERIFIED` |
| A capability must be enable-able one at a time, in production, without a redeploy | Yes — `featureFlagActivationResolver()` already exists and already fails closed (`activation.ts:47-60`) | `VERIFIED` §0.5 #3 |
| A seventh risk class must drive control flow | **Not required.** See §6.1 — the seven-class vocabulary is presentational and rides alongside `Consequence` as additive metadata | Design decision |

**Nothing justifies a second engine.**

### 2.2 What is genuinely new (three things)

| # | New artifact | Why nothing existing covers it | Size |
| --- | --- | --- | --- |
| 1 | `action-intent/extract.ts` | Phase 1 §C.16: a repo-wide search for `proposeIntent` / `ActionIntentProposal` outside the module returns zero hits. There is no model-output parser anywhere. | One file, one exported function |
| 2 | `lib/services/ai/zura-chat.service.ts` | Five routes each import their own agent; there is no shared chat service. The one module that *was* meant to be it (`context-builder.ts` + `routeToAgent`) is dormant and, for `routeToAgent`, defective (§1.3a). | One service |
| 3 | The admin approval queue **page** | Three API routes exist with zero `.tsx` callers (`VERIFIED` §0.5 #9). Without a page, an `APPROVAL_REQUIRED` intent is unreachable by a human and the boundary is a dead end. | One page, composed from `components/admin/crm/ui/` |

### 2.3 What is extended (existing files, additive only)

| File | Change | Nature |
| --- | --- | --- |
| `guidance.ts` | Add the machine-readable envelope format the extractor parses. It currently teaches the model to *name* an intent (`:35-52`) but never how to emit one. | Additive text |
| `activation.ts` | Swap the production resolver from `envActivationResolver()` to `featureFlagActivationResolver()`. **Both already exist.** | Wiring only |
| `catalog.ts` | Add an optional `riskClass` field (§6.1), defaulted from `consequence`. No new intents in the first increments. | Additive optional field |
| `engine.ts`, `authorize.ts`, `policy.ts`, `commands.ts`, `store.ts`, `prisma-store.ts`, `approval-permissions.ts`, `api-shape.ts` | **No change.** | — |

Eight of the eleven modules in `lib/services/ai/action-intent/` are untouched. That
is what "extend the spine" means concretely.

### 2.4 The wired flow

```
        ┌─ route handler (thin) ──────────────────────────────────────┐
        │ session → ActorContext            ← the ONLY identity source │
        └──────────────────────┬──────────────────────────────────────┘
                               ▼
        ┌─ lib/services/ai/zura-chat.service.ts ──────────────────────┐
        │ 1. buildZuraContext(actor, surface)   [context-builder.ts]  │
        │ 2. composePrompt(context, persona, buildActorGuidance())    │
        │ 3. complete(messages)                 [lib/ai/provider.ts]  │  ← kill switch asserted here
        │ 4. extractProposal(reply)             [action-intent/…]     │  ← returns Omit<…,"actor">
        │ 5. proposeIntent({ ...extracted, actor })                   │  ← actor supplied by THIS layer
        │ 6. recordAiEvent(...)                 [ai-audit.service]    │
        │ 7. persistTurn(...)                   [AiChatSession/…]     │
        └──────────────────────┬──────────────────────────────────────┘
                               ▼
        ┌─ EXISTING, UNCHANGED ───────────────────────────────────────┐
        │ authorize.ts (6 gates) → policy.ts → approval → activation  │
        │ → revalidate (engine.ts:288) → COMMANDS → AuditLog          │
        └─────────────────────────────────────────────────────────────┘
```

Steps 1, 4, 5, 6, 7 are new or newly wired. Everything below the second box is the
existing engine, byte-for-byte.


---

## SECTION 3 — Unified architecture

### 3.1 The problem restated in one line

One shared shell, five unrelated brains: `ChatWidget.tsx` renders all five web
surfaces (`:36`) over five system prompts, two transport contracts (`:90-207`), and
per-surface divergence in rate limiting (1 of 6), audit (1 of 6) and persistence
(1 of 6) — Phase 1 §B.8.

### 3.2 The target, in five sentences

1. One shared chat service — `lib/services/ai/zura-chat.service.ts` — becomes the
   single entry for all five web surfaces and the voice turn handler, replacing five
   independent route→agent wirings with one `context → prompt → provider → extract →
   propose → audit → persist` pipeline.
2. Identity, authority and scope are established **only** at the route boundary from
   the server-resolved session and carried in one `ZuraContext`; the model receives a
   bounded projection of it and never an authoritative record.
3. Capability routing is deterministic — the server-resolved actor decides which
   catalog intents are even *nameable* (`listIntentsForActor`), and the existing
   six-gate `authorize.ts` → `policy.ts` → approval → revalidate chain decides
   whether any of them executes.
4. The four guarantees that today exist on exactly one surface each — kill switch,
   rate limit, audit, persistence — move into that shared service so all six surfaces
   inherit them rather than re-implementing them per portal.
5. Portal difference collapses to three declarative inputs — a context builder, a
   persona guardrail block, and an intent slice — so nothing forks the transport, the
   widget, or the security model.

### 3.3 Surface disposition — the six Zura surfaces plus three non-Zura admin AI surfaces

| # | Surface | Today | Folds into unified Zura? | Reason |
| --- | --- | --- | --- | --- |
| 1 | **Public web** — `/api/concierge` (§A.5) | Streaming `text/plain`; `CONCIERGE_SYSTEM_PROMPT`; writes `BuyerOpportunity`, promotes to `VehicleRequest`, upserts a CRM contact | **FOLDS.** Keeps its streaming transport and its intake extraction (that is profile capture, not `ActionIntent`). Gains kill switch, rate limit, audit, server-issued session handle, server-verified consent (§5.4). | It is the busiest public AI path and the one with the fewest guarantees. Folding it is the single largest security win. |
| 2 | **Public voice** — `handleVoiceTurn` (§A.7) | Groq reply + Groq extraction + Whisper STT + ElevenLabs TTS; TwiML; own store | **PARTIAL.** Shares the prompt core, the provider adapter, the kill switch, and the audit. **Keeps** its own turn handler, TwiML transport, conversation store, and latency budget. | A phone turn has a hard latency ceiling and a different transport. Forcing it through the web service would be a rewrite of a working path for no benefit. What it must gain is the deterministic re-check on `callReason` (§5.6). |
| 3 | **Buyer** — `/api/buyer/ai/chat` (§A.1) | `ZURA_SYSTEM_PROMPT` + buyer prefix + inline builder; no persistence; no audit; no rate limit | **FOLDS fully.** | Nothing about the buyer path is special. |
| 4 | **Dealer** — `/api/dealer/ai/chat` (§A.2) | Inline prompt, no `ZURA_SYSTEM_PROMPT`; no audit | **FOLDS fully**, and the prompt's false "you know the approved max" claim is deleted (§D.8). | Dealer isolation currently holds by absence of data, not by rule. Folding makes it hold by rule. |
| 5 | **Affiliate** — `/api/affiliate/ai/chat` (§A.4) | Inline prompt; affiliate email interpolated into the system prompt | **FOLDS fully**, and the email leaves the prompt (§D.7). | — |
| 6 | **Admin** — `/api/admin/ai/chat` (§A.3) | Inline prompt; platform-wide aggregates; the only chat surface with real audit | **FOLDS fully**, plus role scoping (§5.5). Its `admin_audit_logs` write is **preserved unchanged**. | The one surface that already audits must not lose its trail; it gains role scoping it does not have. |
| 7 | **`/admin/ai` console + morning briefing** (§A.10, §B.5) | A page: status panel, config table, "Generate Briefing" | **STAYS SEPARATE as a page.** The briefing itself becomes a READ capability the unified Zura can also invoke. Its three false claims are corrected (§8.4). | A status console is not a conversation. But an admin asking Zura "give me today's briefing" should get one, so the *capability* joins the catalog surface even though the *page* stays. |
| 8 | **CRM Copilot** (§A.9) | Slide-over in `CrmShell`; Zod-validated drafts; a real separate approve route | **STAYS SEPARATE.** Gains the provider adapter (so the kill switch reaches it) and the unified AI audit. | Its two-step generate→approve boundary is the correct shape and is documented as "the ONLY way a copilot draft becomes a stored record". Folding it into a chat panel would dissolve that boundary. Do not rebuild what works. |
| 9 | **AMIPS executive narrative** (§A.12) | Admin report narration over AMIPS intelligence tables | **STAYS SEPARATE.** Gains the provider adapter and the unified AI audit. | Report generation, not conversation. It already enforces the kill switch twice. |

> **A note on "the three non-Zura admin AI surfaces".** Phase 1 §B.5 names a
> "second" (`/admin/ai` console) and a "third" (CRM `CopilotPanel`) admin AI surface
> alongside the admin `ChatWidget`. Reading the brief's "three" as *three non-Zura*
> surfaces, I take them to be rows 7, 8 and 9 above and say so rather than guessing
> silently. The background AI engines — six social engines (§A.15–A.19), three
> dealer-recruitment services (§A.23), the acquisition cluster (§A.24), the SEO
> article generator (§A.14), the AMIPS page generator (§A.13) — are **not surfaces**;
> they are admin- and cron-triggered pipelines with no conversational entry. They do
> not fold into Zura. They **do** all move onto the provider adapter (§3.4), which is
> how the kill switch finally reaches them. Their disposition is in §8.4.

### 3.4 Closing the six absent orchestration components

Phase 1 §C found 9 of 15 present. Each of the six absent is either built minimally
or explicitly omitted with a reason.

| # | Component | Decision | Design |
| --- | --- | --- | --- |
| **C.1** | **Real agent registry** | **BUILD — minimal** | One `SURFACES` record in `zura-chat.service.ts`: `surface → { actorType, contextBuilder, persona, transport }`. Six entries. It is a *table*, not a dispatcher: the key is derived from the route the request arrived on, never from the request body. This is the same artifact as C.5 — one registry, not two. |
| **C.5** | **AI router** | **BUILD — same artifact as C.1** | There is no separate router. "Routing" is a lookup on a server-derived surface key. Building a router that *decides* which agent answers would recreate the `routeToAgent` defect (§1.3a). |
| **C.6** | **Intent router** | **OMIT — already exists under another name** | `catalog.ts` + `authorize.ts` **are** the intent router: `listIntentsForActor` is the routing table, and the six ordered gates are the routing decision. What was missing is the input, and that is `extract.ts` (§1.2). Building a second intent router beside a tested one is precisely the parallel system `CLAUDE.md` forbids. |
| **C.7** | **Planner** | **OMIT — no requirement** | All 12 catalog intents are single-step. No AutoLenis workflow requires the AI to sequence two consequential actions; every multi-step business flow (deal advance, auction close, refund) is already a deterministic state machine owned by a service. A general planner at 16 buyers and 0 completed deals is speculative infrastructure. **Revisit only when a real two-step AI workflow is specified.** |
| **C.12** | **Unified AI audit** | **BUILD — minimal** | See §3.6. |
| **C.15** | **Provider abstraction** | **BUILD — minimal, and it is the highest-leverage change in this design** | See §3.5. |

### 3.5 Provider abstraction — the structural fix for the kill switch

Today (Phase 1 §C.15): four providers, at least nine model identifiers, zero
abstraction. `lib/ai/groq-client.ts` is a *Groq* client with two hard-coded model
constants (`:8-9`), which is exactly why `lib/ai/acquisition.ts` bypasses it. Nineteen
modules reach a model endpoint; eighteen bypass the kill switch.

**Design — `lib/ai/provider.ts` plus `lib/ai/providers/{groq,gemini,anthropic,openai}.ts`:**

```
// PROPOSED — not implemented
export interface CompletionRequest {
  messages: ChatMessage[];
  model: ModelId;                 // an explicit union of the 9 ids already in use
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  purpose: string;                // e.g. "zura.buyer.chat" — carried to audit + logs
}
export async function complete(req: CompletionRequest): Promise<CompletionResult>;
```

Three properties that matter:

1. **`assertAiEnabled()` is called exactly once, here.** Every model call in the
   application passes through this function, so the kill switch stops being a
   discipline problem and becomes a structural one. The 18 bypassing modules keep
   their prompts, their models and their behaviour; **only the transport line
   changes.**
2. **The existing fallback chain is preserved, not reinvented.** `groqChat`'s
   429/rate-limit/overloaded fallback from `openai/gpt-oss-120b` to
   `openai/gpt-oss-20b` (`groq-client.ts:60-72`) moves into the Groq adapter
   unchanged. `autolenis-system-architecture` rule 10 requires a documented fallback
   and logging of which provider fired; `purpose` + the returned `model` give that.
3. **It makes the `/admin/ai` page's false claim testable.** The page asserts "Groq
   API (only approved provider)" (`:62`) and "Anthropic, OpenAI, Gemini, and Cohere
   are explicitly prohibited" (`:104`) while Gemini, `claude-haiku-4-5` and Whisper
   all run in production (Phase 1 §A.7, §A.23, §A.24). Once `ModelId` is a closed
   union, the console renders the real list from it and cannot drift again.

**A regression test can then enforce it** (§9.2): no file outside `lib/ai/providers/`
may contain a model endpoint host or a provider SDK constructor. That test is
red today and green after this increment.

### 3.6 Unified AI audit — target table and why

> **DECISION: the unified AI audit writes `audit_logs` (`model AuditLog`), NOT
> `admin_audit_logs`. Admin-actor AI events additionally keep their existing
> `admin_audit_logs` write, unchanged.**

The brief requires targeting `admin_audit_logs` or stating why not. Here is why not.

**1. `AdminAuditLog` structurally cannot represent a non-admin actor.**
`adminId String` and `adminEmail String` are **non-nullable** (`schema.prisma:1396-1397`,
`VERIFIED`). Four of the six Zura surfaces — public web, public voice, buyer, dealer
— and the affiliate surface have no admin principal. Writing them there would require
inventing an admin id and email for a buyer's chat turn. **A falsified actor in an
audit record is worse than no record.**

**2. `AuditLog` already models both principals.** `adminId String?` and
`userId String?` (`:2588-2589`, `VERIFIED`).

**3. The AI audit trail is already there.** `auditLogRecorder` writes every
ActionIntent lifecycle transition to `prisma.auditLog` with
`entityType: "AiActionIntent"` and an `actorAction: "AI_ACTION_INTENT"` metadata
marker (`store.ts:135-167`, `VERIFIED`). Targeting `audit_logs` **extends the
existing AI audit trail**; targeting `admin_audit_logs` would fork it in two, which
is the duplication `CLAUDE.md` forbids.

**4. The live admin trail is preserved untouched.** `admin_audit_logs` holds 1,368
rows and 163 call sites reference `prisma.adminAuditLog` (`VERIFIED` — grep count
across `app/`, `lib/`, `scripts/`). Nothing in this design changes any of them. The
existing `ADMIN_AI_CHAT` (`app/api/admin/ai/chat/route.ts:31-36`) and
`CRM_COPILOT_GENERATE`/`_APPROVE` writes stay exactly as they are.

**Consequence, stated plainly:** an admin AI turn produces **two** audit rows — one
in the admin trail (existing, unchanged) and one in the AI trail (new). This is a
deliberate double-write, not an oversight. The alternative — routing admin AI events
only to `admin_audit_logs` — would mean the AI trail has a hole exactly where the
highest-privilege actor is, which is the wrong hole to have. **Owner sign-off item
(§9.3).**

**`admin_audit_log` (singular, 3 rows, no Prisma model) is never a target.** It is
orphaned schema drift. Recommend the owner drop it (§9.3).

**The design — `lib/services/ai/ai-audit.service.ts`:**

```
// PROPOSED — not implemented
recordAiEvent({
  actor,            // ActorContext — server-resolved
  surface,          // "public-web" | "voice" | "buyer" | "dealer" | "affiliate" | "admin"
  purpose,          // matches CompletionRequest.purpose
  model,            // what actually answered, incl. fallback
  outcome,          // "ANSWERED" | "PROPOSED" | "REFUSED" | "RATE_LIMITED" | "AI_DISABLED" | "ERROR"
  messageLength,    // never the message body — the transcript is the body of record
  proposalIntentType?,
  rejectionCode?,
})
```

Written on **every** AI turn on **all six** surfaces. It records message *length*,
never content — the content lives in the transcript store (§1.1) under its own
retention policy, so the audit trail is not a second uncontrolled copy of PII. This
mirrors the deliberate exclusion already practised by `CRM_COPILOT_GENERATE`, which
records the prompt but excludes `context` and draft text (Phase 1 §A.9).

**`AiKillSwitchLog` is adopted for what it is actually for.** Its shape
(`enabled Boolean`, `reason String?`, `adminId String?`, `createdAt` —
`schema.prisma:2711-2719`) is a record of *toggles*, not of AI events. It has never
been written because there has never been a toggle. §5.7 gives it one.


---

## SECTION 4 — Context model

### 4.1 The five dimensions

`ZuraContext` is server-constructed on every turn, extends the existing
`PlatformContext` (`context-builder.ts:11-20`), and is never accepted from a client.

| Dimension | Fields | Source | Trust |
| --- | --- | --- | --- |
| **Identity** | `actorType`, `actorId`, `authenticatedRole`, `displayName` (given name only), `chatSessionId` | The route's session resolver (`getRequestBuyer` / `getRequestDealer` / `getRequestAffiliate` / `getAdminFromRequest`); for public, the server-issued session handle (§5.4) | **Server-authoritative.** The only place identity is established. |
| **Location** | `surface` (six values), `pageLabel`, `entityRef?` (`{type, id}`) | `surface` is derived from the route the request arrived on. `pageLabel` and `entityRef` come from the client. | `surface`: server-authoritative. `pageLabel`/`entityRef`: **untrusted** — used only to choose suggestions and to *offer* a context line, and revalidated against ownership before any read (§4.4). |
| **Entity** | `journeyStage`, `activeAuction`, `activeDeal`, `prequal.approved`, `prequal.maxOtdCents`, dealer counts, affiliate status | `context-builder.ts` Prisma reads keyed on the server-resolved id | Server-authoritative |
| **Intent** | `listIntentsForActor(actorType)`, filtered by role (§5.5) and by activation | `catalog.ts:303` | Server-authoritative |
| **Authority** | `authenticatedRole`, activation state, approver permissions | Session + `activation.ts` + `approval-permissions.ts` | Server-authoritative, **and never sent to the model** |

### 4.2 The minimum passed to a model

The prompt projection is a deliberate narrowing, not a serialisation.

| Dimension | Goes into the prompt | Stays server-side |
| --- | --- | --- |
| Identity | Given name; actor kind ("you are speaking with a dealer") | Every id, email, phone, role token, session token |
| Location | `surface` as a human phrase; `pageLabel` if it matched a known label | Raw pathname; raw `entityRef` ids |
| Entity | Status labels, counts, dates, and the buyer's **own** approved OTD ceiling with its READ-ONLY framing | Record ids; any other party's PII; dealer identities during a live auction; **iPredict internals — the raw score and the tier label** (§1.3a) |
| Intent | Intent **names + descriptions** only, via `buildActorGuidance` (`guidance.ts:35`) | Zod parameter schemas, `canonicalService` paths, `approverPermission` values, activation keys |
| Authority | **Nothing.** | Everything. The model is never told what it is allowed to do, only what it may *name*. |

**Two PII removals versus today**, both from Phase 1 findings: the affiliate's email
address leaves the system prompt (`affiliate-concierge.agent.ts:35`, §D.7), and the
dealer prompt's claim to know the buyer's "approved max"
(`dealer-concierge.agent.ts:60`, §D.8) is deleted — it was never true and it invites
disclosure the moment buyer context is ever added.

**Hard rule: no record is ever dumped into a prompt.** The projection above is a
fixed set of scalar fields. There is no code path in this design that serialises a
Prisma row, a JSON blob, or a query result into prompt text.

### 4.3 How authoritative data is actually retrieved

When the model needs a record rather than a status label, it **proposes a READ
intent**. The proposal goes through the identical `authorize.ts` → `policy.ts` chain
as a mutation; the result is returned by a canonical service, formatted by the
service layer, and rendered with a source chip (§7.6).

**Four READ intents already exist and are AVAILABLE** — this is adoption, not creation:

| Intent | Returns | Catalog line |
| --- | --- | --- |
| `buyer.get_journey_status` | The authenticated buyer's **own** journey stage, active auction status, active deal status | `catalog.ts:44` |
| `dealer.get_auction_invitations` | The authenticated dealer's **own** open invitations and pending-offer counts | `catalog.ts:104` |
| `admin.get_platform_snapshot` | Aggregate platform counts. **No PII** (the catalog says so at `:148`) | `catalog.ts:146` |
| `affiliate.get_commission_summary` | The authenticated affiliate's **own** commission summary and payout history | `catalog.ts:238` |

Each takes `z.object({}).strict()` — **no parameters at all**. There is no id for a
model to guess and no field for an injected instruction to populate. That is the
strongest possible shape for a READ boundary and it already ships.

### 4.4 The `entityRef` rule

The panel knows which page it is on, which is what makes "Zura · your Highlander
auction" possible. That knowledge is client-supplied and therefore untrusted.

**Rule: `entityRef` may narrow, never widen.** It is used for exactly two things —
picking suggestion chips (§7.5) and rendering a context line — and both are cosmetic.
It is never a query parameter. A buyer who edits `entityRef` to another buyer's
auction id gets a wrong-looking header and nothing else, because every read still
goes through a zero-parameter READ intent scoped to the server-resolved actor. If a
future intent ever takes an entity id, `policy.ts` ownership evaluation
(`policy.ts:26-126`) is what admits it — not the header.

---

## SECTION 5 — Cross-portal security model

### 5.1 The principle

**Three enforcement points. None of them is the model.**

| # | Point | Owns | Existing code |
| --- | --- | --- | --- |
| 1 | **Route boundary** | Establishing identity. Building `ActorContext`. The only place a session becomes an actor. | `lib/auth/api.ts`, `lib/auth/admin-api.ts:15` |
| 2 | **Catalog + `authorize.ts`** | Admitting a capability. Six ordered, fail-closed gates: catalog membership → availability → actor match → role allowlist → Zod schema → per-`actor:intent` activation. | `authorize.ts:29-88` |
| 3 | **`policy.ts` + revalidation** | Ownership/IDOR, state preconditions, money preconditions — evaluated **twice**: at proposal, and again immediately before execution. | `policy.ts:26-126`; `engine.ts:288-307` |

The model sits entirely outside all three. Its maximum power is to emit a string
that names a catalog entry. Every path from that string to an effect is deterministic.

### 5.2 The four isolation rules and where each is enforced

| Rule | Enforced where | Mechanism |
| --- | --- | --- |
| **Public must not reach authenticated data** | Route boundary + catalog | The public surface's `ActorContext` has no `authenticatedRole` that appears in any catalog entry's `permittedRoles`, so **every** intent proposal from the public surface fails `authorize.ts:60` (`UNAUTHORIZED_ROLE`). The public surface's capabilities are prompt-only answers plus its own session's `BuyerOpportunity` — nothing else is constructible. |
| **Dealer must not reach another dealer's records** | `policy.ts` + zero-parameter READ | `dealer.get_auction_invitations` takes no parameters (`catalog.ts:108`), so there is no dealer id to substitute. `dealer.submit_offer` runs invitation-ownership policy. Prompt context is keyed on the server-resolved `dealer.id`. |
| **Affiliate must not reach finance or admin data** | Catalog, three times over | `affiliate.request_payout` is `UNAVAILABLE` (`catalog.ts:265`) → rejected at `authorize.ts:41` before any policy runs; `policy.ts` denies it again; `commands.ts` hard-fails. Its catalog description states the correct behaviour explicitly: recognise the request and direct the affiliate to the Finance Hub's own Request Payout button. **The self-serve rail stays live for the human; only the AI path is closed.** |
| **Admin remains bounded by the specific admin's role** | Catalog role allowlist + a new intent-slice filter | §5.5. |

### 5.3 The shared-entrypoint risk is removed, not managed

Phase 1 §D.9 found no escalation constructible today but named the shape: one
component serving five trust levels, with separation resting on a `chatEndpoint` /
`buyerId` prop pair — and identified the dormant `agentType` prop
(`ChatWidget.tsx:12,174`) as "exactly that selector, already on the wire".

**This design deletes the selector.** `agentType` is removed from the request body.
The surface is derived server-side from the route the request arrived on; the persona
is derived from server-resolved context. **A client can no longer name which brain
answers it.** That is the concrete answer to "a specialized agent must not leak broad
capability to a narrower caller through a shared entrypoint": there is no
client-controlled input that selects an agent, so there is nothing to leak through.

The one thing the client still supplies — `pageLabel` / `entityRef` — is cosmetic by
construction (§4.4).

### 5.4 Closing HIGH #1 — `/api/concierge:60`

The finding: anonymous, un-rate-limited, CSRF-exempt, no kill switch; creates
`VehicleRequest`s and writes CRM contacts with asserted consent.

| Defect | Closure | Reuses |
| --- | --- | --- |
| **No kill switch.** `lib/ai/acquisition.ts` calls Groq's REST endpoint directly and contains zero kill-switch references (§A.5) | Route both `streamConcierge` and `extractStructuredData` through `lib/ai/provider.ts`, which asserts once (§3.5) | New provider adapter — the same change that fixes 18 other modules |
| **No rate limit** | Two limits: `limitGeneral("zura:public:ip:" + clientIpKey(headers), { tokens: 20, window: "1 h" })` **and** a per-session turn cap. The first is the exact call `/api/public/ai/chat:22` already makes | `lib/security/rate-limit.ts:174,111` — existing, durable, shared across serverless instances |
| **CSRF-exempt** (`proxy.ts:280`) | **Keep the exemption.** Stated plainly: CSRF is not the control here. There is no authenticated session to protect, and removing the exemption would break the surface without closing anything. The control is the rate limit plus the session handle below. Recording this as a deliberate non-change rather than an omission. | — |
| **Client-minted `sessionId` is the only identity** (`ChatWidget.tsx:70`) | **Server-issued session handle.** Turn 1 returns an HMAC-signed, short-TTL opaque token; every later turn must present it. An attacker-chosen UUID no longer opens a session, so unlimited parallel sessions from one origin become bounded by the IP limit. | The existing HMAC pattern at `unsubscribe-token.service.ts:18-23,31` — `createHmac("sha256")` + `timingSafeEqual`, secret-optional with graceful degradation. **No new signing scheme.** |
| **Consent asserted from a client-only gate** (`route.ts:390-398`; gate at `ChatWidget.tsx:217-240`) | Server-side gate validation. `ContactService.upsertContact` sets `consentEmail`/`consentSms` **only** when the server itself validated a gate submission on that session id. The `ZURA_CONSENT_TEXT` provenance record (`route.ts:46`) is kept verbatim — it is already the right artifact; only its trigger becomes trustworthy. | Existing consent plumbing |
| **Unbounded promotion into the sourcing pipeline** (`route.ts:336`) | Three bounds, none of which rewrites `promoteOpportunity`: (a) promotion requires a server-verified gate; (b) a per-session promotion idempotency key so a replayed `after()` block cannot promote twice; (c) a per-IP daily promotion cap. | Existing `promoteOpportunity`; the repo's existing idempotency-key convention |

**A data-quality constraint that bounds what this surface can ever be used for.**
`contacts` is ~94% seed data — 375 rows, of which 351 share a single phone number
(§0.4 fact 5). The public Zura path is the **only** Zura capability in this design
that touches that table, and it only ever **writes** its own new contact. **No Zura
capability reads `contacts`** — not for lead scoring, not for CRM intelligence, not
for enrichment — and none is proposed. Any future capability that wants to would be
reading almost entirely one repeated test record, so the table must be cleaned before
it can inform anything. Recorded here so the constraint is visible at the one place
Zura and `contacts` meet.

**What is deliberately not done:** `promoteOpportunity` is **not** moved behind the
ActionIntent boundary. It is a working, tested intake path
(`promote-opportunity.test.ts`, `unified-intake-emit.test.ts`) driven by a
*deterministic* completeness decision (`decideIntakeTurnActions`), not by a free-form
model proposal. Routing it through `proposeIntent` would be a rewrite of something
that works, for no security gain — the gain comes from the six bounds above.

### 5.5 Admin role scoping (Phase 1 §D.4, MEDIUM)

Today `getAdminFromRequest` proves *an* MFA-verified active admin
(`lib/auth/admin-api.ts:15-27`) and the admin identity is not even passed to
`adminConciergeChat` (§A.3), so per-role scoping is not expressible.

Three changes:

1. **The actor carries the role.** `ActorContext.authenticatedRole` is one of the
   five admin roles, which `types.ts` already enumerates (`AuthenticatedRole`,
   `ADMIN_ROLES`). No new vocabulary.
2. **The intent slice is filtered by approver permission.** `listIntentsForActor("ADMIN")`
   returns all four admin intents to every admin today. The shared service filters
   it with the existing `approverRoleSatisfies` (`approval-permissions.ts:30`) so a
   `SUPPORT_ADMIN` **cannot even name** `admin.trigger_deposit_refund` (which
   requires `finance.refunds`). The model is never shown a capability its caller
   could not exercise — defence in depth, since `authorize.ts:60` would reject it
   anyway.
3. **The platform snapshot is role-scoped.** `admin.get_platform_snapshot` returns
   aggregates with no PII (`catalog.ts:148`), so the exposure is bounded today. The
   scoping matters for what comes next: the morning briefing already surfaces
   **compliance-sensitive** counts — Contract Shield `FAIL` and
   `OFAC_ESCALATED` prequals (`agents.ts:59-64`) — to any admin role. Those two
   counts are scoped to `COMPLIANCE_ADMIN` and `SUPER_ADMIN`.

### 5.6 Voice: an LLM label must not gate a real-world effect (Phase 1 §D.6, MEDIUM)

`callReason` selects a branch that can transfer a live call and dispatch a vehicle
request creating `User` + `Buyer` rows (§A.7). The transfer path is separately
flag-gated; the dispatch path is not.

**Design: the classification proposes, a deterministic check disposes.** Before
either effect, the handler re-derives the precondition from state rather than from
the label:

- **Transfer** — keeps `isTransferEnabled()`, and adds: business hours, a per-caller
  transfer cap, and a required explicit spoken confirmation captured as a distinct
  turn. The label alone never transfers.
- **Dispatch** — `dispatchVehicleRequest` requires the same completeness predicate the
  web path uses (`decideIntakeTurnActions`), evaluated over the collected fields, not
  over the label. Creating a `User` + `Buyer` on the strength of one classification
  is the actual defect; requiring the fields makes the label advisory.

**Not changed: `detectOptOutIntent`.** Phase 1 §D.6/§G.3 #8 established by reading
the handler that the deterministic keyword set runs first and the model can only
*widen* an opt-out, with a failure path returning `false`. That is correct and
fail-safe. It stays exactly as it is. Recorded so it is visibly a decision, not an
omission.

### 5.7 Closing HIGH #2 — `kill-switch.ts`

The finding: enforced on 1 of 19 model call paths, env-only, no admin control, and
its log table never written.

| Defect | Closure |
| --- | --- |
| **1 of 19 paths** | **Structural, not disciplinary.** One provider adapter, one `assertAiEnabled()` (§3.5). Enforced by a red-first test that no file outside `lib/ai/providers/` contains a model endpoint host or provider SDK constructor. Discipline that is not mechanically checked regresses; this is why the fix is a chokepoint and not a code-review rule. |
| **Env-only — a redeploy to flip** | **Two-tier switch.** `AI_KILL_SWITCH=true` stays as the hard, deploy-level stop that works when the database is down. A new `ai_kill_switch` `FeatureFlag` row is the soft, runtime stop. Resolution: `enabled = env !== "true" && !(await isKillFlagSet())`. |
| Fail direction | **A missing flag row means "not killed"** — `getFeatureFlag` returns `false` for an absent row (`admin-platform.service.ts:24-27`), which matches today's default exactly. A **database error** falls back to the env var alone and logs a warning. Framing the flag as a *kill* switch rather than an *enable* switch is what makes the absent-row default correct; an enable-flag would disable all AI on first deploy. |
| **No admin control** | One admin route (`POST /api/admin/ai/kill-switch`) restricted to `SUPER_ADMIN` + `OPERATIONS_ADMIN`, and one control on `/admin/ai`. It calls the existing `setFeatureFlag` (`admin-platform.service.ts:29`) — **no admin route sets a flag today** (`VERIFIED` §0.5 #4), so this is the first, and the pattern it establishes is the existing service, not a new one. |
| **`AiKillSwitchLog` never written** | `setAiKillSwitch(enabled, adminId, reason)` writes the `FeatureFlag` row **and** an `AiKillSwitchLog` row in one `prisma.$transaction`. The model's shape (`enabled`, `reason`, `adminId`, `createdAt` — `schema.prisma:2711-2719`) is exactly right and needs no change. It has been empty because there has never been a toggle; once there is one, every flip is recorded. |
| **Client-side check is inert** (Phase 1 §D.5) | `ChatWidget.tsx:6,72` and `app/admin/ai/page.tsx:10,18` both call `isAiEnabled()` from `"use client"` modules, where `process.env.AI_KILL_SWITCH` is `undefined` and the function always returns `true`. **Both calls are removed.** The widget renders from a server-passed prop and from the `AI_DISABLED` response code; the admin badge reads the server route. This is a UI-truthfulness fix — an operator is currently told "Active" when AI is disabled. |


---

## SECTION 6 — Action-risk model and routing matrix

### 6.1 The seven-class vocabulary, and how it meets the shipped three-value enum

The brief requires seven classes. The catalog ships three: `READ | LOW |
CONSEQUENTIAL` (`types.ts`, `Consequence`).

> **DECISION: do not widen `Consequence`. Add an optional additive `riskClass`
> field to `IntentDefinition`, defaulted from `consequence`.**

Widening `Consequence` would touch `authorize.ts`, `guidance.ts`, `policy.ts`,
`api-shape.ts` and ten test files, and every exhaustive switch over it, for **no
change in control flow** — the approval decision is driven by
`requiresHumanApproval` (`engine.ts:156`), not by the consequence label. The seven
classes are a *presentation and audit* vocabulary: they drive the badge on the
proposal card (§7.7), the sentence shown to the user, and the audit event's
`riskClass`. They must not be load-bearing for authorization, because a
security-relevant enum with seven arms is seven chances to miss a case.

| Class | Meaning | Default `Consequence` | Approval |
| --- | --- | --- | --- |
| **READ_ONLY** | Returns authoritative state. No write. | `READ` | None |
| **NAVIGATION** | Moves the user to a page. No state change of any kind. | `READ` | None |
| **ANALYSIS** | Produces text or a judgement from context. Persists nothing authoritative. | `READ` | None |
| **LOW_RISK_MUTATION** | A bounded, reversible write fully guarded by deterministic policy. | `LOW` | None |
| **CONSEQUENTIAL** | Changes business state, a compliance record, or a commercial commitment. | `CONSEQUENTIAL` | **Server-authoritative human approval** |
| **IRREVERSIBLE** | Money movement or a commitment that cannot be undone in-product. | `CONSEQUENTIAL` | **Server-authoritative human approval + typed confirmation** |
| **EXTERNAL_SIDE_EFFECT** | Reaches outside AutoLenis — SMS, email, a live phone transfer, dealer outreach. | `CONSEQUENTIAL` | **Server-authoritative human approval + suppression/consent check** |

### 6.2 The standing rule for high-consequence surfaces

Anything touching **money, payments, commissions, refunds, bulk communications, SMS
or email, e-sign, deal state, auction state, dealer termination, privacy deletion,
impersonation, or permissions** stays behind deterministic controls with explicit
confirmation, idempotency, audit, and authoritative result verification.

**Most of this is already true and does not need building** — recorded so the design
does not claim credit for existing safety:

| Requirement | Already enforced by |
| --- | --- |
| Explicit confirmation | `requiresHumanApproval` halts at `APPROVAL_REQUIRED` (`engine.ts:156-159`); `assertApprover` forbids SYSTEM approval outright (`:218`), enforces the declared RBAC permission for admin intents, and permits self-confirmation only for the same authenticated principal |
| Idempotency | `AiActionIntent.idempotencyKey @unique`; proposal collapse (`engine.ts:90-94`); CAS transitions (`prisma-store.ts`) |
| Audit | `auditLogRecorder` on every transition (`store.ts:135`) |
| Result verification | Revalidation immediately before execution (`engine.ts:288-307`), then the outcome is derived from the **command's return value**, never from model text |

**Capabilities that are permanently outside the AI boundary** (not in the matrix,
recorded so the exclusion is explicit): dealer termination, privacy/right-to-erasure
deletion, admin impersonation, permission and role changes, affiliate payout
execution, bulk communication sends, and e-signature envelope creation. None is in
the catalog today and none is added. **They are not "not yet"; they are "not".**

### 6.3 The routing matrix

37 rows. Column legend: **Ctx** = context required · **R/W** = read/write ·
**Authz** = where the authorization decision is made · **Confirm** = confirmation
required · **Verify** = how the result is verified.
`P1` = a Phase 1 registry section. **Bold** rows are new capabilities; all others
exist today in some form.

#### Public web (anonymous) — 5

| # | Capability | Risk | User / Portal | Ctx | Agent / capability | R/W | Authz | Confirm | Fallback | Verify |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Knowledge answer about AutoLenis | ANALYSIS | anon / public web | none | shared service + `ZURA_SYSTEM_PROMPT` | — | n/a (no data) | none | canned "I can't answer that — here's how it works" | n/a |
| 2 | Intake profile capture → `BuyerOpportunity` | LOW_RISK_MUTATION | anon / public web | session handle | `extractStructuredData` (P1 §A.5) | W (own session row) | Server-issued session handle (§5.4); row keyed to that session | none | keep the turn, skip the extraction | Row read back before the next turn |
| 3 | Promote opportunity → `VehicleRequest` + intake pipeline | EXTERNAL_SIDE_EFFECT | anon / public web | complete profile | `promoteOpportunity` (P1 §A.5) | W + external (dealer discovery, outreach) | Deterministic completeness predicate `decideIntakeTurnActions`; **not** a model decision | Server-verified lead gate (§5.4) | Opportunity stays un-promoted; retried on a later turn | Promotion idempotency key; `VehicleRequest` id returned |
| 4 | CRM contact upsert with consent | CONSEQUENTIAL | anon / public web | verified gate | `ContactService.upsertContact` | W (consent record) | **Server-validated gate only.** Consent is never defaulted | The gate submission itself | No contact written | `ZURA_CONSENT_TEXT` + IP stored as provenance (`route.ts:46`) |
| 5 | **Deep-link to a public page** | NAVIGATION | anon / public web | `surface` | shared service; allow-listed public routes only | — | Allow-list of public paths; no dynamic segments | none | plain text link | n/a |

#### Buyer — 7

| # | Capability | Risk | User / Portal | Ctx | Agent / capability | R/W | Authz | Confirm | Fallback | Verify |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | Knowledge answer, buyer-contextual | ANALYSIS | BUYER / buyer | identity + entity | shared service; buyer persona (P1 §A.1) | — | `getRequestBuyer` at the route | none | generic knowledge answer | n/a |
| 7 | `buyer.get_journey_status` | READ_ONLY | BUYER / buyer | identity | catalog `:44`; zero parameters | R (own only) | `authorize.ts` 6 gates → `policy.ts` ownership | none | fall back to prompt context; say it is unconfirmed | Rendered only with a source chip (§7.6) from the command's return value |
| 8 | Natural-language search interpretation | ANALYSIS | BUYER / buyer | query text | `interpretSearchQuery` (P1 §A.11) | — | Buyer session; filters are advisory, inventory API re-scopes | none | unfiltered search | Filters shown to the buyer before applying |
| 9 | **Deep-link to a buyer page** | NAVIGATION | BUYER / buyer | `surface`, `entityRef` | shared service; allow-listed `/buyer/*` routes | — | Allow-list; `entityRef` never becomes a query parameter (§4.4) | none | plain text | n/a |
| 10 | `buyer.create_vehicle_request` | CONSEQUENTIAL | BUYER / buyer | identity + parameters | catalog `:58` → `createVehicleRequest` | W | 6 gates → `policy.ts` (prequal/eligibility) → **`APPROVAL_REQUIRED`**, approver permission `crm.manage` | **Human approval at AutoLenis.** No in-chat execute | Escalate to human | `ProposalOutcome.COMPLETED` + the service's returned id |
| 11 | `buyer.select_offer` | **IRREVERSIBLE** | BUYER / buyer | identity + offer id | catalog `:82` → `commitOfferSelection` | W (deal commitment) | 6 gates → `policy.ts` (offer ownership, auction state, `$99` fulfillment gate) → `APPROVAL_REQUIRED` | **Human approval** + revalidation immediately before execution | Escalate to human | Deal id from the command; never the model's restatement |
| 12 | `system.escalate_to_human` | LOW_RISK_MUTATION | BUYER / buyer | identity + summary | catalog `:272` → admin support-ticket queue | W (ticket) | 6 gates; `permittedRoles` includes BUYER | none (it *is* the safe path) | log-only | Ticket reference shown to the buyer |

#### Dealer — 5

| # | Capability | Risk | User / Portal | Ctx | Agent / capability | R/W | Authz | Confirm | Fallback | Verify |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 13 | Knowledge answer, dealer-contextual | ANALYSIS | DEALER / dealer | identity + own counts | shared service; dealer persona (P1 §A.2) | — | `getRequestDealer` | none | generic answer | n/a |
| 14 | `dealer.get_auction_invitations` | READ_ONLY | DEALER / dealer | identity | catalog `:104`; **zero parameters** | R (own only) | 6 gates → `policy.ts` invitation ownership. No dealer id exists for a model to substitute | none | prompt context, marked unconfirmed | Source chip from the command result |
| 15 | **Deep-link to a dealer page** | NAVIGATION | DEALER / dealer | `surface` | allow-listed `/dealer/*` | — | Allow-list | none | plain text | n/a |
| 16 | `dealer.submit_offer` | CONSEQUENTIAL | DEALER / dealer | identity + offer terms | catalog `:118` → `submitOffer` | W (binding commercial commitment) | 6 gates → `policy.ts` (invitation ownership, auction ACTIVE) → `APPROVAL_REQUIRED` | **Server-authoritative confirmation** — the catalog description says so at `:120` | Escalate to human | Offer id from the command |
| 17 | `system.escalate_to_human` | LOW_RISK_MUTATION | DEALER / dealer | identity + summary | catalog `:272` | W (ticket) | 6 gates | none | log-only | Ticket reference |

#### Affiliate — 5

| # | Capability | Risk | User / Portal | Ctx | Agent / capability | R/W | Authz | Confirm | Fallback | Verify |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18 | Knowledge answer, affiliate-contextual | ANALYSIS | AFFILIATE / affiliate | identity + status | shared service; affiliate persona. **Email removed from the prompt** (§4.2) | — | `getRequestAffiliate` | none | generic answer | n/a |
| 19 | `affiliate.get_commission_summary` | READ_ONLY | AFFILIATE / affiliate | identity | catalog `:238`; zero parameters | R (own only) | 6 gates → `policy.ts` ownership | none | prompt context, marked unconfirmed | Source chip |
| 20 | **Deep-link to the Finance Hub** | NAVIGATION | AFFILIATE / affiliate | `surface` | allow-listed `/affiliate/*` | — | Allow-list | none | plain text | n/a |
| 21 | `affiliate.request_payout` | **IRREVERSIBLE** | AFFILIATE / affiliate | identity | catalog `:251` — **`UNAVAILABLE`** | **never executes** | Rejected at `authorize.ts:41`; denied again in `policy.ts`; hard-fails in `commands.ts`. **Triple defence.** | n/a — the AI may only *recognise* | **Direct the affiliate to the Finance Hub's own Request Payout button** (the human rail stays live) | n/a — nothing executes |
| 22 | `system.escalate_to_human` | LOW_RISK_MUTATION | AFFILIATE / affiliate | identity + summary | catalog `:272` | W (ticket) | 6 gates | none | log-only | Ticket reference |

#### Admin — 8

| # | Capability | Risk | User / Portal | Ctx | Agent / capability | R/W | Authz | Confirm | Fallback | Verify |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 23 | Knowledge answer, ops-contextual | ANALYSIS | 5 admin roles / admin | identity + role | shared service; admin persona (P1 §A.3) | — | `getAdminFromRequest` (JWT + MFA + `isActive`) | none | generic answer | n/a |
| 24 | `admin.get_platform_snapshot` | READ_ONLY | 5 admin roles / admin | identity + role | catalog `:146`; aggregates, **no PII** | R (aggregate) | 6 gates; **role-scoped** so compliance-sensitive counts are `COMPLIANCE_ADMIN`/`SUPER_ADMIN` only (§5.5) | none | prompt aggregates, marked unconfirmed | Source chip |
| 25 | Morning briefing on demand | ANALYSIS | 5 admin roles / admin | identity + role | `adminBriefingAgent` (P1 §A.10) — existing, ACTIVE | R (aggregate incl. Contract Shield FAIL, OFAC escalations) | Admin JWT + MFA; **counts role-scoped** (§5.5) | none | the `/admin/ai` page path still works | Text output; counts sourced from Prisma, not the model |
| 26 | **Deep-link to an admin page** | NAVIGATION | 5 admin roles / admin | `surface` | allow-listed `/admin/*` | — | Allow-list + role | none | plain text | n/a |
| 27 | `admin.advance_deal_status` | CONSEQUENTIAL | admin roles w/ `crm.manage` / admin | identity + role + deal id | catalog `:159` → `advanceDealStatus` | W (state machine) | 6 gates → `policy.ts` (deal state, transition legality) → `APPROVAL_REQUIRED`, `approverPermission: crm.manage` | **Typed confirmation in the approval queue**, never in the chat panel | Escalate | New `DealStatus` from the command |
| 28 | `admin.extend_auction` | CONSEQUENTIAL | admin roles w/ `crm.manage` / admin | identity + role + auction id | catalog `:195` → `requestExtension` | W (auction state) | 6 gates → `policy.ts` (auction ACTIVE, extension eligibility) → `APPROVAL_REQUIRED` | Typed confirmation in the queue | Escalate | New `endsAt` from the command |
| 29 | `admin.trigger_deposit_refund` | **IRREVERSIBLE** | `finance.refunds` holders only / admin | identity + role + deposit id | catalog `:216` → `processRefund` | W (**money out**) | 6 gates → `policy.ts` (deposit state, refund eligibility) → `APPROVAL_REQUIRED`, `approverPermission: finance.refunds`; **not nameable** by roles lacking it (§5.5) | Typed confirmation in the queue + revalidation immediately before execution | Escalate; never retried automatically | Stripe refund id from the command; integer minor units only |
| 30 | `system.escalate_to_human` | LOW_RISK_MUTATION | 5 admin roles / admin | identity + summary | catalog `:272` | W (ticket) | 6 gates | none | log-only | Ticket reference |

#### Public voice — 6

| # | Capability | Risk | User / Portal | Ctx | Agent / capability | R/W | Authz | Confirm | Fallback | Verify |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 31 | Spoken knowledge answer | ANALYSIS | anon caller / voice | call state | `handleVoiceTurn` + `ZURA_VOICE_PROMPT` (P1 §A.7) | — | Twilio HMAC at the transport (`twilio-verify.ts`) | none | Static TwiML fallback line | n/a |
| 32 | `callReason` classification | ANALYSIS | anon caller / voice | transcript | Second Groq extraction call (P1 §A.7) | — | n/a — **advisory only after §5.6** | none | Treat as unclassified; ask again | **Never gates an effect on its own** |
| 33 | Returning-caller recognition | READ_ONLY | anon caller / voice | caller phone | `buyer-lookup.service.ts` | R (first name + last vehicle interest) | Twilio HMAC. **Caller ID is spoofable** — so the read is limited to a given name and a vehicle interest, never account state | none | Greet as a new caller | n/a |
| 34 | Vehicle-request dispatch (creates `User` + `Buyer`, sends email) | CONSEQUENTIAL | anon caller / voice | collected fields | `dispatchVehicleRequest` | W + email | **Deterministic completeness predicate over the collected fields** (§5.6), not the `callReason` label | Spoken confirmation captured as its own turn | Take a message instead | Created buyer id; dedup on phone |
| 35 | Live call transfer | EXTERNAL_SIDE_EFFECT | anon caller / voice | call state | `call-transfer.service.ts` | external (live phone) | `isTransferEnabled()` (literal `"true"`) **+ business hours + per-caller cap + explicit spoken confirmation** (§5.6) | Explicit spoken confirmation | Take a message | Twilio call status callback |
| 36 | Founder message alert SMS | EXTERNAL_SIDE_EFFECT | anon caller / voice | message | `sendFounderMessageAlert` | external (SMS) | Twilio HMAC; internal recipient only | none (internal alert) | Log + email | Twilio message SID |

#### Cross-surface — 1

| # | Capability | Risk | User / Portal | Ctx | Agent / capability | R/W | Authz | Confirm | Fallback | Verify |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 37 | **Transcript persistence + AI audit write** | LOW_RISK_MUTATION | all actors / all six surfaces | identity + surface | `AiChatSession`/`AiChatMessage` (§1.1) + `recordAiEvent` (§3.6) | W (own transcript, own audit row) | Written by the shared service from the server-resolved actor. **Never from request input** | none | **Fail-open for the transcript, fail-loud for the audit**: a transcript write failure must not break the reply; an audit write failure is logged at error and alerted | Row ids returned to the service; not shown to the user |

### 6.4 Counts by risk class

| Risk class | Rows | Which |
| --- | --- | --- |
| **READ_ONLY** | **5** | 7, 14, 19, 24, 33 |
| **NAVIGATION** | **5** | 5, 9, 15, 20, 26 |
| **ANALYSIS** | **9** | 1, 6, 8, 13, 18, 23, 25, 31, 32 |
| **LOW_RISK_MUTATION** | **6** | 2, 12, 17, 22, 30, 37 |
| **CONSEQUENTIAL** | **6** | 4, 10, 16, 27, 28, 34 |
| **IRREVERSIBLE** | **3** | 11, 21, 29 |
| **EXTERNAL_SIDE_EFFECT** | **3** | 3, 35, 36 |
| **Total** | **37** | |

Of the 37, **6 are new** (rows 5, 9, 15, 20, 26 — the five navigation rows — plus row
37). The other 31 exist today in some form; the design changes where they are
authorized, audited and confirmed, not what they do.

**12 of the 37 (rows 3, 4, 10, 11, 16, 21, 27, 28, 29, 34, 35, 36) sit in the
CONSEQUENTIAL / IRREVERSIBLE / EXTERNAL_SIDE_EFFECT band.** Every one of them is
behind deterministic controls, explicit confirmation, idempotency, audit and
authoritative result verification — per §6.2. **None of them is enabled by the first
nine implementation increments** (§9.1); they are gated one intent at a time behind
their own activation key, after the read path is proven.


---

## SECTION 7 — Unified UX

### 7.0 Design posture — refactor the shell, do not rebuild it

`components/public/ChatWidget.tsx` is already the unification win: **one component
renders every web surface.** Phase 1's twelve inconsistencies (§B.7) are not
component problems, they are configuration and token problems. Replacing it would
throw away the only thing about Zura that is genuinely unified.

> **The component stays. Its transport, its tokens, its semantics and its states
> change.** Its file may move to `components/zura/` for discoverability; that is
> cosmetic and is not required.

Everything below is a **design proposal**, not an observation. Nothing here has been
rendered, and no claim about how it looks or measures on a real device appears in
this section — see §0.3 and §7.9.

**Source of truth for every value below:** `app/globals.css` `@theme`
(`--color-al-*` `:49-74`, `--radius-al-*` `:76-78`, `--shadow-al-*` `:80-82`,
`--font-display` `:36`, `--font-body` `:37`) and the promoted kit at
`components/admin/crm/ui/` (`Badge`, `Button`, `ConfirmDialog`, `DataTable`,
`EmptyState`, `ErrorState`, `Field`, `KpiCard`, `PageHeader`, `Skeleton`,
`SlideOver`, `Tabs`, `Toolbar`). **No raw hex appears in any proposal below** —
today the widget hard-codes `#0B5FD1` / `#0A4DB8` and raw `slate-*` in the one
component rendered on every page of every portal (`ChatWidget.tsx:247-427`).

### 7.1 Launcher

| Aspect | Today | Proposed |
| --- | --- | --- |
| Position / size | `fixed bottom-6 right-6 z-50`, 56×56 (`:247, :418-427`) | Unchanged geometry — it works |
| Colour | `bg-[#0B5FD1] hover:bg-[#0A4DB8]` | `bg-al-primary hover:bg-al-primary-hover`, `shadow-al-2` |
| Semantics | `aria-label="Open chat"` only | Adds `aria-expanded`, `aria-controls="zura-panel"`, `aria-haspopup="dialog"`. A screen-reader user currently cannot tell whether the panel is open |
| Focus | Browser default | Explicit `focus-visible` ring: `--color-al-focus`, 2px + 2px offset, per the spec's focus rule |
| Attention state | None | A single dot appears **only** when a proposal is awaiting the user (§7.7). Never for marketing, never for an unread greeting. One reason, one dot |
| Name | Panel says "Zura" on public, "AutoLenis" on all four portals (`:263`) | **"Zura" everywhere.** One brand, one name |
| Z-index | Literal `z-50` | A named step in a semantic scale (`--z-launcher` < `--z-panel` < `--z-confirm`), so the confirm dialog can never render behind the panel |

### 7.2 Panel

| Aspect | Today | Proposed |
| --- | --- | --- |
| Role | A plain `<div>` (`:250`) | `role="dialog"`, `aria-modal="false"`, `aria-labelledby` pointing at the header title. Non-modal because the user must be able to read the page while Zura talks about it |
| Focus | No focus move on open, no trap, no restore | Focus moves to the panel heading on open; Escape closes and **returns focus to the launcher**. A focus trap applies **only** in the confirmation step (§7.7), which is genuinely modal |
| Height | Inline `style={{ height: "520px" }}` (`:252`) with a 24px bottom offset — needs ≥604px of viewport, so a landscape phone overflows (Phase 1 §B.2 computed this from source) | `h-[min(520px,calc(100dvh-6rem))]`. `dvh` also absorbs mobile browser chrome, which `vh` does not |
| Mobile | One breakpoint (`w-80 sm:w-96`); no full-screen mode | Below `sm`: a bottom sheet — `inset-x-0 bottom-0 h-[85dvh] rounded-t-al-lg`, full width, `safe-area-inset-bottom` padding. This is the fix for the landscape overflow, not a cosmetic change |
| Surface | `bg-white border-slate-200 rounded-2xl shadow-2xl` | `bg-al-surface border-al-border rounded-al-lg shadow-al-3` |
| Header | `bg-[#0B5FD1]` | `bg-al-primary`, `text-al-primary-fg`, `font-display` for the name |

### 7.3 Contextual header

Two lines, and never more:

```
Zura
Your Highlander auction · 6 offers          ← context line, present only when there is context
```

- Line 2 is built from `ZuraContext.pageLabel` + `entityRef` (§4.4). When there is
  no context it is the portal name ("AutoLenis buyer portal"), and on the public
  surface it is the existing tagline.
- **The user never sees routing internals.** No agent name, no persona name, no
  model id, no intent id, no surface key. Phase 1 found the `/admin/ai` console
  advertising "7 agents" (`app/admin/ai/page.tsx:64`) — internals leaking into a UI
  is already a live defect here, not a hypothetical one.
- **One exception, and it is an owner decision (§9.3):** on the admin surface only, a
  small correlation-id chip. Its purpose is support — an admin quoting a chat to
  engineering needs a handle into the audit trail. It is a support affordance, not a
  routing internal, but the line is thin enough that the owner should draw it.

### 7.4 Conversation

| Aspect | Today | Proposed |
| --- | --- | --- |
| Announcement | The message list is a plain scrolling `div` (`:340-342`) with **no `role="log"` and no `aria-live`** — streamed replies are never announced | `<ul role="log" aria-live="polite" aria-relevant="additions text">` with each message an `<li>`. This is the single highest-impact accessibility change in the design: today a screen-reader user gets no indication a reply arrived |
| Bubbles | `bg-[#0B5FD1]` / `bg-slate-100` | `bg-al-primary` / `bg-al-primary-subtle` for user, `bg-al-bg` + `text-al-text` for assistant |
| Copy width | `max-w-[85%]` of a 320–384px panel | Unchanged — that lands well inside the 65–75ch guidance |
| Streaming caret | `animate-pulse` block (`:358`) | Unchanged. It is a live-region-friendly, non-layout animation |
| **Typing indicator** | Three dots with `animate-bounce` at `:371`, `:375`, `:379` — **flagged three times by the Impeccable detector** (§7.9) | Replace with a staggered **opacity** fade on the same three dots, easing `ease-out-quart`. Same affordance, no bounce, and it animates `opacity` rather than a layout property |
| Reduced motion | None anywhere in the component | `@media (prefers-reduced-motion: reduce)`: the caret and the dots become static; the panel opens without a transition |
| Empty state | Never occurs — a greeting is always seeded (`:51`) | Unchanged. The "Alex" fallback greeting (`:41`) is deleted (§8.5) |

### 7.5 Suggested actions

Chips below the last assistant message. **Two to three, never four or more** — a
decision point with more than four visible options is a cognitive-load failure, and
three is what fits a 320px panel without wrapping.

**Chips are prompts, not actions.** Tapping one sends that text as a user message. A
chip never executes anything, never proposes an intent directly, and never bypasses
the model. This matters: if chips could execute, the chip row would become a second,
unaudited action surface beside the ActionIntent boundary.

Every chip below maps to a capability Phase 1 verified as reachable, or to a
prompt-only answer. **None is aspirational.**

| Surface / state | Chips | Derived from |
| --- | --- | --- |
| Public web | "What does the $99 deposit cover?" · "How does the 48-hour auction work?" · "Help me find a car" | `ZURA_SYSTEM_PROMPT` content + intake capture (matrix rows 1, 2) |
| Buyer — `prequal-needed` | "What is prequalification?" · "Will it affect my credit?" · "What happens next?" | `context-builder.ts` `journeyStage`; prompt-only (row 6) |
| Buyer — `auction-active` | "How many offers so far?" · "When does my auction close?" · "How is Best Price ranked?" | `buyer.get_journey_status` (row 7, catalog `:44`) |
| Buyer — `deal-active` | "What's my next step?" · "What does the $499 fee cover?" · "What is Contract Shield?" | `context-builder.ts` `activeDeal`; rows 6–7 |
| Dealer | "Which invitations are open?" · "How is my offer ranked?" · "What flags a junk fee?" | `dealer.get_auction_invitations` (row 14, catalog `:104`) |
| Affiliate | "What have I earned?" · "When do payouts run?" · "Where do I request a payout?" | `affiliate.get_commission_summary` (row 19). The third chip routes to the Finance Hub (row 20) — the AI never requests the payout (row 21) |
| Admin | "Platform snapshot" · "Today's briefing" · "What needs attention?" | `admin.get_platform_snapshot` (row 24) + `adminBriefingAgent` (row 25). **Filtered by role** — an admin without `finance.refunds` never sees a refund-shaped chip (§5.5) |
| Voice | — | Spoken; no chips |

### 7.6 Source representation

**A factual claim about the user's own records is rendered with a source chip, and a
source chip is only rendered when the fact came from a READ intent's authoritative
result.**

```
Your auction closes Thursday at 4:12pm and has 6 offers.
  ⌁ From your auction · read just now
```

The chip is the visible half of "the model is never the enforcement boundary": **if
there is no chip, it is conversation, not data.** Text the model produced about the
user's records without a READ intent behind it gets no chip, which is exactly the
signal a user needs. It also makes a whole class of failure visible rather than
silent — today a buyer cannot distinguish a real auction status from a hallucinated
one, and neither can support.

The chip carries the intent's `title` from the catalog (e.g. "Read buyer journey
status", `catalog.ts:46`) in its tooltip — a description, never an intent id.

### 7.7 Action preview → confirmation → progress → outcome

This is the sequence with the highest stakes and it gets the most structure. All of
it composes from `components/admin/crm/ui/`; no new primitive is introduced.

**1 — Preview (`ProposalCard`).** When `extractProposal` returns a proposal, the
reply renders a card instead of a paragraph:

- **Title** — the catalog `title`, in plain language ("Submit a binding offer").
- **Risk badge** — the §6.1 class, via the kit's `Badge`. `CONSEQUENTIAL` uses
  `--al-warning`, `IRREVERSIBLE` uses `--al-danger`, reads and navigation use
  `--al-info`. **Never colour alone** — the badge always carries its label text, per
  the design system's status rule.
- **Parameters** — a labelled list, using the kit's `Field`. Money is rendered from
  integer minor units, formatted once.
- **The consequence sentence** — one sentence saying what will actually change,
  written per intent, not generated.
- **Nothing has happened yet**, stated explicitly. `guidance.ts` already forbids the
  model claiming a proposal is an action; the card says so in the UI too.

**2 — Confirmation.** Two shapes, and the split follows `engine.ts` exactly:

| Case | UI | Why |
| --- | --- | --- |
| `requiresHumanApproval: false` (LOW / READ) | An inline **Confirm** button in the card. One POST. | `assertApprover` permits self-confirmation for the same authenticated principal (`engine.ts:240`) |
| `requiresHumanApproval: true` (CONSEQUENTIAL / IRREVERSIBLE / EXTERNAL) | **No execute button in the chat panel at all.** The card renders the `APPROVAL_REQUIRED` state: "This needs a person at AutoLenis to approve it. I've queued it — reference `#…`." | A buyer-facing confirm button that executed a consequential intent would contradict `engine.ts:156-159`. The approval happens in the admin queue (§7.8), where the approver's permission is checked (`:229`) |
| An admin acting on their **own** permitted intent | Typed confirmation in the **approval queue page**, not in the chat panel | Keeps one approval surface. Two approval surfaces means two places to get `assertApprover` wrong |

**3 — Progress.** `EXECUTING` renders a single row with the intent title and an
indeterminate `Skeleton` shimmer, polling the intent by id. Buyer, dealer and
affiliate need a **scoped, read-only intent-status route** (new, minimal — the three
existing routes under `app/api/admin/action-intents/` are admin-only). It returns
`{ status, title, resultSummary }` for an intent the caller owns, and nothing else.

**4 — Success.** Rendered **only** from the authoritative `ProposalOutcome.result` —
never from the model's restatement, and never from the parameters that were
proposed. If the command returns a deal id, the card shows the deal id.

**5 — Failure.** The kit's `ErrorState` inside the card. The 13 `RejectionCode`
values (`types.ts`) each map to one written sentence:

| Code | Buyer/dealer/affiliate sees | Admin also sees |
| --- | --- | --- |
| `UNAVAILABLE_INTENT` | "That isn't something I can do — here's where you can do it yourself." | the code |
| `POLICY_DENIED` / `OWNERSHIP_DENIED` | "That doesn't look like it's yours, or the timing isn't right. Let me get a person." | the code + reason |
| `NOT_ACTIVATED` | "That's not switched on yet." | the code + activation key |
| `MALFORMED_PARAMETERS` | "I didn't catch enough detail — can you say that again with the specifics?" | the code + the Zod issues |
| …9 others | one sentence each | the code |

Non-admins never see a raw code; admins always do, because they are the ones who act
on it.

**6 — Retry.** Two distinct affordances, deliberately not one button:

- **Transport retry** — the model call failed (network, `AI_ERROR`, provider
  timeout). A "Try again" button re-sends **the same user message**. Safe: nothing
  was proposed.
- **Proposal retry — deliberately absent.** A rejected proposal is never re-proposed
  by a button. Reasons: `idempotencyKey` collapse means a replay returns the same
  record (`engine.ts:90-94`), so the button would appear to do nothing; and silently
  re-proposing after a `POLICY_DENIED` loops against a deterministic denial. The
  user restates, or escalates.

**7 — Agent handoff.** **There is no visible agent handoff, ever.** Persona changes
are invisible by design (§7.3). The only handoff a user ever sees is a human one —
`system.escalate_to_human` (matrix rows 12, 17, 22, 30) — which renders as an
explicit state with the ticket reference from the command result. That is the whole
handoff vocabulary: Zura, or a person.

### 7.8 History and the admin approval queue

**History.** With persistence (§1.1) the panel loads the last session's most recent
turns on open, with a date separator ("Earlier today"), and **one visible line the
first time a user opens the panel after the change ships**: *"Your conversations with
Zura are saved to your AutoLenis account."* Behaviour is changing from "nothing is
saved" to "saved", and a user finding that out later is a trust failure, not a
feature. The public lead gate's existing disclosure (`app/api/concierge/route.ts:46`)
gains one sentence to match. **Legal review item (§9.3).**

**Admin approval queue.** A new page at `/admin/action-intents`, composed entirely
from the kit — `PageHeader`, `Toolbar` (status filter), `DataTable`, `SlideOver` for
the detail, `ConfirmDialog` for approve/reject, `EmptyState`, `ErrorState`,
`Skeleton`. It renders `shapeIntentForAdmin` (`api-shape.ts`) over the three
**existing** routes. It is the missing human end of the boundary: without it an
`APPROVAL_REQUIRED` intent is unreachable and the design has a dead end.

Rows show: title, risk badge, actor, age, and the reason. Approve is a
`ConfirmDialog` requiring a typed reason for `IRREVERSIBLE` intents. The page never
offers approve to an admin whose role fails `approverRoleSatisfies` — and
`engine.ts:229` rejects it anyway if the UI is wrong.

### 7.9 Impeccable review of this section

**Command run:** `impeccable critique`, targeting
`frontend/components/public/ChatWidget.tsx` — the surface this section redesigns.
`critique` is the applicable command: it is the skill's UX-design-review command,
and unlike Phase 1 (where the target was a markdown file and Impeccable produced
zero findings, §G.1) there is real UI code in scope here.

> ⚠️ **DEGRADED: single-context (sub-agent dispatch not authorised in this session).**
>
> Impeccable's `critique` declares a hard invariant that Assessment A (design review)
> and Assessment B (detector + browser evidence) run as two isolated sub-agents, and
> requires this banner whenever they do not. This session's operating instructions
> prohibit dispatching sub-agents unless the user asks for them; the user asked for
> Impeccable, not for agents. I ran the assessments in this context and am declaring
> it rather than claiming a clean run. **Stated plainly per the brief's instruction,
> not substituted silently.**

**Setup (executed).** `node .claude/skills/impeccable/scripts/context.mjs --target
frontend/components/public/ChatWidget.tsx` → `NO_PRODUCT_MD`, `targetExists: true`,
`projectRoot: frontend`. Per SKILL.md step 1 this is a scoped command against
existing code, so the flow proceeds without `init`; existing code is the context.
Register: **product** (portal/app UI, design serves the product). Design system read
per step 3: `app/globals.css` `@theme` and `components/admin/crm/ui/`.

**Assessment B — detector (executed, real output).**

```
$ node .claude/skills/impeccable/scripts/detect.mjs --json \
    frontend/components/public/ChatWidget.tsx
exit 2 — 3 findings
```

| Finding | Severity | Location | Addressed by |
| --- | --- | --- | --- |
| `bounce-easing` — "Bounce and elastic easing feel dated and tacky… use exponential easing" | warning | `ChatWidget.tsx:371` | §7.4 — opacity fade, `ease-out-quart` |
| `bounce-easing` | warning | `ChatWidget.tsx:375` | §7.4 |
| `bounce-easing` | warning | `ChatWidget.tsx:379` | §7.4 |

The same detector over the four portal layouts (`app/{buyer,dealer,admin}/layout.tsx`,
`app/affiliate/portal/layout.tsx`) returned **exit 0, zero findings**. So the
typing indicator is the only mechanically-detectable anti-pattern in the Zura shell —
a narrower result than expected, and recorded as such rather than padded.

**Assessment B — browser evidence: NOT PERFORMED.** Egress is blocked (§0.3). No
overlay was injected, no screenshot taken, no rendered contrast measured. Per
Impeccable's own rule — "Do not claim a user-visible overlay exists unless script
injection succeeded" — nothing is claimed.

**Assessment A — design review, against the current widget.** Nielsen heuristics,
scored 0–4 on the **current** component (the baseline this section proposes to fix):

| Heuristic | Score | Note |
| --- | --- | --- |
| Visibility of system status | 2 | Typing indicator and streaming caret are good; no announcement to assistive tech (`:340`); no indication whether a request is queued or failed beyond a text bubble |
| Match with the real world | 3 | Copy is warm and plain |
| User control and freedom | 1 | No Escape-to-close, no focus restore, no way to retry a failed turn, no way to stop a stream |
| Consistency and standards | 1 | Two names ("Zura"/"AutoLenis", `:263`), a third in dead code ("Alex", `:41`); raw hex against a token system; three page grounds for one shell |
| Error prevention | 2 | Lead-gate validation is client-only (`:217-240`) |
| Recognition over recall | 2 | No suggestions; the user must know what to ask |
| Flexibility and efficiency | 2 | No history, no keyboard shortcut to open |
| Aesthetic and minimalist design | 3 | The panel is clean; the bounce indicator is the weak note |
| Help users recover from errors | 1 | Three separate fallbacks (`:110`, `:151`, generic) all render as an indistinguishable assistant bubble, with no retry affordance |
| Help and documentation | 2 | Knowledge is in the prompt, not the UI |

**AI-slop verdict on the current widget: no.** It is a conventional, competently
built chat panel. Its problems are consistency and semantics, not taste — which is
why §7.0 refactors rather than rebuilds.

**Cognitive load:** the only decision point is the chip row this section adds, capped
at three (§7.5), under the >4 threshold.

**Findings applied to the proposal, and downgrades made.** Three claims in an earlier
draft of this section were unsupported and were changed:

| # | Draft claim | Resolution |
| --- | --- | --- |
| 1 | Stated contrast ratios for the proposed bubble colours as if measured | **Downgraded.** No contrast was measured in this session. The section now specifies **tokens** whose ratios are carried by `AUTOLENIS_UI_SPEC.md`, and §7.10 lists ratio verification as Phase 3 work. |
| 2 | Asserted the mobile bottom sheet "fixes overflow on all devices" | **Downgraded** to what is derivable from source: `dvh` + `min()` removes the fixed-520px assumption that Phase 1 computed as overflowing below ~600px of viewport height. Real-device behaviour is `NOT VERIFIED`. |
| 3 | Described the source chip as "showing users when Zura is accurate" | **Corrected.** A chip proves *provenance*, not accuracy. §7.6 now says a chip means the fact came from an authoritative read, and its absence means the text is conversation. |

**Not adopted from Impeccable, with reasons.** The skill's brand-register guidance
(bolder palettes, drenched colour, display type) targets marketing surfaces.
`autolenis-ui-design-system` is rank-1 authority here and forbids introducing a
palette outside the `al-*` tokens; the product register applies, and identity
preservation wins over novelty. Recorded so the divergence is visible.

### 7.10 What this section does NOT establish

- **No contrast ratio was measured.** Every colour is specified as a token; the
  ratios live in `AUTOLENIS_UI_SPEC.md` and must be re-verified against the rendered
  panel in Phase 3. `NOT VERIFIED`.
- **No rendered layout was observed** at any viewport, on any device. Every layout
  statement is arithmetic from source or a proposal. `NOT VERIFIED`.
- **No screen reader was exercised.** The `role="log"` / `aria-live` proposal is a
  design decision against WCAG 2.2 AA, not a tested outcome. `NOT VERIFIED`.
- **No visual regression baseline exists** — Phase 1 §B.7 #12 found no test coverage
  for `ChatWidget` or any chat route. `pnpm test:visual` must gain one before the
  refactor lands (§9.2).


---

## SECTION 8 — Before → after capability map

**Nothing that works today silently disappears.** Every row states `Preserved:
YES`/`NO`, and every `NO` is justified in §8.5. Columns: current location · current
implementation · proposed connection · proposed location · authorization · side
effects · preserved · test required. `P1 §x` cites the Phase 1 registry.

### 8.1 The six Zura surfaces

| Surface | Current location | Current implementation | Proposed connection | Proposed location | Authorization | Side effects | Preserved | Test required |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public web (P1 §A.5) | `app/api/concierge/route.ts:60` | Streaming `text/plain`; `CONCIERGE_SYSTEM_PROMPT`; 2 direct Groq calls; no kill switch, no rate limit, no audit | Route becomes thin; calls the shared service; streaming transport retained | `lib/services/ai/zura-chat.service.ts` + existing route | Server-issued session handle (§5.4); no catalog intent is constructible | LLM ×2; `BuyerOpportunity`; promotion; CRM contact; domain event — **all retained** | **YES** | Anonymous flood → 429; forged session handle → 401; consent not written without a server-seen gate; double promotion → one `VehicleRequest`; kill switch stops the stream |
| Public voice (P1 §A.7) | `lib/voice/handle-turn.ts:472` | Groq reply + Groq extraction + Whisper + ElevenLabs; own store; TwiML | Shares prompt core, provider adapter, kill switch, audit. Keeps its own handler and transport | unchanged file | Twilio HMAC + §5.6 deterministic re-checks | SMS, email, live transfer, `User`+`Buyer` creation — retained, newly gated | **YES** | `callReason` alone never transfers or dispatches; completeness predicate gates dispatch; kill switch stops the turn |
| Buyer (P1 §A.1) | `app/api/buyer/ai/chat/route.ts:9` | `buyerConciergChat`; `ZURA_SYSTEM_PROMPT` + prefix; `BuyerActivityEvent` breadcrumb | Thin route → shared service | shared service | `getRequestBuyer` (unchanged) | Groq call; breadcrumb (retained); **+ transcript + audit** | **YES** | Buyer cannot reach dealer/admin context; prompt contains no `tier`; transcript written; audit row written |
| Dealer (P1 §A.2) | `app/api/dealer/ai/chat/route.ts:9` | `dealerConciergeChat`; inline prompt without `ZURA_SYSTEM_PROMPT`; no audit | Thin route → shared service; adopts `ZURA_SYSTEM_PROMPT` + dealer persona | shared service | `getRequestDealer` (unchanged) | Groq call; **+ transcript + audit** | **YES** | Dealer A cannot read dealer B; the "approved max" prompt line is gone; `_count.invitations` counts open invitations, not all-time (P1 §A.2 defect) |
| Affiliate (P1 §A.4) | `app/api/affiliate/ai/chat/route.ts:9` | `affiliateConciergeChat`; inline prompt; **email in the system prompt** | Thin route → shared service | shared service | `getRequestAffiliate` (unchanged) | Groq call; **+ transcript + audit** | **YES** | Affiliate email absent from the prompt; missing affiliate row degrades instead of throwing (P1 §A.4 defect) |
| Admin (P1 §A.3) | `app/api/admin/ai/chat/route.ts:9` | `adminConciergeChat`; inline prompt; platform-wide aggregates; **`ADMIN_AI_CHAT` audit** | Thin route → shared service; admin identity + role now passed | shared service | `getAdminFromRequest` + **role scoping** (§5.5) | Groq call; `AdminAuditLog` row (**unchanged**); **+ transcript + AI audit row** | **YES** | `SUPPORT_ADMIN` sees a narrower intent slice; `ADMIN_AI_CHAT` row still written; compliance counts role-scoped |

### 8.2 The specialized agents

| Agent | Current location | Current implementation | Proposed connection | Proposed location | Authorization | Side effects | Preserved | Test required |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Buyer concierge | `buyer-concierge.agent.ts:100` | ACTIVE, direct import by one route | Becomes a prompt-composition input to the shared service | same file, called by the service | route-level | Groq call | **YES** | Prompt composition per surface |
| Dealer concierge | `dealer-concierge.agent.ts:72` | ACTIVE | same | same | route-level | Groq call | **YES** | as above |
| Admin concierge | `admin-concierge.agent.ts:51` | ACTIVE; **no admin identity passed** (`:51`) | Signature gains `adminId` + `role` | same | route-level + role | Groq call | **YES** | Role-scoped aggregates |
| Affiliate concierge | `affiliate-concierge.agent.ts:60` | ACTIVE | same | same | route-level | Groq call | **YES** | Email absent from prompt |
| `buyerConciergeAgent` (roster) | `agents.ts:10` | DORMANT | Guardrail text merged into the buyer persona | `context-builder.ts` + persona module | — | — | **YES (text)** | Persona text present in the composed prompt |
| `prequalAdvisorAgent` | `agents.ts:17` | DORMANT | Guardrail merged, **scoped**: iPredict internals excluded, buyer's own ceiling retained (§1.3a) | as above | — | — | **YES (text)** | Prompt contains no `tier`; contains the ceiling with READ-ONLY framing |
| `searchAdvisorAgent` | `agents.ts:24` | DORMANT | Guardrail merged | as above | — | — | **YES (text)** | "cannot guarantee availability or pricing" present |
| `auctionAdvisorAgent` | `agents.ts:32` | DORMANT | Guardrail merged | as above | — | — | **YES (text)** | "never reveal dealer identities during a live auction" present |
| `dealAdvisorAgent` | `agents.ts:39` | DORMANT | Guardrail merged | as above | — | — | **YES (text)** | Stage language present when a deal is active |
| `dealerAdvisorAgent` | `agents.ts:46` | DORMANT | Guardrail merged into the dealer persona | as above | — | — | **YES (text)** | Scorecard/tier framing present |
| `adminBriefingAgent` | `agents.ts:54` | **ACTIVE** — two entrypoints (admin route + cron) | Unchanged as an agent; also becomes matrix row 25 | same file | admin JWT+MFA / cron secret | Groq call; cron emails the briefing | **YES** | Both entrypoints still work; compliance counts role-scoped on the interactive path |
| `routeToAgent` | `agents.ts:87` | DORMANT **and defective** (§1.3a) | **RETIRED as a dispatcher** | — | — | — | **NO** — see §8.5 #3 | A test asserting no module imports `routeToAgent` |

### 8.3 Supporting AI modules and DB models

| Item | Current | Proposed | Preserved | Test required |
| --- | --- | --- | --- | --- |
| `lib/ai/groq-client.ts:37` `groqChat` | ACTIVE; 2 hard-coded models (`:8-9`); kill switch at `:41` | Becomes the Groq **adapter** under `lib/ai/providers/`; fallback chain retained verbatim | **YES** | Fallback fires on 429/rate_limit/overloaded; kill switch throws |
| `groqChatStream` (`:81`) | DORMANT — only importer is the dormant `agents.ts` | Becomes the streaming path of the Groq adapter, used by the public surface | **YES** — newly reachable | Stream carries tokens; kill switch stops it |
| `lib/ai/kill-switch.ts:5,11` | PARTIAL — 1 of 19 paths; env-only | Two-tier (env + `FeatureFlag`), asserted once in the provider adapter, logged to `AiKillSwitchLog` | **YES**, strengthened | §5.7 tests |
| `lib/ai/context-builder.ts:22,67,76,81` | DORMANT | **ADOPTED**, extended with AFFILIATE, richer DEALER, and `location` | **YES** | Per-actor context shape; no cross-actor read |
| `lib/services/ai/ai-moderation.service.ts` | DORMANT — zero importers | **Left dormant.** Input moderation is not in this design's scope and inventing a use for it would be speculative. `logAiKillSwitchEvent` there is superseded by §5.7's transactional write | **YES (untouched)** | — |
| `lib/services/ai/context-cache.service.ts` | DORMANT — zero importers | **RETIRED with its model** (§1.1) | **NO** — §8.5 #4 | — |
| `lib/social/carousel.generator.ts:139` | DORMANT | Untouched; moves onto the provider adapter if ever reached | **YES** | — |
| Whisper STT / ElevenLabs TTS / call transfer | ACTIVE | Move onto the provider adapter (STT); TTS and transfer unchanged | **YES** | Kill switch reaches STT |
| `AiChatSession` / `AiChatMessage` | Zero rows, no code | **ADOPTED**, extended to a polymorphic actor + a `Buyer` FK + `surface` (§1.1) | **YES** | Transcript per surface; deletion cascade; retention drain |
| `AiConversationContext` / `AiContextCache` | Zero rows, duplicated | **RETIRED as targets**; `DROP` is an owner decision | **NO** — §8.5 #4 | — |
| `AiKillSwitchLog` | Zero rows, never written | **ADOPTED** — written on every toggle (§5.7) | **YES** — newly reachable | A toggle writes exactly one row |
| `AiActionIntent` | Reachable, but nothing can create a row | **WIRED** — `extract.ts` gives it an input (§2) | **YES** | Propose → approve → execute end to end |
| `AiMediaGeneration` | Zero rows; written by the social image path (P1 §A.16) | Untouched; provider adapter only | **YES** | — |
| `conversations`, `conversation_messages`, `acquisition_conversations` | Zero rows; `conversations` is the **CRM inbox shape**, not AI (§0.4 fact 2) | **Not a target of any Zura persistence.** Explicitly excluded | **YES (untouched)** | A test asserting no Zura code writes `prisma.conversation` |

### 8.4 Non-Zura AI capabilities

| Capability | Current | Proposed | Preserved | Test required |
| --- | --- | --- | --- | --- |
| CRM Copilot (P1 §A.9) | ACTIVE; `ai.use` permission; real approve boundary; audited; **no kill switch** | Stays separate (§3.3 row 8). Gains the provider adapter + unified AI audit. `ai.use` resolves to all five admin roles — **flagged, not changed here** (owner decision §9.3) | **YES** | Kill switch stops generation; approve route still the only persistence path |
| Admin morning briefing (P1 §A.10) | ACTIVE; 2 entrypoints | Also matrix row 25; compliance counts role-scoped | **YES** | Both entrypoints; role scoping |
| Search interpreter (P1 §A.11) | ACTIVE; kill switch enforced **twice** | Matrix row 8. Unchanged | **YES** | Existing `test:buyer-search` still green |
| AMIPS narrative (P1 §A.12) | ACTIVE; kill switch enforced | Stays separate (§3.3 row 9); provider adapter + AI audit | **YES** | Kill switch; audit row |
| AMIPS page generator (P1 §A.13) | PARTIAL | Provider adapter only | **YES** | — |
| SEO article generator (P1 §A.14) | ACTIVE; cron-driven; quality + compliance gates | Provider adapter only. Gates untouched | **YES** | Gates still block |
| Social engines ×6 (P1 §A.15–A.19) | ACTIVE; **kill switch NOT enforced** on any | Provider adapter → kill switch now reaches all six. Approve/publish boundaries untouched | **YES** | Kill switch stops each of the six |
| Dealer-recruitment AI ×3 (P1 §A.23) | ACTIVE; no kill switch; Gemini + Groq | Provider adapter. **Outreach enablement is untouched and remains an owner decision** per `autolenis-dealer-outreach-governance` | **YES** | Kill switch stops each; no outreach behaviour change |
| Acquisition cluster (P1 §A.24) | ACTIVE; no kill switch; 4 providers | Provider adapter | **YES** | Kill switch reaches `scoreLeadWithGroq`, Gemini Maps, compound search, the Anthropic SMS drafter |
| `detectOptOutIntent` (P1 §A.24) | ACTIVE; **correctly built** — deterministic keywords first, model widens only | **Unchanged.** Moves onto the provider adapter; the widening-only semantics and the `false` failure path are preserved exactly | **YES** | Keyword check still runs first; model failure leaves the keyword result standing; **with AI disabled, STOP still works** |
| `/admin/ai` console (P1 §B.5) | ACTIVE page with **3 defects**: a selector matching nothing (`:45`), a false provider claim (`:62`, `:104`), a false "7 agents" claim (`:64`) | Selector fixed to `open-chat-btn` (`ChatWidget.tsx:422`); provider list rendered from the `ModelId` union; agent count removed; kill-switch control added (§5.7) | **YES**, corrected | The selector resolves; the provider list matches the union; the badge reflects real server state |
| `VehicleFinder` component (P1 §A.22) | DORMANT — no page imports it; posted to `/api/concierge` | Untouched. Recommend the owner delete it (§9.3) | **YES (untouched)** | — |
| `/api/public/ai/chat` (P1 §A.6) | DORMANT; the **best-guarded** public route | Guarantees lifted into the shared service (§1.3b); **retire recommended** (owner decision) | **YES (guarantees)** / route: see §8.5 #5 | Rate limit, caps and history sanitisation present in the shared service |
| `/api/finder` (P1 §A.21, §D.3) | **Deleted in PR #375** (§0.4 fact 7) | Out of scope; not restored, not folded | n/a | — |

### 8.5 What is NOT preserved, and why

Ten items. Every one is either dead, defective, or a security liability.

| # | Removed | Why | Risk of removal |
| --- | --- | --- | --- |
| 1 | The `agentType` prop on the wire (`ChatWidget.tsx:12,174`; `app/api/buyer/ai/chat/route.ts:39`) | **It routes nothing today** — it is written to activity-event metadata and discarded. It is the client-supplied agent selector Phase 1 §D.9 named as the latent escalation shape. | None. The metadata field is replaced by the server-derived `surface`, which is strictly more trustworthy. |
| 2 | The `"Hi! I'm Alex, your AutoLenis concierge."` fallback greeting (`ChatWidget.tsx:41`) | A second persona name in a one-brand product. Masked today only because all four layouts pass `initialGreeting`; it surfaces the moment one does not. | None — it is unreachable today. |
| 3 | `routeToAgent` **as a dispatcher** (`agents.ts:87`) | Defective (no `admin` case, no `affiliate` case; `"admin"` silently becomes a buyer context — §1.3a) and it dispatches on a client string. **Its seven personas' guardrail text is fully preserved** (§8.2). | None — zero callers. |
| 4 | `AiConversationContext` + `AiContextCache` **as design targets**, and `context-cache.service.ts` | Duplicated pair, buyer-only, zero rows, zero importers. A rolling summary is a scale optimisation with nothing to optimise at 16 buyers. | None. **The `DROP TABLE` is an owner decision** (§9.3) — this design only stops targeting them. |
| 5 | `/api/public/ai/chat` **as an endpoint** | Once its four guarantees live in the shared service it is a publicly-POST-able route with no UI, no persistence, and a header comment that misdescribes it. | **Guarantees are preserved** (§1.3b). Deletion is an owner decision (§9.3); until then it simply has no reason to exist. |
| 6 | `isAiEnabled()` calls in `"use client"` modules (`ChatWidget.tsx:6,72`; `app/admin/ai/page.tsx:10,18`) | They **never worked** — the env var is not `NEXT_PUBLIC_*` and `next.config.mjs` declares no `env` block, so the function always returns `true` in the browser. The admin badge currently lies to an operator. | None. Server enforcement is unchanged; the UI starts telling the truth. |
| 7 | Direct model-endpoint calls in 18 modules | Replaced by the provider adapter. **Every prompt, model id, temperature, token cap, and behaviour is preserved** — only the transport line changes. | Low, and mechanically checkable: a red-first test asserts no model endpoint host outside `lib/ai/providers/`. |
| 8 | The dealer prompt's "you know the approved max" line (`dealer-concierge.agent.ts:60`) | It was never true — the assembled context contains no buyer data — and it invites disclosure the moment buyer context is ever added. Dealer isolation should hold by rule, not by accident. | None. |
| 9 | The affiliate's email in the system prompt (`affiliate-concierge.agent.ts:35`) | PII into a prompt with no redaction and no functional need; the affiliate's identity is already server-resolved. | None — the agent already knows who it is talking to. |
| 10 | `ctx.prequal.tier` in the buyer prompt projection (`context-builder.ts:103`) | It is an iPredict internal, and the prequal persona explicitly forbids exposing iPredict specifics. **The buyer's own approved ceiling stays**, with its READ-ONLY framing. | None. |


---

## SECTION 9 — Implementation sequence, tests, owner decisions

### 9.1 Sequence — twelve increments, smallest risk first

Each is independently shippable and independently verifiable. **No increment
enables a CONSEQUENTIAL, IRREVERSIBLE or EXTERNAL_SIDE_EFFECT capability until
increment 11.**

| # | Increment | Risk | Depends on | Independently verifiable by |
| --- | --- | --- | --- | --- |
| **0** | **Truth fixes.** Fix the `/admin/ai` console's dead selector (`:45` → `open-chat-btn`), its false provider claim (`:62`, `:104`), and its "7 agents" claim (`:64`). Remove `isAiEnabled()` from both client modules. **No behaviour change.** | Lowest | — | The selector resolves to a real element; no `"use client"` module imports `kill-switch` |
| **1** | **Provider adapter.** `lib/ai/providers/{groq,gemini,anthropic,openai}.ts` + `lib/ai/provider.ts#complete()`. Migrate all 19 call sites' transport, preserving every prompt, model and fallback. | Medium — touches many files, changes no logic | 0 | The endpoint-host test goes red→green; every existing AI test suite stays green |
| **2** | **Structural kill switch.** `assertAiEnabled()` asserted once in `complete()`. | Low, given 1 | 1 | `AI_KILL_SWITCH=true` makes all 19 paths throw |
| **3** | **Runtime kill switch + `AiKillSwitchLog`.** `ai_kill_switch` flag, `setAiKillSwitch()`, admin route (`SUPER_ADMIN` + `OPERATIONS_ADMIN`), console control. | Low | 2 | A toggle writes one `FeatureFlag` row + one `AiKillSwitchLog` row; a DB error falls back to env; an absent row means enabled |
| **4** | **Unified AI audit.** `recordAiEvent()` → `audit_logs`, called on every AI turn on all six surfaces. Admin trail untouched. | Low | 1 | One AI-audit row per turn per surface; `admin_audit_logs` count unchanged for admin turns |
| **5** | **`/api/concierge` hardening.** Rate limit, server-issued session handle, server-verified lead gate, promotion cap + idempotency. | Medium — changes a live public path | 1, 2 | Anonymous flood → 429; forged handle → 401; no consent without a server-seen gate; replay → one `VehicleRequest` |
| **6** | **Shared chat service.** `zura-chat.service.ts` + extended `context-builder.ts`; five routes become thin; `agentType` leaves the wire; persona guardrails adopted; PII removals (§8.5 #8, #9, #10). | Medium | 1–4 | Per-surface prompt composition snapshots; cross-actor isolation tests; PII-absence tests |
| **7** | **Conversation persistence.** Schema change (**owner-gated**): polymorphic actor, `Buyer` FK, `surface` column. Transcript writes + retention drain. | Medium — a migration | 6, owner approval | Transcript per surface; account deletion cascades; the drain removes >90-day rows |
| **8** | **ActionIntent wiring, READ intents only.** `extract.ts`; production activation via `featureFlagActivationResolver`; activate the four READ intents **one at a time**. `ProposalCard` + source chips. | Medium — first AI→business connection, but read-only | 6, 7 | The extractor cannot set the actor (type-level + runtime); a buyer proposing an admin intent → `UNAUTHORIZED_ACTOR`; a READ result renders with a chip |
| **9** | **Admin approval queue page.** Composed from the CRM kit over the three existing routes. | Low | 8 | Role scoping; approve/reject; no self-approval; `assertApprover` rejects a wrong-role approver even when the UI offers it |
| **10** | **UX unification.** Tokens, dialog semantics, mobile sheet, `aria-live`, motion fix, chips, error/retry states. | Low–medium | 6 | Visual regression baseline; detector exit 0; axe pass; the three `bounce-easing` findings gone |
| **11** | **CONSEQUENTIAL intents, one at a time.** Each behind its own activation key, each with its own approval-path test. **`IRREVERSIBLE` (`admin.trigger_deposit_refund`, `buyer.select_offer`) last, and only after a money-path review.** | **Highest** | 0–10 all green | Per-intent: propose → `APPROVAL_REQUIRED` → approve → revalidate → execute → `COMPLETED`; and the negative path for every rejection code |
| **12** | **Voice determinism.** `callReason` becomes advisory; completeness predicate gates dispatch; transfer gains hours + cap + spoken confirmation. | Medium — a live phone path | 1, 2 | A misclassified label alone neither transfers nor dispatches |

### 9.2 Regression tests Phase 3 must write red-first

Grouped by increment. Every one must fail against `3ccd513` before its increment
lands. **Phase 1 §B.7 #12 found zero test coverage for `ChatWidget` or any chat
route** — this list is the whole of it.

**Increment 0–2 (provider + kill switch)**
1. No file outside `lib/ai/providers/` contains a model endpoint host (`api.groq.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`, `api.openai.com`) or a provider SDK constructor.
2. `AI_KILL_SWITCH=true` → every one of the 19 AI paths throws or returns `AI_DISABLED`.
3. No `"use client"` module imports `lib/ai/kill-switch`.
4. The `/admin/ai` provider list equals the `ModelId` union.
5. `[data-testid='open-chat-btn']` resolves from the admin console's handler.
6. The Groq adapter falls back `120b → 20b` on 429/rate_limit/overloaded, and reports which model answered.

**Increment 3 (runtime switch)**
7. A toggle writes exactly one `FeatureFlag` row **and** one `AiKillSwitchLog` row, transactionally.
8. An absent `ai_kill_switch` row means AI enabled (today's default preserved).
9. A `FeatureFlag` read failure falls back to the env var and logs a warning — it does not disable AI silently, and it does not enable it when env says off.
10. A non-`SUPER_ADMIN`/`OPERATIONS_ADMIN` admin cannot toggle.

**Increment 4 (audit)**
11. Every AI turn on each of the six surfaces writes exactly one `audit_logs` row with the correct actor shape.
12. An admin AI turn still writes its `admin_audit_logs` row — the existing trail does not regress.
13. The AI audit row contains message **length**, never message **content**.

**Increment 5 (`/api/concierge`)**
14. 21 anonymous turns in an hour from one IP → the 21st is 429.
15. A `sessionId` not issued by the server → rejected.
16. `consentEmail`/`consentSms` are not written when the server never validated a gate submission for that session.
17. A replayed `after()` block produces one `VehicleRequest`, not two.
18. `AI_KILL_SWITCH=true` → the stream returns `AI_DISABLED` rather than tokens.

**Increment 6 (shared service)**
19. A buyer actor cannot produce a dealer or admin context (assert on the composed prompt).
20. The affiliate prompt contains no `@`-bearing string.
21. The buyer prompt contains no prequal `tier` and no iPredict score, and **does** contain the approved ceiling with its READ-ONLY framing.
22. The dealer prompt contains no "approved max" claim.
23. A request body carrying `agentType` changes nothing about which agent answers.
24. Each of the seven adopted persona guardrail strings appears in the composed prompt for its surface and state.

**Increment 7 (persistence)**
25. A turn on each of the six surfaces writes one `AiChatSession` (or reuses it) and two `AiChatMessage` rows.
26. Deleting a buyer deletes their transcripts (FK cascade).
27. The retention drain removes rows older than 90 days and nothing newer.
28. A transcript write failure does not fail the reply (fail-open), while an audit write failure alerts (fail-loud).
29. No Zura code path writes `prisma.conversation` (the CRM inbox table, §0.4 fact 2).

**Increment 8–9 (ActionIntent wiring)**
30. `extractProposal` cannot return an `actor` — a reply containing an actor field is ignored, and the type forbids it.
31. A reply with two envelopes yields no proposal.
32. An unknown `intentType` → `UNKNOWN_INTENT`, zero side effects.
33. A buyer proposing `admin.trigger_deposit_refund` → `UNAUTHORIZED_ACTOR` (and `UNAUTHORIZED_ROLE` for a role mismatch within an actor).
34. `affiliate.request_payout` → `UNAVAILABLE_INTENT` at all three defence layers.
35. A prompt-injection payload instructing the model to claim approval yields, at most, a proposal — never an execution. (Extends the existing `prompt-injection.test.ts`.)
36. A `SUPPORT_ADMIN`'s intent slice excludes `finance.refunds` intents.
37. The approval queue never offers approve to an admin failing `approverRoleSatisfies`, and `engine.ts:229` rejects it even if the UI does.
38. A READ result renders with a source chip; model-authored text about the same records does not.

**Increment 10 (UX)**
39. `detect.mjs` exits 0 on the widget (the three `bounce-easing` findings gone).
40. The message list carries `role="log"` and `aria-live="polite"`.
41. Escape closes the panel and returns focus to the launcher.
42. `prefers-reduced-motion: reduce` disables the typing animation and the panel transition.
43. A visual-regression baseline exists for the panel at 320px, 375px and 1280px widths, and in the mobile-sheet mode.
44. axe reports no violations on the panel.

**Increment 11–12 (consequential + voice)**
45. Per activated intent: propose → `APPROVAL_REQUIRED` → approve → revalidate → execute → `COMPLETED`, with the outcome rendered from the command result and not from model text.
46. Revalidation denial between approval and execution aborts with zero side effects.
47. A duplicate proposal with the same idempotency key collapses to one record and one execution.
48. A `callReason` label alone neither transfers a call nor dispatches a vehicle request.
49. Voice dispatch requires the completeness predicate over collected fields.
50. With AI disabled, an inbound SMS `STOP` still suppresses (the deterministic keyword path is untouched).

### 9.3 Owner decisions

Only the owner can make these. **Phase 3 does not start until these are answered.**

**Blocking — Phase 3 cannot begin without these**

| # | Decision | Context | Recommendation |
| --- | --- | --- | --- |
| 1 | **Persist authenticated Zura transcripts?** | Behaviour changes from "nothing saved" to "saved". Four models exist and none is written; Phase 1 §F.8 could not tell whether this is lapsed or deferred. | **Yes** — §1.1. Justified by the action boundary, not by memory-as-a-feature. |
| 2 | **Approve a 90-day retention window and the disclosure copy?** | Requires legal review of the panel line and the lead-gate sentence (§7.8). | 90 days. |
| 3 | **Approve the schema change** to make `AiChatSession` polymorphic with a `Buyer` FK? | Increment 7 is a migration. Without the FK, account deletion does not reach transcripts. | Yes. |
| 4 | **Approve the audit double-write** — AI trail to `audit_logs`, admin trail to `admin_audit_logs` (§3.6)? | The alternative leaves the AI trail with a hole exactly at the highest-privilege actor. | Yes. |
| 5 | **Approve removing `agentType` from the wire** (§8.5 #1)? | It routes nothing today and is the latent selector Phase 1 §D.9 named. | Yes. |

**Cleanup — recommended, not blocking**

| # | Decision | Context | Recommendation |
| --- | --- | --- | --- |
| 6 | Drop `ai_conversation_contexts` and `ai_context_cache`? | Duplicated, buyer-only, zero rows, zero live importers. | Drop. |
| 7 | Delete `/api/public/ai/chat`? | Phase 1 §F.10 asked whether it is deprecated or an unfinished migration target. After increment 6 it is provably redundant. | Delete after increment 6. |
| 8 | Drop the orphaned `admin_audit_log` (singular, 3 rows, no Prisma model)? | Schema drift; nothing reads it. | Drop, after archiving the 3 rows. |
| 9 | Delete the dormant `VehicleFinder` component? | Zero importers (Phase 1 §A.22). | Delete. |
| 10 | Is the `"Alex"` greeting a legacy artifact or a second intended persona? (Phase 1 §F.9) | The design assumes legacy and removes it. | Confirm legacy. |

**Product and policy — needed before increment 11**

| # | Decision | Context | Recommendation |
| --- | --- | --- | --- |
| 11 | **Which READ intent is activated first, and in what order?** | Increment 8 activates one at a time behind its own key. | `admin.get_platform_snapshot` first — aggregate-only, no PII (`catalog.ts:148`), smallest blast radius. Then buyer, dealer, affiliate. |
| 12 | **Which CONSEQUENTIAL intents are ever enabled at all?** | Six exist. None has to be. At 2 dealers and 0 completed deals, `dealer.submit_offer` via chat may simply not be worth the surface. | Enable none until the READ path has run in production for a full auction cycle. |
| 13 | Should `ai.use` remain mapped to all five admin roles? (`approval-permissions.ts:37`) | It gates the CRM Copilot; a `SUPPORT_ADMIN` can generate marketing drafts. Flagged by Phase 1 §D.4; **not changed by this design**. | Narrow it — but that is a permissions change with blast radius beyond Zura. |
| 14 | Approve the admin-only correlation-id chip (§7.3)? | A support affordance that sits close to the "no routing internals" line. | Yes, admin only. |
| 15 | Do `Buyer.leadScore` and the CRM action-score plane need to agree? (Phase 1 §F.5) | Two systems, two scales. Out of scope here; it affects any future Zura lead-scoring capability. | Answer before any such capability. |
| 16 | Enable dealer-outreach AI sending? (Phase 1 §F.11) | Outside Zura, but `autolenis-dealer-outreach-governance` requires outreach to stay disabled by default and this design does not change it. | Keep disabled until reviewed. |
| 17 | Resolve Phase 1 §F.2, §F.3, §F.12 — the Twilio webhook wiring, the production env values, and the Vercel cron schedules. | Several ACTIVE-vs-PARTIAL statuses depend on them, and increment 12 touches the voice path. | Read them from the Twilio and Vercel consoles before increment 12. |

---

## APPENDIX A — Mechanical citation verification (executed)

Every backticked `path:line` claim in this document was extracted and checked against
the working tree at baseline `3ccd513`: does the file exist, and does the cited line
fall within it?

```
unique citations checked : 132
resolve & line in range  : 125
unresolved               :   7  — all seven are PROPOSED files that do not exist yet
```

The seven unresolved are, by design, the artifacts this document proposes and does
not build:

`lib/ai/provider.ts` · `lib/ai/providers/` · `lib/services/ai/zura-chat.service.ts` ·
`lib/services/ai/action-intent/extract.ts` · `lib/services/ai/ai-audit.service.ts`

**Every citation to code that exists today resolves to a real file with the cited
line in range — 125 of 125, zero failures.**

As in Phase 1 §G.2, this proves location validity, not that each citation supports
the specific claim attached to it. That distinction is stated rather than glossed.

### Claims downgraded during this phase's own verification pass

| # | Claim as first drafted | Resolution |
| --- | --- | --- |
| 1 | "The 7-agent roster can be adopted wholesale" | **Corrected.** Reading `agents.ts:96-104` showed the switch has no `admin` and no `affiliate` arm, so `"admin"` silently resolves to a buyer context. The router is retired; only the guardrail text is adopted (§1.3a). |
| 2 | "The unified AI audit targets `admin_audit_logs`" | **Reversed on evidence.** `AdminAuditLog.adminId` and `.adminEmail` are non-nullable (`schema.prisma:1396-1397`), so five of six surfaces cannot be represented without falsifying an actor. Target is `audit_logs`, with the admin trail preserved by a deliberate double-write (§3.6). |
| 3 | "Add the seven risk classes to the `Consequence` enum" | **Downgraded to additive metadata.** Widening a union that `authorize.ts` and ten test files switch on, for zero control-flow change, is cost without benefit (§6.1). |
| 4 | "Move `promoteOpportunity` behind the ActionIntent boundary" | **Withdrawn.** It is driven by a deterministic completeness predicate, not a model proposal, and is covered by existing tests. Routing it through `proposeIntent` would rewrite a working path for no security gain; six targeted bounds close the finding instead (§5.4). |
| 5 | "Make the kill switch a DB enable-flag" | **Corrected direction.** `getFeatureFlag` returns `false` for an absent row, so an *enable* flag would disable all AI on first deploy. Framed as a *kill* flag, absent-row preserves today's default exactly (§5.7). |
| 6 | Three UX claims stated as measured (contrast, mobile overflow, chip semantics) | **Downgraded / corrected** — see §7.9 and §7.10. No contrast was measured, no device was observed, and a source chip proves provenance, not accuracy. |
| 7 | Implied Impeccable ran its full two-sub-agent protocol | **Declared degraded.** §7.9 carries the mandatory `⚠️ DEGRADED: single-context` banner and names the reason, rather than claiming a clean run. |

### Known limits of this design

- **No runtime observation of any kind.** No browser, no database, no deployed
  environment. Every claim about current behaviour is read from source; every claim
  about proposed behaviour is a proposal.
- **Phase 1's fourteen `NOT VERIFIED` items are not resolved here** — §9.3 #17
  routes the three that block increment 12 to the owner.
- **No estimate of implementation effort is given.** Increment ordering is by risk,
  which is derivable; duration is not.

---

## PHASE 2 CLOSING STATEMENT

**No implementation has started.** No application code was written, modified, or
deleted. No Prisma schema change, no migration, no test file, no refactor. No agent
was created, consolidated, or removed — every consolidation and deletion in this
document is recorded as an owner decision in §9.3. No authorization policy was
changed. No production record was read or mutated. No merge, no deploy.

**The only file this phase adds is this one**, under `docs/zura/`.

The design extends the existing ActionIntent engine rather than replacing it; eight
of its eleven modules are untouched. It adopts `context-builder.ts`, the seven
personas' guardrail text, `/api/public/ai/chat`'s four guarantees, the
`FeatureFlag` substrate, `AiKillSwitchLog`, `AiChatSession`/`AiChatMessage`, the
existing rate limiter, the existing HMAC token pattern, and the promoted CRM
component kit. It builds four genuinely new things — a provider adapter, a proposal
extractor, a shared chat service, and an admin approval page — and omits two the
brief asked about (a separate intent router, a planner) with reasons.

**Phase 3 — implementation — is a separate run, and it does not begin until the
owner decisions in §9.3 are answered.**
