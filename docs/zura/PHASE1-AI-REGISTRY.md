# AutoLenis — Zura Unified AI Experience
## PHASE 1: Platform-Wide AI Discovery Registry

**Baseline SHA (`main`):** `8a56167b95830d90f8ccbf9687a910df573d53b8`
**Branch:** `claude/zura-unified-audit-lospq9`
**Audit date:** 2026-08-31
**Scope:** entire repository. App root confirmed as `frontend/`; `backend/`,
`automation/`, `tests/`, and `docs/` were also inspected (findings in §F.7).

---

## 0. Environment constraints — read before trusting any status label

**There is no isolated authenticated environment.** The branch preview shares
production Supabase. No production credentials were used, no authenticated E2E
was run, no live agent was invoked, and no production row was mutated.

**Every status label for an authenticated surface in this document is a static
trace claim, never a runtime observation.**

**Playwright was installed and functional but produced ZERO browser-verified
findings.** The session's network policy denies outbound CONNECT to all public
hosts (`connect_rejected … gateway answered 403` for `autolenis.com`,
`www.autolenis.com`, `example.com`, and `vercel.com` alike — confirmed via
`$HTTPS_PROXY/__agentproxy/status`). Chromium launched successfully; the
navigation failed at the proxy. **Consequently there are no `BROWSER-VERIFIED`
findings anywhere in this registry.** Every §B public-surface observation that
would normally be browser-verified is recorded as `CODE-VERIFIED` (from source)
or `NOT VERIFIED` (requires a live page). §F.1 states exactly what would resolve
this.

### Evidence classes used

Counts below are mechanical — occurrences of each backticked label in the body
of this file (the legend rows immediately below are themselves excluded):

| Class | Meaning | Count |
| --- | --- | --- |
| `CODE-VERIFIED` | Established by reading source and tracing the call path | **75** |
| `BROWSER-VERIFIED` | Observed live on an anonymous public page | **0** |
| `NOT VERIFIED` | Could not be established without crossing the environment boundary | **14** |
| `ASSUMPTION` | A working assumption, not confirmed | **1** — §F.7 |

Every `path:line` citation in this document was mechanically checked against the
working tree: **279 citations, 279 resolve to a real file with the cited line in
range, 0 failures.** Method and limits in §G.2.

### Capability status summary

31 distinct AI capabilities across 24 registry entries (§A.23 and §A.24 are
clusters of 3 and 6):

| Status | Count | Entries |
| --- | --- | --- |
| **ACTIVE** | 24 | §A.1–A.5, A.7, A.9–A.12, A.14–A.19, A.23 (×3), A.24 (×5) |
| **DORMANT** | 5 | §A.6, A.20, A.21, A.22, A.24 (`extractVehicleData`) |
| **PARTIAL** | 1 | §A.13 |
| **UNWIRED** | 1 | §A.8 |
| **BROKEN** | 0 | — (one broken *UI control* is recorded at §B.5, not a capability) |
| **DUPLICATED** | 0 as a status | Overlaps are analysed at capability level in §E rather than asserted as a status |

Separately: **9 supporting AI modules** (§A.25, 5 of them dormant) and
**6 AI database models** (§A.26, 5 never read or written).

### Runtime status vocabulary (used exactly as defined in the brief)

`ACTIVE` · `PARTIAL` · `DORMANT` · `UNWIRED` · `BROKEN` · `DUPLICATED` · `NOT VERIFIED`

### Branch-name note

The brief specifies branch `claude/zura-unified-audit`. This session's
environment designates `claude/zura-unified-audit-lospq9` as the mandatory
development branch and forbids pushing elsewhere. Work was committed to the
designated branch. Both were cut from the same baseline SHA above.

---

## 0.1 Skills and tooling — availability and use

| Skill / tool | Installed? | Used in Phase 1? | Notes |
| --- | --- | --- | --- |
| **Superpowers** | Partially — vendored | Yes (investigation/verification patterns only) | `.claude/plugins/superpowers-marketplace/superpowers` is vendored, and seven skills are mirrored as project skills (`superpowers-brainstorming`, `-writing-plans`, `-executing-plans`, `-using-git-worktrees`, `-dispatching-parallel-agents`, `-writing-skills`, `-finishing-a-development-branch`). **`systematic-debugging`, `verification-before-completion`, `test-driven-development`, `requesting-`/`receiving-code-review`, `subagent-driven-development` and `using-superpowers` are deliberately NOT mirrored** (the repo's no-duplicate-architecture-skills rule), and the hosted runtime does not activate project-scoped plugin marketplaces. The investigation/verification discipline used here therefore came from `autolenis-code-verification` + `autolenis-debugging`, which own the same ground. No implementation or TDD workflow was invoked — Phase 1 wrote no application code. |
| **Impeccable** | Yes (`.claude/skills/impeccable/`) | **Invoked; produced no document-level findings** — see §G.1 | Vendored project skill. It is a *frontend design* reviewer (a11y, contrast, responsive, motion, design-system adherence on UI code); it has no markdown/prose audit command, and its setup reported `NO_PRODUCT_MD`. The rigor pass that did run is a mechanical citation check plus self-review, both reported honestly in §G. |
| **Frontend Design** | **NOT INSTALLED under that name** | Substituted | No skill named "Frontend Design" exists in this environment. The nearest installed equivalents are `autolenis-ui-design-system` (token/component source of truth) and `impeccable` (UI/UX reviewer); a `design` skill exists but is a *canvas authoring* tool, out of scope for observation-only work. §B was characterised from source using `autolenis-ui-design-system` conventions. **No UX proposals are made anywhere in this document.** |
| **Playwright** | Yes (MCP server + `@playwright/test@1.61.1` + Chromium 1194) | Attempted, produced no findings | See §0. The MCP server is additionally misconfigured for this container (it seeks Chrome at `/opt/google/chrome/chrome`; the available binary is `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Direct-library launch succeeded; network egress did not. |
| `autolenis-system-architecture`, `-domain-model`, `-ai-safety-and-orchestration`, `-auth-security-privacy` | Yes | Yes | Domain routing per `CLAUDE.md`. |
| `task-observer` | Yes | Yes | Invoked at session start per `CLAUDE.md`; observations logged. |

**MCP servers requiring authentication and therefore unavailable:** `buffer`,
`context7`, `graphify`. None was needed for Phase 1.

---

## 0.2 Discovery method actually executed

Tiered, per the brief. The generic term list (`agent`, `chat`, `tool`,
`command`, `action`, `prompt`) was **never** used as a primary grep.

1. **Tier 1 — high-signal identifiers.** `zura` (50 source files), provider SDK
   names, `systemPrompt`/`buildPrompt`, the four registry identifiers,
   `orchestrat`/`intentRouter`/`aiRouter`/`classifier`/`planner`, `model:` /
   `maxTokens` / `temperature`. Plus `frontend/package.json` dependency scan,
   `frontend/env.d.ts` env-var scan, and a `schema.prisma` model scan.
2. **Tier 2 — domain intelligence names.** `intelligence`, `recommendation`,
   `scoring`, `analysis`, `insight`, `contract shield`, `pricing`, `market`,
   `compliance`, `underwriting`.
3. **Tier 3 — import-graph traversal.** Every Tier 1/2 hit was traced outward
   through imports, service calls, route handlers, and cron definitions, and
   **inward** to find production entrypoints. Both directions matter: §C.16
   documents a subsystem that is fully implemented and fully tested but has no
   input producer.

**Provider inventory (from `package.json` + direct HTTP calls):** `groq-sdk`
`^0.22.0`, `openai` `^6.42.0`. **No** `@anthropic-ai/sdk`, `@ai-sdk/*`,
`langchain`, or `vercel/ai` dependency exists — Anthropic and Gemini are reached
by raw `fetch`. `CODE-VERIFIED`.

---

## SECTION A — AI CAPABILITY REGISTRY

24 AI systems / AI-driven capabilities were found. Entries are grouped by
family. Every `RUNTIME STATUS` line names its evidence.

### A.1 — Zura Buyer Concierge (authenticated chat)

| Field | Value |
| --- | --- |
| **NAME** | Zura Buyer Concierge |
| **LOCATION** | `frontend/lib/services/ai/buyer-concierge.agent.ts:100` (`buyerConciergChat`) |
| **USER / PORTAL** | BUYER |
| **PURPOSE** | Journey-aware chat concierge for an authenticated buyer |
| **INPUTS** | `buyerId` (server-resolved), `userMessage`, `conversationHistory` (client-supplied, last 7 turns) |
| **OUTPUTS** | `{ content, model }` — free text only |
| **DATA SOURCES** | `prisma.buyer` + `preQualification`, `auctions` (ACTIVE, take 1), `deals` (take 1) — `buyer-concierge.agent.ts:21-28` |
| **MODEL / PROVIDER** | Groq `openai/gpt-oss-120b`, fallback `openai/gpt-oss-20b` on 429/rate_limit/overloaded — `lib/ai/groq-client.ts:8-9,65` |
| **PROMPT LOCATION** | `lib/ai/zura-knowledge.ts:5` (`ZURA_SYSTEM_PROMPT`) + `:123` (`ZURA_BUYER_CONTEXT_PREFIX`) + inline builder `buyer-concierge.agent.ts:57-97` |
| **TOOLS / COMMANDS EXPOSED** | None. ActionIntent guidance is injected only when `isActionIntentSurfaceEnabled()` (`:95`), and even then nothing parses the reply — see §C.16 |
| **READ CAPABILITIES** | Buyer's own prequal tier, `maxOtdAmountCents`, auction status/end date, deal status |
| **WRITE CAPABILITIES** | None in the agent. The route writes one `buyerActivityEvent` row (`app/api/buyer/ai/chat/route.ts:34`) |
| **AUTHENTICATION** | `getRequestBuyer(request)` → Supabase session → `resolveAuthorizedBuyer` — `app/api/buyer/ai/chat/route.ts:15`, `lib/auth/api.ts:132` |
| **HARD AUTHORIZATION** | **Deterministic.** Buyer identity is server-resolved; `buyerId` is never read from the request body for the agent call |
| **CONFIRMATION BOUNDARY** | N/A — no action surface |
| **AUDIT LOGGING** | Partial: a `BuyerActivityEvent` with a 50-char message preview. Not an audit log; no model output persisted |
| **SIDE EFFECTS** | One Groq call; one non-blocking DB insert |
| **CALLERS** | `frontend/app/api/buyer/ai/chat/route.ts:9` (POST) ← `frontend/components/public/ChatWidget.tsx:167` ← `frontend/app/buyer/layout.tsx:281` |
| **CURRENT UI SURFACE** | Shared `ChatWidget`, floating bottom-right launcher on every `/buyer/*` page |
| **CURRENT ZURA CONNECTION** | Branded "Zura" in the layout greeting (`app/buyer/layout.tsx:284`) |
| **TEST COVERAGE** | **None.** No test file references `buyerConciergChat` or `app/api/buyer/ai/chat` |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. Entrypoint `app/buyer/layout.tsx:281` → `ChatWidget` → `POST /api/buyer/ai/chat` (`route.ts:9`) → `buyerConciergChat`. |

**Defect (CODE-VERIFIED):** the widget sends `agentType` (`ChatWidget.tsx:174`)
and the route destructures it (`route.ts:18-22`) but only writes it to the
activity-event metadata (`:39`). It never routes. The five buyer agent
personas in `lib/services/ai/agents.ts` are unreachable from this path — see
§A.20.

---

### A.2 — Zura Dealer Concierge

| Field | Value |
| --- | --- |
| **NAME** | Zura Dealer Concierge |
| **LOCATION** | `frontend/lib/services/ai/dealer-concierge.agent.ts:72` (`dealerConciergeChat`) |
| **USER / PORTAL** | DEALER |
| **PURPOSE** | Dealer-partnership guidance: inventory, invitations, offer strategy |
| **INPUTS** | `dealerId` (server-resolved), `userMessage`, history |
| **OUTPUTS** | `{ content, model }` |
| **DATA SOURCES** | `prisma.dealer` (`dealershipName`, `_count.inventory`, `_count.invitations`, `_count.offers`) + `prisma.offer.count({status:"SUBMITTED"})` — `:15-35` |
| **MODEL / PROVIDER** | Groq `openai/gpt-oss-120b` (fallback `-20b`), `maxTokens: 512`, `temperature: 0.7` — `:86` |
| **PROMPT LOCATION** | Inline, `dealer-concierge.agent.ts:45-70`. **Does not import `ZURA_SYSTEM_PROMPT`** |
| **TOOLS / COMMANDS EXPOSED** | None (dormant ActionIntent guidance at `:68`) |
| **READ CAPABILITIES** | Own dealership name, own counts only |
| **WRITE CAPABILITIES** | None |
| **AUTHENTICATION** | `getRequestDealer(request)` — `app/api/dealer/ai/chat/route.ts:14` |
| **HARD AUTHORIZATION** | **Deterministic.** All Prisma reads are keyed on the server-resolved `dealer.id`; no cross-dealer read is constructible from this path |
| **CONFIRMATION BOUNDARY** | N/A |
| **AUDIT LOGGING** | **None** |
| **SIDE EFFECTS** | One Groq call |
| **CALLERS** | `frontend/app/api/dealer/ai/chat/route.ts:9` ← `ChatWidget` ← `frontend/app/dealer/layout.tsx:37` |
| **CURRENT UI SURFACE** | Shared `ChatWidget`, `chatEndpoint="/api/dealer/ai/chat"` |
| **CURRENT ZURA CONNECTION** | Branded "Zura" in prompt (`:46`) and greeting (`app/dealer/layout.tsx:39`) |
| **TEST COVERAGE** | **None** |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. |

**Defects (CODE-VERIFIED):**
- `_count.invitations` is *all* invitations ever, presented to the model as
  "Auction invitations" (`:41,:50`); `_count.offers` is selected (`:23`) and
  never used.
- The prompt tells the dealer-facing model it "know[s] the approved max" buyer
  prequal budget (`:60`) while the assembled context contains no buyer data at
  all. Prompt and context disagree; the dealer isolation rule is upheld by the
  *absence of data*, not by the instruction.

---

### A.3 — Zura Admin Concierge

| Field | Value |
| --- | --- |
| **NAME** | Zura Admin Operations Concierge |
| **LOCATION** | `frontend/lib/services/ai/admin-concierge.agent.ts:51` (`adminConciergeChat`) |
| **USER / PORTAL** | ADMIN (all five roles) |
| **PURPOSE** | Platform-health summarisation and admin-tool navigation |
| **INPUTS** | `userMessage`, history. **No admin identity is passed to the agent** (`:51`) |
| **OUTPUTS** | `{ content, model }` |
| **DATA SOURCES** | Platform-wide aggregate counts: `buyer.count`, `dealer.count`, `auction.count`, `deal.count` — `:9-14` |
| **MODEL / PROVIDER** | Groq `openai/gpt-oss-120b`, `maxTokens: 768`, `temperature: 0.5` — `:64` |
| **PROMPT LOCATION** | Inline, `:19-49` |
| **TOOLS / COMMANDS EXPOSED** | None (dormant guidance at `:47`) |
| **READ CAPABILITIES** | Aggregate counts only — no PII, no per-record read |
| **WRITE CAPABILITIES** | None |
| **AUTHENTICATION** | `getAdminFromRequest` — admin JWT **plus `payload.mfaVerified`** plus `admin.isActive` — `lib/auth/admin-api.ts:15-28` |
| **HARD AUTHORIZATION** | **Deterministic for authentication; ABSENT for role.** Any of the five admin roles reaches identical platform-wide context. See §D.4 |
| **CONFIRMATION BOUNDARY** | N/A |
| **AUDIT LOGGING** | **Yes** — `createAuditLog(admin, request, { action: "ADMIN_AI_CHAT", … })` recording model, message length, history length (not content) — `app/api/admin/ai/chat/route.ts:31-36`. The only chat surface with a real audit entry |
| **SIDE EFFECTS** | One Groq call; one `AdminAuditLog` row |
| **CALLERS** | `frontend/app/api/admin/ai/chat/route.ts:9` ← `ChatWidget` ← `frontend/app/admin/layout.tsx:35` |
| **CURRENT UI SURFACE** | Shared `ChatWidget`, `chatEndpoint="/api/admin/ai/chat"` |
| **CURRENT ZURA CONNECTION** | Branded "Zura" in prompt (`:25`) and greeting (`app/admin/layout.tsx:37`) |
| **TEST COVERAGE** | **None** |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. |

---

### A.4 — Zura Affiliate Concierge

| Field | Value |
| --- | --- |
| **NAME** | Zura Affiliate Concierge |
| **LOCATION** | `frontend/lib/services/ai/affiliate-concierge.agent.ts:60` (`affiliateConciergeChat`) |
| **USER / PORTAL** | AFFILIATE |
| **PURPOSE** | Referral, commission, payout and marketing guidance |
| **INPUTS** | `affiliateId` (server-resolved), `userMessage`, history |
| **OUTPUTS** | `{ content, model }` |
| **DATA SOURCES** | `prisma.affiliate` → `status`, `user.email`, `_count.commissions` — `:13-32` |
| **MODEL / PROVIDER** | Groq `openai/gpt-oss-120b`, `maxTokens: 512` — `:74` |
| **PROMPT LOCATION** | Inline, `:34-58`. **The affiliate's own email address is interpolated into the system prompt** (`:35`) |
| **TOOLS / COMMANDS EXPOSED** | None (dormant guidance at `:56`) |
| **READ CAPABILITIES** | Own status, own email, own commission count |
| **WRITE CAPABILITIES** | None |
| **AUTHENTICATION** | `getRequestAffiliate(request)` — `app/api/affiliate/ai/chat/route.ts:14` |
| **HARD AUTHORIZATION** | **Deterministic** — reads keyed on server-resolved `affiliate.id` |
| **CONFIRMATION BOUNDARY** | N/A |
| **AUDIT LOGGING** | **None** |
| **SIDE EFFECTS** | One Groq call. Throws (not a graceful failure) if the affiliate row is missing — `:24` |
| **CALLERS** | `frontend/app/api/affiliate/ai/chat/route.ts:9` ← `ChatWidget` ← `frontend/app/affiliate/portal/layout.tsx:28` |
| **CURRENT UI SURFACE** | Shared `ChatWidget`, `chatEndpoint="/api/affiliate/ai/chat"` |
| **CURRENT ZURA CONNECTION** | Branded "Zura" in prompt (`:35`) and greeting (`app/affiliate/portal/layout.tsx:30`) |
| **TEST COVERAGE** | **None** |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. |

**Note (CODE-VERIFIED):** sending the affiliate's email into the system prompt
is a PII-into-prompt path with no redaction. Severity assessed in §D.7.

---

### A.5 — Zura Public Streaming Concierge (`/api/concierge`)

| Field | Value |
| --- | --- |
| **NAME** | Zura Public Concierge — streaming intake |
| **LOCATION** | `frontend/app/api/concierge/route.ts:60` (POST); model layer `frontend/lib/ai/acquisition.ts:320` (`streamConcierge`) and `:430` (`extractStructuredData`) |
| **USER / PORTAL** | PUBLIC / anonymous |
| **PURPOSE** | Lead-gated public chat that captures a vehicle request and promotes it into the sourcing pipeline |
| **INPUTS** | `sessionId` (client-minted `crypto.randomUUID()`), `userMessage`, and on turn 1 `firstName`/`email` from the lead gate |
| **OUTPUTS** | `text/plain` token stream; a persisted `BuyerOpportunity`; optionally a `VehicleRequest` + pipeline enqueue + CRM contact |
| **DATA SOURCES** | `prisma.buyerOpportunity` keyed on `sessionId` (`:84`) |
| **MODEL / PROVIDER** | **Two Groq calls per turn** — `openai/gpt-oss-120b` streaming reply, then a non-streamed `openai/gpt-oss-20b` strict-JSON extraction (`route.ts:1-6`, `lib/ai/acquisition.ts:15,18`) |
| **PROMPT LOCATION** | `lib/ai/concierge-prompt.ts:1` (`CONCIERGE_SYSTEM_PROMPT`) + a large dynamic block at `route.ts:162-186`. **Does NOT use `ZURA_SYSTEM_PROMPT`** |
| **TOOLS / COMMANDS EXPOSED** | None |
| **READ CAPABILITIES** | Own session's `BuyerOpportunity` row |
| **WRITE CAPABILITIES** | **Extensive.** `buyerOpportunity.create` (`:89`), `.update` ×3 (`:103`, `:274`, `:327`); `promoteOpportunity` → `VehicleRequest` + durable intake pipeline (`:336`); `ContactService.upsertContact` (`:400`); `emitDomainEvent("zura_conversation_captured")` (`:402`) |
| **AUTHENTICATION** | **NONE — anonymous by design.** Identity is a client-supplied `sessionId` |
| **HARD AUTHORIZATION** | **ABSENT.** The only access control is knowledge of a `sessionId` string. See §D.1 |
| **CONFIRMATION BOUNDARY** | The lead gate is **client-side only** (`ChatWidget.tsx:281,217-240`); the server never verifies it ran |
| **AUDIT LOGGING** | Application logs only (`logger.info` stage markers). No audit table |
| **SIDE EFFECTS** | LLM ×2; DB writes; VehicleRequest creation; durable pipeline (dealer discovery, phone-script drafting, scoring, outreach); CRM contact upsert with `consentEmail`/`consentSms` set from the gate opt-in (`:390-398`); domain-event fan-out |
| **CALLERS** | `frontend/components/public/ChatWidget.tsx:96` ← `app/(public)/page.tsx:373`, `app/(public)/for-buyers/page.tsx:628`, `app/(public)/request-a-car/page.tsx:280`, `app/(public)/lp/[campaign]/LandingPageClient.tsx:1631`. Also `frontend/components/acquisition/VehicleFinder.tsx:52` (component itself unmounted — §A.22) |
| **CURRENT UI SURFACE** | Shared `ChatWidget` in public mode — floating launcher, lead gate, streaming transcript |
| **CURRENT ZURA CONNECTION** | Branded "Zura" in the panel header (`ChatWidget.tsx:263`), greeting (`:22`), and consent text (`route.ts:46`) |
| **TEST COVERAGE** | Indirect only — `lib/services/acquisition/__tests__/intake-turn.test.ts`, `promote-opportunity.test.ts`, `unified-intake-emit.test.ts` cover the decision + promotion helpers. **No test covers the route** |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. |

**Defects (CODE-VERIFIED):**
- **No `isAiEnabled()` check.** `streamConcierge`/`extractStructuredData` call
  Groq's REST endpoint directly (`lib/ai/acquisition.ts` has zero kill-switch
  references), so the platform kill switch does not stop the busiest public AI
  path. See §D.2.
- **No rate limit.** Contrast `/api/public/ai/chat`, which has one and is
  dormant (§A.6).
- CSRF is exempted for this path (`frontend/proxy.ts:280`).

---

### A.6 — Zura Public Chat (`/api/public/ai/chat`) — the guarded twin

| Field | Value |
| --- | --- |
| **NAME** | Public Zura chat (non-streaming) |
| **LOCATION** | `frontend/app/api/public/ai/chat/route.ts:14` |
| **USER / PORTAL** | PUBLIC / anonymous |
| **PURPOSE** | Stateless public Q&A against the shared Zura knowledge base |
| **INPUTS** | `message` (≤2000 chars), `history` (≤8, role-filtered) |
| **OUTPUTS** | `{ content, model }` |
| **DATA SOURCES** | **None** — no DB read, no persistence |
| **MODEL / PROVIDER** | Groq `openai/gpt-oss-120b` via `groqChat`, `maxTokens: 300` — `:57` |
| **PROMPT LOCATION** | `lib/ai/zura-knowledge.ts:5` (`ZURA_SYSTEM_PROMPT`) — the canonical Zura prompt |
| **TOOLS / COMMANDS EXPOSED** | None |
| **READ / WRITE CAPABILITIES** | None / none |
| **AUTHENTICATION** | None (public by design) |
| **HARD AUTHORIZATION** | N/A — no data access to authorize |
| **CONFIRMATION BOUNDARY** | N/A |
| **AUDIT LOGGING** | None |
| **SIDE EFFECTS** | One Groq call |
| **CALLERS** | **NONE.** A repository-wide search for `public/ai/chat` returns only the route file itself and its own header comment |
| **CURRENT UI SURFACE** | **None.** Its header claims it is "Used by the public homepage ChatWidget" (`:8`) — the widget posts to `/api/concierge` instead (`ChatWidget.tsx:96`) |
| **CURRENT ZURA CONNECTION** | Uses `ZURA_SYSTEM_PROMPT` |
| **TEST COVERAGE** | **None** |
| **RUNTIME STATUS** | **DORMANT** — `CODE-VERIFIED`. Searched for callers across `app/`, `lib/`, `components/`, `tests/`, and JSON config; found none. The route remains publicly POST-able as a Next.js route handler, but no AutoLenis UI reaches it. |

**This is the sharpest single finding in the registry:** the *guarded* public
endpoint (kill switch at `:16`, durable 20/hour per-IP rate limit at `:22`,
length caps at `:39`, history sanitisation at `:44-48`) is dead, while the
*unguarded* one (§A.5) carries all public traffic.

---

### A.7 — Zura Voice Receptionist

| Field | Value |
| --- | --- |
| **NAME** | Zura Voice (phone receptionist) |
| **LOCATION** | `frontend/lib/voice/handle-turn.ts:472` (`handleVoiceTurn`) |
| **USER / PORTAL** | PUBLIC (inbound phone callers) |
| **PURPOSE** | Multi-intent phone concierge: classify call reason, answer, take messages, route dealer inquiries, run vehicle intake, escalate to live transfer |
| **INPUTS** | Twilio webhook form body: `CallSid`, `From`, `SpeechResult`/transcript, confidence |
| **OUTPUTS** | TwiML XML; ElevenLabs-synthesised speech; structured intake draft |
| **DATA SOURCES** | `lib/voice/conversation-store.ts` (per-call state); `lib/services/voice/buyer-lookup.service.ts` (returning-caller recognition by phone → `Buyer`/`BuyerOpportunity`) |
| **MODEL / PROVIDER** | **Three providers.** Groq `openai/gpt-oss-120b` for the reply (`handle-turn.ts:499`, `maxTokens: 120`, `temperature: 0.85`) and a second Groq call for intent extraction (`:258`); **OpenAI Whisper** for STT (`lib/voice/whisper-stt.service.ts:103`); **ElevenLabs** for TTS (`lib/voice/elevenlabs-tts.service.ts:92`) |
| **PROMPT LOCATION** | `lib/ai/zura-voice.ts:11` (`ZURA_VOICE_PROMPT`) + buyer-context block (`handle-turn.ts:490`) + extractor prompt (`:98-170`) |
| **TOOLS / COMMANDS EXPOSED** | None as typed tools. The extractor's `callReason` classification **drives control flow**: it can trigger a live call transfer (`:560-563`) and vehicle-request dispatch (`:581`) |
| **READ CAPABILITIES** | Caller-phone → matched buyer's first name and last vehicle interest (`buyer-lookup.service.ts`) |
| **WRITE CAPABILITIES** | `dispatchVehicleRequest` creates `User` + `Buyer` (+ transaction) and sends an admin-created-buyer email — `lib/voice/dispatch-request.ts:128-236`; `sendFounderMessageAlert` sends SMS (`:374`) and writes `buyerOpportunity` (`:392`) |
| **AUTHENTICATION** | **Twilio HMAC signature.** `parseTwilioRequest` → `twilio.validateRequest` — `lib/voice/twilio-verify.ts:56-90`. Verified-and-enforced on `incoming` (`:34`), `process` (`:26`), `recording-complete` (`:25`), `status` (`:212`), `transfer-status` (`:35`) |
| **HARD AUTHORIZATION** | **Deterministic at the transport boundary** (signature). Beyond it, the *caller's phone number* is the only identity, and it is attacker-choosable by anyone who can spoof caller ID to a Twilio number |
| **CONFIRMATION BOUNDARY** | Live transfer is gated by `isTransferEnabled()` (`lib/voice/call-transfer.service.ts:38`), a separate env kill switch requiring the literal `"true"` |
| **AUDIT LOGGING** | Application logs; `Conversation`/`BuyerOpportunity` rows. No dedicated AI audit |
| **SIDE EFFECTS** | Money: none. Comms: **yes** (SMS, email, live phone transfer). State: Buyer/User creation |
| **CALLERS** | `frontend/app/api/twilio/voice/process/route.ts:23`; `frontend/app/api/twilio/voice/recording-complete/route.ts:22`. Entry: `frontend/app/api/twilio/voice/incoming/route.ts:19` |
| **CURRENT UI SURFACE** | None (telephony). Admin analytics summarises it — `lib/services/analytics/admin-analytics.service.ts:240-261` |
| **CURRENT ZURA CONNECTION** | Branded "Zura" throughout; a **separate prompt** from the web Zura |
| **TEST COVERAGE** | **None** for `lib/voice/*` |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED` for the code path. Whether Twilio numbers currently point at these webhooks is `NOT VERIFIED` (requires the Twilio console). |

**Defect (CODE-VERIFIED):** an LLM classification (`callReason`) selects a
control-flow branch that produces real-world side effects (transfer, dispatch,
SMS) with no deterministic re-check. See §D.6.

---

### A.8 — ActionIntent Execution Architecture (AI→business boundary)

| Field | Value |
| --- | --- |
| **NAME** | ActionIntent engine ("Program 6") |
| **LOCATION** | `frontend/lib/services/ai/action-intent/engine.ts:85` (`proposeIntent`), `:167` (`approveIntent`), `:254` (`rejectIntent`) |
| **USER / PORTAL** | All four actors + SYSTEM |
| **PURPOSE** | The single controlled path from an AI proposal to a canonical business service |
| **INPUTS** | A typed `ActionIntentProposal` — intent name, parameters, `ActorContext`, optional idempotency key |
| **OUTPUTS** | `ProposalOutcome` (`REJECTED` / `APPROVAL_REQUIRED` / `EXECUTING` / `COMPLETED` / `FAILED`) |
| **DATA SOURCES** | `policy.ts:141-190` `defaultPolicyDeps` — authoritative Prisma reads for offer, deal, auction, deposit, invitation, fulfillment gate |
| **MODEL / PROVIDER** | **None — this layer is entirely deterministic.** No LLM call anywhere in the module |
| **PROMPT LOCATION** | `guidance.ts:35` (`buildActorGuidance`) — recognition guidance only, injected into the four concierge prompts |
| **TOOLS / COMMANDS EXPOSED** | 12 catalog entries (`catalog.ts:40-296`): 3 buyer, 2 dealer, 4 admin, 2 affiliate, 1 shared escalation |
| **READ CAPABILITIES** | Per-intent, catalog-declared |
| **WRITE CAPABILITIES** | Via `commands.ts:16-161` → `createVehicleRequest`, `commitOfferSelection`, `submitOffer`, `advanceDealStatus`, `requestExtension`, `processRefund`, `notification.create` |
| **AUTHENTICATION** | Inherited from the calling surface (`ActorContext.authenticatedRole`) |
| **HARD AUTHORIZATION** | **Deterministic and fail-closed, six ordered gates** — `authorize.ts:29-91`: catalog membership → availability → actor match → role allowlist → Zod schema → per-`actor:intent` activation. Then `policy.ts` for ownership/IDOR/money/state. Then approver enforcement `engine.ts:217-251`. Then **revalidation immediately before execution** (`engine.ts:288-307`) |
| **CONFIRMATION BOUNDARY** | **Server-authoritative.** `requiresHumanApproval` halts at `APPROVAL_REQUIRED` (`engine.ts:156-160`); `assertApprover` forbids SYSTEM approval outright (`:218`), enforces the declared RBAC permission for admin intents (`:229`), and permits self-confirmation only for the same authenticated principal (`:240`) |
| **AUDIT LOGGING** | **Yes** — every transition via `auditLogRecorder` onto the existing `AuditLog` table; durable state on `AiActionIntent` (`schema.prisma:3492`) |
| **SIDE EFFECTS** | Money (deposit refund), state transitions (deal, auction, offer), notifications |
| **CALLERS (production entrypoints)** | `approveIntent` ← `frontend/app/api/admin/action-intents/[id]/approve/route.ts:45`; `rejectIntent` ← `.../reject/route.ts:40`; `store.listByStatus` ← `frontend/app/api/admin/action-intents/route.ts:20`. **`proposeIntent` has ZERO production callers.** |
| **CURRENT UI SURFACE** | **None.** No admin page renders the pending-intent queue — the three routes have no `.tsx` caller |
| **CURRENT ZURA CONNECTION** | Only through `buildActorGuidance`, injected into the four concierge prompts when `ACTION_INTENT_EXECUTION_ENABLED === "true"` |
| **TEST COVERAGE** | **The best-covered AI code in the repo** — 10 module tests (`lib/services/ai/action-intent/__tests__/`: activation, api-shape, authorization, catalog, durable-lifecycle, engine, postgres-concurrency, prisma-store, prompt-injection, revalidation) + `app/api/admin/action-intents/__tests__/routes.test.ts`; suites `test:action-intent`, `test:action-intent-routes` |
| **RUNTIME STATUS** | **UNWIRED** — `CODE-VERIFIED`. |

**Why `UNWIRED` and not `DORMANT`:** two required bindings are missing, one of
them structural.
1. **Configuration binding.** `ACTION_INTENT_EXECUTION_ENABLED` and
   `ACTION_INTENT_ACTIVE_KEYS` (`activation.ts:16-17`) both default off and
   fail closed (`:41-43`).
2. **Missing input producer — the decisive one.** Even with both flags on, no
   code constructs an `ActionIntentProposal`. A repository-wide search for
   `proposeIntent` and `ActionIntentProposal` outside the module returns
   **nothing**; the four concierge agents return raw text and no caller parses
   it. The approve/reject routes are reachable, but they can only act on rows
   that nothing in the application can create.

This distinction matters for Phase 2: the deterministic spine exists and is
tested, but the **proposal-extraction step between the model's reply and
`proposeIntent` has never been built.**

---

### A.9 — CRM Copilot (admin drafting engine)

| Field | Value |
| --- | --- |
| **NAME** | AutoLenis CRM Copilot |
| **LOCATION** | `frontend/lib/ai/crm-copilot.ts:352` (`generateContentDraft`), `:363` (`generateAutomationPlan`) |
| **USER / PORTAL** | ADMIN |
| **PURPOSE** | Draft marketing content and Zod-validated automation plans from an admin prompt |
| **INPUTS** | `prompt`, `mode` (`content` \| `automation_plan`), optional `context` |
| **OUTPUTS** | Zod-validated `ContentDraft` / `AutomationPlan` + claim flags |
| **DATA SOURCES** | Admin-supplied context string; the platform's real trigger/channel enums (`:23-40`) |
| **MODEL / PROVIDER** | Groq `llama-3.3-70b-versatile` (`COPILOT_MODEL`, `:18`) |
| **PROMPT LOCATION** | `crm-copilot.ts:98` (`COMPLIANCE_GUARDRAILS`) + builders in the same file |
| **TOOLS / COMMANDS EXPOSED** | None — output is a draft object |
| **READ CAPABILITIES** | None beyond the supplied prompt/context |
| **WRITE CAPABILITIES** | **None here.** Persistence happens only via the separate approve route |
| **AUTHENTICATION** | `requirePermissionActor("ai.use")` — `app/api/admin/crm/copilot/route.ts:26` |
| **HARD AUTHORIZATION** | **Deterministic permission check.** Note `ai.use` maps to **all five admin roles** (`action-intent/approval-permissions.ts:37`) |
| **CONFIRMATION BOUNDARY** | **Yes and real** — `POST /api/admin/crm/copilot/approve` is documented as "The ONLY way a copilot draft becomes a stored record" (`approve/route.ts:24`); the generate route persists nothing |
| **AUDIT LOGGING** | **Yes** — `CRM_COPILOT_GENERATE` (prompt ≤2000 chars, mode, model, flag count; deliberately excludes `context` and draft text) and `CRM_COPILOT_APPROVE` |
| **SIDE EFFECTS** | One Groq call; audit rows. Approval creates a template/campaign draft; nothing is sent |
| **CALLERS** | `frontend/app/api/admin/crm/copilot/route.ts:26` ← `frontend/components/admin/crm/CopilotPanel.tsx:95` ← `frontend/components/admin/crm/CrmShell.tsx:109` |
| **CURRENT UI SURFACE** | `CopilotPanel` — a slide-over inside `CrmShell`, **separate from the Zura `ChatWidget`** |
| **CURRENT ZURA CONNECTION** | **None.** Not branded Zura; different UI, endpoint, model, and prompt |
| **TEST COVERAGE** | `lib/crm/__tests__/copilot.proof.test.ts` (suite `test:crm`) |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. |

**Defect (CODE-VERIFIED):** no `isAiEnabled()` check — `crm-copilot.ts` calls
Groq's REST endpoint directly and never references the kill switch.

---

### A.10 — Admin Morning Briefing Agent

| Field | Value |
| --- | --- |
| **NAME** | Admin Morning Briefing |
| **LOCATION** | `frontend/lib/services/ai/agents.ts:54` (`adminBriefingAgent`) |
| **USER / PORTAL** | ADMIN |
| **PURPOSE** | 3–5 bullet daily operations briefing |
| **INPUTS** | `adminId`, `adminRole` |
| **OUTPUTS** | Free-text briefing |
| **DATA SOURCES** | `deal.count`, `auction.count`, `contractScan.count({status:"FAIL"})`, `preQualification.count({decision:"OFAC_ESCALATED"})` — `:59-64` |
| **MODEL / PROVIDER** | Groq `openai/gpt-oss-120b`, `maxTokens: 400`, `temperature: 0.3` — `:76-79` |
| **PROMPT LOCATION** | `lib/ai/context-builder.ts:81` + inline `agents.ts:66-74` |
| **TOOLS / COMMANDS EXPOSED** | None |
| **READ CAPABILITIES** | Aggregate counts including **compliance-sensitive** OFAC escalation and Contract Shield failure counts |
| **WRITE CAPABILITIES** | None in the agent |
| **AUTHENTICATION** | Two entrypoints: admin JWT + MFA (`app/api/admin/ai/briefing/route.ts:11`) **and** cron secret (`app/api/cron/morning-briefing/route.ts:13`) |
| **HARD AUTHORIZATION** | Deterministic authentication; **no role scoping** — `adminRole` is passed to the prompt but gates nothing |
| **CONFIRMATION BOUNDARY** | N/A |
| **AUDIT LOGGING** | Cron run recorded via `withCronRun("morning-briefing", …)` |
| **SIDE EFFECTS** | One Groq call; the cron additionally emails the briefing (`cron/morning-briefing/route.ts:46`) |
| **CALLERS** | `frontend/app/api/admin/ai/briefing/route.ts:24`; `frontend/lib/services/admin/morning-briefing.service.ts:6` ← `frontend/app/api/cron/morning-briefing/route.ts:30` |
| **CURRENT UI SURFACE** | `frontend/app/admin/ai/page.tsx` — "Generate Briefing" button |
| **CURRENT ZURA CONNECTION** | The page is titled "Zura — AI Concierge"; the agent itself is not Zura-branded |
| **TEST COVERAGE** | Only schedule presence — `lib/services/monitoring/__tests__/dead-cron.test.ts:95` |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. Two independent entrypoints. |

---

### A.11 — Natural-language Search Interpreter

| Field | Value |
| --- | --- |
| **NAME** | Buyer search interpreter |
| **LOCATION** | `frontend/lib/services/ai/search-interpreter.ts:48` (`interpretSearchQuery`) |
| **USER / PORTAL** | BUYER |
| **PURPOSE** | Convert plain-English vehicle search text into structured filters |
| **INPUTS** | `query` string |
| **OUTPUTS** | `StructuredSearchFilters \| null`, plus `URLSearchParams` (`:72`) |
| **DATA SOURCES** | None |
| **MODEL / PROVIDER** | Groq via `groqChat`, `maxTokens: 200`, `temperature: 0.1` — `:54-57` |
| **PROMPT LOCATION** | Inline, `search-interpreter.ts` |
| **TOOLS / COMMANDS EXPOSED** | None |
| **READ / WRITE CAPABILITIES** | None / none |
| **AUTHENTICATION** | `app/api/buyer/search/interpret/route.ts:8` |
| **HARD AUTHORIZATION** | Filters are advisory; the inventory API applies its own scoping |
| **CONFIRMATION BOUNDARY** | N/A |
| **AUDIT LOGGING** | None |
| **SIDE EFFECTS** | One Groq call |
| **CALLERS** | `frontend/app/api/buyer/search/interpret/route.ts:20` |
| **CURRENT UI SURFACE** | Buyer search (`test:buyer-search` suite exists for the route directory) |
| **CURRENT ZURA CONNECTION** | **None** — no Zura branding, separate endpoint |
| **TEST COVERAGE** | Route-level suite `test:buyer-search` |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. Kill switch enforced twice (`route.ts:16`, `search-interpreter.ts:49`). |

---

### A.12 — AMIPS Executive Narrative

| Field | Value |
| --- | --- |
| **NAME** | AMIPS executive summary narrative |
| **LOCATION** | `frontend/lib/amips/intelligence/narrative.ts:59` (`generateExecutiveSummary`) |
| **USER / PORTAL** | ADMIN |
| **PURPOSE** | Narrate the AMIPS market-intelligence snapshot |
| **INPUTS** | `ExecutiveIntelligence` object from `loadExecutiveIntelligence` |
| **OUTPUTS** | Narrative text |
| **DATA SOURCES** | AMIPS intelligence tables (`AmipsIntelligenceSnapshot`, `MarketIntelligence`, …) |
| **MODEL / PROVIDER** | Groq via `groqChat`, `maxTokens: 600`, `temperature: 0.4` — `:70` |
| **PROMPT LOCATION** | `narrative.ts`; generator prompts at `lib/amips/prompts/amips-generator.prompts.ts` |
| **TOOLS / COMMANDS EXPOSED** | None |
| **READ CAPABILITIES** | Aggregate market intelligence |
| **WRITE CAPABILITIES** | None |
| **AUTHENTICATION** | Admin — `app/api/admin/amips/executive-summary/route.ts:33` |
| **HARD AUTHORIZATION** | Admin auth; no role scoping |
| **CONFIRMATION BOUNDARY** | N/A |
| **AUDIT LOGGING** | None observed |
| **SIDE EFFECTS** | One Groq call, wrapped in `withTimeout(…, AI_TIMEOUT_MS)` (`:51`) |
| **CALLERS** | `frontend/app/api/admin/amips/executive-summary/route.ts:51` |
| **CURRENT UI SURFACE** | `frontend/app/admin/amips/*` report pages |
| **CURRENT ZURA CONNECTION** | None |
| **TEST COVERAGE** | `lib/amips/intelligence/__tests__/executive-intelligence.test.ts` (suite `test:amips`) covers the loader, **not** the narrative |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. Kill switch enforced at `route.ts:38` and again inside `groqChat`. |

---

### A.13 — AMIPS Page Generator

| Field | Value |
| --- | --- |
| **NAME** | AMIPS programmatic page generator |
| **LOCATION** | `frontend/lib/amips/amips-generator.ts:139` (`groqChat` call) |
| **USER / PORTAL** | ADMIN / system (SEO surface is public) |
| **PURPOSE** | Generate AMIPS market/vehicle intelligence page bodies |
| **MODEL / PROVIDER** | Groq via `groqChat` |
| **PROMPT LOCATION** | `lib/amips/prompts/amips-generator.prompts.ts` |
| **WRITE CAPABILITIES** | AMIPS content records, gated by `lib/amips/quality-gate.ts` and `lib/amips/indexation-gate.ts` |
| **AUTHENTICATION** | Admin/cron surfaces |
| **AUDIT LOGGING** | None observed |
| **SIDE EFFECTS** | Publishes indexable public content |
| **CALLERS** | AMIPS pipelines under `lib/amips/pipelines/*` |
| **TEST COVERAGE** | Partial (`test:amips` covers intelligence loading only) |
| **RUNTIME STATUS** | **PARTIAL** — `CODE-VERIFIED` that the generator is reachable from the AMIPS pipelines; **`NOT VERIFIED`** whether an enabled cron currently drives generation end-to-end (that requires the deployed Vercel cron configuration). Kill switch enforced (routes through `groqChat`). |

---

### A.14 — SEO Article Generator

| Field | Value |
| --- | --- |
| **NAME** | Content article generator |
| **LOCATION** | `frontend/lib/content/generator.ts:170` (`generateArticle`), Groq call at `:185` |
| **USER / PORTAL** | ADMIN / system → public content |
| **PURPOSE** | Generate SEO article drafts with FAQs |
| **MODEL / PROVIDER** | Groq via `groqChat` |
| **PROMPT LOCATION** | `lib/content/prompts.ts` |
| **WRITE CAPABILITIES** | Content records via `content-generation-processor.service.ts:174` |
| **AUTHENTICATION** | Cron secret — `app/api/cron/content-generation-drain/route.ts:19` |
| **CONFIRMATION BOUNDARY** | `reviewOnly` flag + `lib/content/compliance.ts` + `lib/content/quality.ts` gates |
| **AUDIT LOGGING** | Cron run logging |
| **CALLERS** | `frontend/lib/services/content/content-generation-processor.service.ts:174` ← `frontend/app/api/cron/content-generation-drain/route.ts:14` |
| **TEST COVERAGE** | `test:content`, `test:admin-content`, `test:content-ui`, `app/api/cron/__tests__/content-generation-drain-route.test.ts` |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. Kill switch enforced via `groqChat`. |

---

### A.15 — Social Script Engine

| Field | Value |
| --- | --- |
| **NAME** | Social post script generator |
| **LOCATION** | `frontend/lib/social/groq-script.engine.ts:363` (`generateSocialScript`) |
| **USER / PORTAL** | ADMIN |
| **MODEL / PROVIDER** | Groq — **direct REST call, not `groqChat`** |
| **WRITE CAPABILITIES** | Social post records via `social-post.orchestrator.ts:206` |
| **AUTHENTICATION** | Admin routes (`getAdminFromRequest`) and cron secret |
| **CONFIRMATION BOUNDARY** | **Yes** — `approvePost`/`rejectPost` (`app/api/admin/social/posts/[postId]/route.ts:8`); publishing is a separate approved-only path (`publishApprovedPost`) |
| **AUDIT LOGGING** | Not observed at the engine level |
| **SIDE EFFECTS** | Outbound publishing when a post is approved and published |
| **CALLERS** | `frontend/lib/social/social-post.orchestrator.ts:206,232`; `frontend/lib/social/hook-ab-testing.engine.ts:48` ← `app/api/admin/social/generate/route.ts:9`, `app/api/cron/social-generate/route.ts:15` |
| **TEST COVERAGE** | `lib/social/__tests__/publishing-factory.test.ts`, `analytics-null-contract.test.ts` — neither covers script generation |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. **Kill switch NOT enforced.** |

---

### A.16 — Social Visual-Prompt Engine

| Field | Value |
| --- | --- |
| **NAME** | Visual prompt generator |
| **LOCATION** | `frontend/lib/social/visual-prompt.engine.ts:267` (`generateVisualPrompt`) |
| **MODEL / PROVIDER** | Groq — direct REST call |
| **CALLERS** | `frontend/lib/social/image-generation.service.ts:305` ← `app/api/admin/social/compose/route.ts:132`, `app/api/admin/social/generate-images/route.ts:20` |
| **WRITE CAPABILITIES** | Image records / `AiMediaGeneration` (`schema.prisma:5046`) |
| **AUTHENTICATION** | Admin |
| **TEST COVERAGE** | None |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. Kill switch NOT enforced. |

---

### A.17 — Trending-Intelligence Engine

| Field | Value |
| --- | --- |
| **NAME** | Trending intelligence |
| **LOCATION** | `frontend/lib/social/trending-intelligence.engine.ts:176` (`fetchTrendingIntelligence`), `:252` (`getOrFetchTrendingData`) |
| **MODEL / PROVIDER** | Groq — direct REST call |
| **DATA SOURCES** | `SocialIntelligenceCache` (`schema.prisma:5166`) |
| **CALLERS** | `app/api/admin/social/compose/ai-generate/route.ts:70`; `app/api/admin/social/publish-all/route.ts:58`; `app/api/admin/social/posts/[postId]/repost/route.ts:49` |
| **AUTHENTICATION** | Admin |
| **TEST COVERAGE** | None |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. Kill switch NOT enforced. |

---

### A.18 — Competitor Monitor

| Field | Value |
| --- | --- |
| **NAME** | Competitor content scanner |
| **LOCATION** | `frontend/lib/social/competitor-monitor.ts:24` (`scanCompetitorContent`) |
| **MODEL / PROVIDER** | Groq — direct REST call |
| **CALLERS** | `frontend/app/api/admin/social/competitor-scan/route.ts:17` (admin); `frontend/app/api/cron/social-optimize/route.ts:387` (cron) |
| **AUTHENTICATION** | Admin JWT / cron secret |
| **TEST COVERAGE** | None |
| **RUNTIME STATUS** | **ACTIVE** — `CODE-VERIFIED`. Kill switch NOT enforced. |

---

### A.19 — Market Index Generator

| Field | Value |
| --- | --- |
| **NAME** | Social market index |
| **LOCATION** | `frontend/lib/social/market-index.generator.ts:88` (`generateMarketIndex`), `:223` (`publishMarketIndex`) |
| **MODEL / PROVIDER** | Groq — direct REST call |
| **WRITE CAPABILITIES** | Publishes a market-index artifact |
| **CALLERS** | `frontend/app/api/admin/social/market-index/route.ts:80`; `frontend/app/api/cron/social-market-index/route.ts:9` |
| **AUTHENTICATION** | Admin / cron secret |
| **TEST COVERAGE** | None |
| **RUNTIME STATUS** | **ACTIVE** for `publishMarketIndex`/`generateMarketIndex` — `CODE-VERIFIED`. `generateAndPublishMarketIndex` (`:505`) and `generateIntelligenceIndex` (`:432`) are **DORMANT** — `generateAndPublishMarketIndex` has zero non-definition references anywhere; `generateIntelligenceIndex` is referenced only from inside that dormant function (`:506`). Kill switch NOT enforced. |

---

### A.20 — The Seven-Agent Roster (`lib/services/ai/agents.ts`)

| Field | Value |
| --- | --- |
| **NAME** | Role-aware agent roster + `routeToAgent` |
| **LOCATION** | `frontend/lib/services/ai/agents.ts:10` (buyer), `:17` (prequal), `:24` (search), `:32` (auction), `:39` (deal), `:46` (dealer), `:54` (admin briefing), `:87` (`routeToAgent`) |
| **USER / PORTAL** | Buyer / dealer / admin |
| **PURPOSE** | Seven specialised personas with per-persona guardrails (e.g. prequal: "NEVER mention the specific dollar amounts from iPredict"; auction: "Never reveal dealer identities during a live auction") |
| **MODEL / PROVIDER** | Groq via `groqChat` |
| **PROMPT LOCATION** | `agents.ts` inline + `lib/ai/context-builder.ts:81` |
| **CALLERS** | **Only `adminBriefingAgent`** — `app/api/admin/ai/briefing/route.ts:7` and `lib/services/admin/morning-briefing.service.ts:2`. `routeToAgent` and the other six agents have **zero callers** |
| **TEST COVERAGE** | None |
| **RUNTIME STATUS** | **DORMANT (6 of 7 agents + `routeToAgent`)** / **ACTIVE (`adminBriefingAgent` only)** — `CODE-VERIFIED`. Searched for every exported agent name and for `routeToAgent` across `app/`, `lib/`, `components/`; only the briefing agent is referenced. |

**Consequence (CODE-VERIFIED):** the per-persona guardrails above are not in
force anywhere. `frontend/app/admin/ai/page.tsx:69` advertises "7 (General,
PreQual, Search, Auction, Deal, Dealer, Admin Briefing)" as available agents;
one is reachable. `lib/ai/context-builder.ts` (`buildBuyerContext`,
`buildDealerContext`, `buildAdminContext`, `buildSystemPromptFromContext`) is
imported only by this dormant module and is therefore dormant with it.

---

### A.21 — `/api/finder` — scripted 8-turn intake

| Field | Value |
| --- | --- |
| **NAME** | Conversational vehicle finder (scripted) |
| **LOCATION** | `frontend/app/api/finder/route.ts:102` (POST) |
| **USER / PORTAL** | PUBLIC / anonymous |
| **PURPOSE** | 8-turn scripted intake with LLM extraction and hot-lead scoring |
| **INPUTS** | `sessionId`, `userMessage`, `turnNumber`, prior `extractedData` |
| **OUTPUTS** | `{ nextQuestion, extractedData, complete }` |
| **MODEL / PROVIDER** | Groq `llama-3.1-8b-instant` via `extractVehicleData` (`lib/ai/acquisition.ts:156`); scoring via `scoreLeadWithGroq` → `openai/gpt-oss-20b` (`:228`) |
| **PROMPT LOCATION** | Hard-coded question script `route.ts:28-35`; extraction prompt in `lib/ai/acquisition.ts` |
| **READ CAPABILITIES** | `prisma.buyer.findFirst({ where: { phone } })` — **any buyer, by phone number** (`:187`) |
| **WRITE CAPABILITIES** | `conversation.create`/`.update`; `leadScore.create`; **`buyer.update` setting `leadScore`/`leadTemperature` on a matched buyer** (`:192`); `leadScore.updateMany`; `conversation.update` linking `buyerId` (`:204`) |
| **AUTHENTICATION** | **NONE** |
| **HARD AUTHORIZATION** | **ABSENT.** Buyer matching is by attacker-supplied phone string |
| **CONFIRMATION BOUNDARY** | None |
| **AUDIT LOGGING** | None |
| **SIDE EFFECTS** | DB writes on a **third party's** Buyer row; `notifyFounderHotLead` SMS + `sendHotLeadBuyerSms` SMS (`:222-226`). The buyer SMS *is* suppression-checked fail-closed (`lib/services/acquisition/twilio.service.ts:160-171`) |
| **CALLERS** | **NONE in-app.** `components/acquisition/VehicleFinder.tsx` posts to `/api/concierge` (`:52`), not here. `frontend/proxy.ts:285` exempts the path from CSRF |
| **CURRENT UI SURFACE** | None |
| **CURRENT ZURA CONNECTION** | None (separate scripted flow) |
| **TEST COVERAGE** | **None** |
| **RUNTIME STATUS** | **DORMANT as a product surface, LIVE as an HTTP attack surface** — `CODE-VERIFIED`. No UI reaches it, but Next.js serves the route handler and it is CSRF-exempt, unauthenticated, and un-rate-limited. See finding §D.3 (HIGH). |

---

### A.22 — `VehicleFinder` component

| Field | Value |
| --- | --- |
| **NAME** | `VehicleFinder` — second public chat UI |
| **LOCATION** | `frontend/components/acquisition/VehicleFinder.tsx:21` |
| **PURPOSE** | An alternative public streaming chat UI posting to `/api/concierge` (`:52`) |
| **CALLERS** | **NONE.** No page or layout imports it |
| **TEST COVERAGE** | None |
| **RUNTIME STATUS** | **DORMANT** — `CODE-VERIFIED`. Searched `app/` and `components/` for `VehicleFinder`; the only hits are the file's own definition and log string. |

---

### A.23 — Dealer-recruitment AI trio

| Capability | Location | Provider / model | Entrypoints | Kill switch | Status |
| --- | --- | --- | --- | --- | --- |
| Cold-outreach email drafting | `frontend/lib/services/dealer-recruitment/email-template.service.ts:450` (`generateEmailTemplate`) | **Groq** `openai/gpt-oss-120b` (`:63`) — direct REST | `lib/services/dealer-recruitment/dealer-email-send.service.ts:169,298` | **No** | **ACTIVE** — `CODE-VERIFIED` |
| Phone-script drafting | `.../phone-script-drafter.service.ts:123` (`draftPhoneScriptForProspect`), `:233` (`draftAndSaveScript`) | **Groq** `openai/gpt-oss-120b` (`:193`) — direct REST | `app/api/admin/dealer-outreach/backfill/route.ts:59`; `app/api/admin/dealer-outreach/[prospectId]/regenerate-script/route.ts:27`; `lib/services/acquisition/intake-pipeline.service.ts:582` | **No** | **ACTIVE** — `CODE-VERIFIED` |
| Dealer email enrichment | `.../email-enrichment.service.ts:434` (`enrichDealerEmail`) | **Google Gemini 2.5 Flash** (`:20`) — direct REST | `app/api/admin/dealer-outreach/backfill-emails/route.ts:88`; `.../[prospectId]/reenrich-email/route.ts:31`; `lib/services/dealer-recruitment/contact-resolution.service.ts:29` | **No** | **ACTIVE** — `CODE-VERIFIED` |

All three write to dealer prospect records and feed outreach. Authentication is
admin (`getAdminFromRequest`) on the route surfaces. Test coverage exists for
enrichment parsing (`email-enrichment.test.ts`, `prospect-email-enrichment.test.ts`,
`contact-resolution.test.ts`, suite `test`) but not for the LLM call paths.
**Governance note:** the repo's `autolenis-dealer-outreach-governance` skill
requires outreach to stay disabled by default; whether outreach sending is
currently enabled in production is `NOT VERIFIED` (requires deployed env).

---

### A.24 — Acquisition intelligence cluster

| Capability | Location | Provider / model | Entrypoints | Kill switch | Status |
| --- | --- | --- | --- | --- | --- |
| Vehicle-data extraction | `frontend/lib/ai/acquisition.ts:156` (`extractVehicleData`) | Groq `llama-3.1-8b-instant` | `app/api/finder/route.ts:146` | No | **DORMANT** (only caller is the dormant §A.21) — `CODE-VERIFIED` |
| Lead scoring (AI half) | `lib/ai/acquisition.ts:228` (`scoreLeadWithGroq`) via `lib/services/acquisition/scoring.service.ts:64` (`scoreLeadFromConversation`) | Groq `openai/gpt-oss-20b` | `app/api/crm/dispatch/score/route.ts:109`; `app/api/finder/route.ts:174`; `lib/services/acquisition/intake-pipeline.service.ts:18` | No | **ACTIVE** — `CODE-VERIFIED`. Has a deterministic fallback (`computeDeterministicScore`, `scoring.service.ts:13`) |
| **Opt-out (STOP) detection** — *widening fallback only* | `lib/ai/acquisition.ts:279` (`detectOptOutIntent`) | Groq `openai/gpt-oss-safeguard-20b` | `app/api/twilio/sms/inbound/route.ts:92`, **after** the deterministic keyword check at `:90` | No | **ACTIVE** — `CODE-VERIFIED` |
| Dealer discovery (Maps-grounded) | `lib/services/acquisition/gemini-maps.service.ts:47` (`discoverDealersViaGeminiMaps`), `:369` (`enrichMarketViaGemini`) | **Google Gemini 2.5 Flash** (`:4`) | `lib/services/acquisition/compound-search.service.ts:374` | No | **ACTIVE** — `CODE-VERIFIED` |
| Compound market search | `compound-search.service.ts:204` (`enrichMarketData`), `:353` (`discoverDealers`) | Groq `groq/compound` + `groq/compound-mini` (`:15-16`) | `lib/services/acquisition/intake-pipeline.service.ts:377` | No | **ACTIVE** — `CODE-VERIFIED` |
| Hot-lead buyer SMS drafting | `lib/services/acquisition/twilio.service.ts:121-149` | **Anthropic `claude-haiku-4-5`** via raw `fetch` to `api.anthropic.com/v1/messages` (`:121-129`) | `app/api/finder/route.ts:225`; `lib/services/acquisition/intake-pipeline.service.ts` | No | **ACTIVE** — `CODE-VERIFIED`. Falls back to `buildFallbackBuyerSms` on failure |

**`detectOptOutIntent` deserves separate emphasis — and it is correctly built.**
`app/api/twilio/sms/inbound/route.ts:90` evaluates the deterministic keyword set
`{STOP, STOPALL, UNSUBSCRIBE, CANCEL, QUIT, END}` (`:25`) **first**, and only
calls the model when that check misses (`:91-93`). The LLM can therefore only
*widen* the opt-out set, never narrow it. Its failure path returns `false`
(`lib/ai/acquisition.ts:305-307`), which leaves the keyword result standing.
Fail-safe direction is correct. `CODE-VERIFIED`. See §D.6.

---

### A.25 — Supporting AI modules (no independent capability)

| Module | Location | Status | Evidence |
| --- | --- | --- | --- |
| Groq provider wrapper | `frontend/lib/ai/groq-client.ts:37` (`groqChat`), `:81` (`groqChatStream`) | **ACTIVE** for `groqChat`; **DORMANT** for `groqChatStream` — its only importer is the dormant `agents.ts:5` and no agent calls it | `CODE-VERIFIED` |
| AI kill switch | `frontend/lib/ai/kill-switch.ts:5,11` | **PARTIAL** — enforced on one path of nineteen | `CODE-VERIFIED`, §C.14 |
| AI moderation | `frontend/lib/services/ai/ai-moderation.service.ts:5` (`moderateInput`), `:13` (`logAiKillSwitchEvent`) | **DORMANT** — zero importers | `CODE-VERIFIED` |
| AI context cache | `frontend/lib/services/ai/context-cache.service.ts:4,8` | **DORMANT** — zero importers; the only code touching `prisma.aiContextCache` is this unused module | `CODE-VERIFIED` |
| Context builder | `frontend/lib/ai/context-builder.ts:22,67,76,81` | **DORMANT** — sole importer is the dormant `agents.ts` | `CODE-VERIFIED` |
| Carousel generator | `frontend/lib/social/carousel.generator.ts:139` | **DORMANT** — zero non-definition references | `CODE-VERIFIED` |
| Whisper STT | `frontend/lib/voice/whisper-stt.service.ts:103` (`transcribeAudio`) | **ACTIVE** (OpenAI) via `app/api/twilio/voice/recording-complete/route.ts` | `CODE-VERIFIED` |
| ElevenLabs TTS | `frontend/lib/voice/elevenlabs-tts.service.ts:92` (`generateZuraSpeech`) | **ACTIVE** via `app/api/twilio/voice/incoming/route.ts:71,87` | `CODE-VERIFIED` |
| Call transfer | `frontend/lib/voice/call-transfer.service.ts:38,76` | **ACTIVE, flag-gated** — `isTransferEnabled()` requires env `=== "true"` | `CODE-VERIFIED` |

---

### A.26 — Orphaned AI database models

`CODE-VERIFIED` by searching every `prisma.<model>` accessor across `app/`,
`lib/`, and `scripts/`:

| Model | `schema.prisma` | Read? | Written? | Status |
| --- | --- | --- | --- | --- |
| `AiChatSession` | `:3460` | No | No | **DORMANT** — no code references it |
| `AiChatMessage` | `:3472` | No | No | **DORMANT**. Its comment names models never used in this codebase (`llama-3.3-70b-versatile \| mixtral-8x7b-32768`) |
| `AiConversationContext` | `:1380` | No | No | **DORMANT**. `app/api/buyer/ai/chat/route.ts:33` claims it logs "for cross-session memory (AiConversationContext)" but writes `BuyerActivityEvent` instead |
| `AiKillSwitchLog` | `:2711` | No | No | **DORMANT** — `logAiKillSwitchEvent` exists (§A.25) but has no callers |
| `AiContextCache` | `:3278` | Yes | Yes | Accessor exists; **DORMANT** because its service has no callers |
| `AiActionIntent` | `:3492` | Yes | Yes | Reachable via `PrismaActionIntentStore`, but see §A.8 — nothing can create a row |

**Consequence:** **no chat conversation is persisted server-side on any
authenticated Zura surface.** Buyer/dealer/admin/affiliate chat history lives
only in React state (`ChatWidget.tsx:51`), is truncated to the last 7 turns on
send (`:162`), and is lost on refresh. The only persisted AI conversations are
the public `BuyerOpportunity.messages` (`/api/concierge`) and
`Conversation.transcript` (`/api/finder`, dormant).

---

## SECTION B — ZURA SURFACE INVENTORY

**Reminder:** all §B findings are `CODE-VERIFIED` from source or `NOT VERIFIED`.
None is `BROWSER-VERIFIED` (§0). Characterisation follows
`autolenis-ui-design-system`; **no UX proposal is made.**

### B.1 The shared component

`frontend/components/public/ChatWidget.tsx` (430 lines, `"use client"`) is the
**single** chat component for all five surfaces. Its mode is chosen by two
props (`:36`):

```
useStreaming = !buyerId && !chatEndpoint
```

| Prop shape | Mode | Endpoint | Persistence |
| --- | --- | --- | --- |
| `<ChatWidget />` | public, streaming | `/api/concierge` | `BuyerOpportunity` |
| `buyerId` set | authenticated JSON | `/api/buyer/ai/chat` (default `:167`) | none |
| `chatEndpoint` set | authenticated JSON | that endpoint | none |

### B.2 PUBLIC surface

| Attribute | Value | Evidence |
| --- | --- | --- |
| Component | `ChatWidget` (public mode) | `components/public/ChatWidget.tsx:26` |
| Routes | `/` `:373`, `/for-buyers` `:628`, `/request-a-car` `:280`, `/lp/[campaign]` `:1631` | `CODE-VERIFIED` |
| Launcher | Fixed `bottom-6 right-6`, `z-50`; 56×56 px circular button, `bg-[#0B5FD1]`, `MessageCircle` 24 px, `shadow-xl`, `aria-label="Open chat"` | `:247, :418-427` |
| Chat UI | 320 px (`w-80`) → 384 px (`sm:w-96`); **fixed `height: 520px` inline style**; header `bg-[#0B5FD1]`, `Bot` avatar in `bg-white/20` circle | `:251-278` |
| Backend | `POST /api/concierge` (streaming `text/plain`) | `:96` |
| Model | Groq `gpt-oss-120b` stream + `gpt-oss-20b` extraction | §A.5 |
| Prompt source | `CONCIERGE_SYSTEM_PROMPT` + dynamic profile block | `app/api/concierge/route.ts:28,162` |
| Context assembled | Captured/missing field lists, turn number, full transcript | `route.ts:136-186` |
| Tools available | None | — |
| Persistence | `BuyerOpportunity` keyed on client `sessionId` | `route.ts:84-108` |
| Conversation history | Server-side full transcript; client keeps all messages in state | `route.ts:111`, `ChatWidget.tsx:51` |
| Authorization | **None** | §D.1 |
| Current-page awareness | **None** — no route/page prop is passed | `:373` etc. |
| Current-record awareness | Session-scoped `BuyerOpportunity` only | — |
| Responsive | One breakpoint (`sm:`). Panel is `fixed` at 520 px tall with 24 px bottom offset ⇒ needs ≥ 604 px viewport height. **On a 375×667 phone the panel is 320 px wide and does not overflow vertically; on a 360×640 device it clears by 16 px; below ~600 px height (landscape phone) it would overflow.** Not adaptive: no full-screen mobile mode | `:247-252` |
| Error behavior | Three distinct fallbacks: non-OK response (`:110`), stream exception (`:151`), and a generic connection error. All are plain assistant bubbles — no retry affordance, no error styling | `:110-157` |
| Loading/empty states | Three-dot bounce typing indicator (`:366-385`); a pulsing caret during streaming (`:358`); "empty" never occurs — a greeting is always seeded (`:51`) | — |
| Lead gate | Name + email, client-validated only (`:217-240`); regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`; disclosure text at `:332` | `CODE-VERIFIED` |
| Design-system usage | **Hard-coded hex `#0B5FD1` / `#0A4DB8` and raw Tailwind `slate-*`.** Does not use the `al-*` tokens (`al-primary`, `al-bg`) used elsewhere — e.g. `app/affiliate/portal/layout.tsx:27` uses `bg-al-bg`, `app/admin/ai/page.tsx:39` uses `text-al-primary` | `CODE-VERIFIED` |
| Kill-switch gating | `isAiEnabled()` called client-side (`:6,:72`). **Ineffective — see B.7** | `CODE-VERIFIED` |

**`NOT VERIFIED`:** whether the launcher actually renders on the live public
site, its real rendered position/z-order against other fixed elements, contrast
ratios as rendered, and mobile behaviour on a real device.

### B.3 BUYER surface

| Attribute | Value | Evidence |
| --- | --- | --- |
| Mount | `app/buyer/layout.tsx:281`, inside the scrolling `<div>` beside `JourneyNavigator` and `SessionExpiryWatcher` | `CODE-VERIFIED` |
| Props | `buyerId={buyer.id}`, `agentType="general"`, personalised greeting with `buyer.firstName` | `:282-284` |
| Endpoint | `/api/buyer/ai/chat` (the default branch) | `ChatWidget.tsx:167` |
| Prompt source | `ZURA_SYSTEM_PROMPT` + `ZURA_BUYER_CONTEXT_PREFIX` + injected state | §A.1 |
| Context assembled | Stage, budget, prequal tier, auction status, deal status | `buyer-concierge.agent.ts:70-89` |
| Tools | None | — |
| Persistence | **None** (a `BuyerActivityEvent` breadcrumb only) | `route.ts:34` |
| Conversation history | Client state; **last 7 turns** sent per request | `ChatWidget.tsx:162` |
| Authorization | Server-resolved buyer; deterministic | §A.1 |
| Current-page awareness | **None** | — |
| Current-record awareness | Implicit — most recent auction and deal, not the record on screen | `buyer-concierge.agent.ts:25-27` |
| Header text | Shows **"AutoLenis" / "Your Concierge"**, not "Zura" — the `isPublic` ternary (`:263,:266`) gives the Zura name only to the public surface, while the greeting says "I'm Zura" | `CODE-VERIFIED` — inconsistency |
| Responsive / error | Identical to §B.2 | — |

### B.4 DEALER surface

Mount `app/dealer/layout.tsx:37`; `chatEndpoint="/api/dealer/ai/chat"`;
placeholder "Ask me about inventory, auctions, or deal status…". Prompt is
**inline and does not include `ZURA_SYSTEM_PROMPT`** — the dealer Zura has a
different knowledge base from every other Zura. Header shows "AutoLenis / Your
Concierge". No persistence, no audit, no rate limit. Layout is
`flex-col lg:flex-row` with `DealerSidebar`. `CODE-VERIFIED`.

### B.5 ADMIN surface

Mount `app/admin/layout.tsx:35`; `chatEndpoint="/api/admin/ai/chat"`. Inline
prompt, no `ZURA_SYSTEM_PROMPT`. **The only surface with real audit logging.**
Ground is `bg-[#F4F6FA]` where dealer uses `bg-[#F8F9FA]` and affiliate uses
the token `bg-al-bg` — three different page grounds for the same shell pattern.

A **second, unrelated** admin AI surface exists at `app/admin/ai/page.tsx`
("Zura — AI Concierge" console): a status panel, config table, and morning
briefing generator. Two `CODE-VERIFIED` defects:
1. Its "Chat with Zura" button targets `[data-testid='chat-toggle-btn']`
   (`:45`); the widget's launcher is `data-testid="open-chat-btn"`
   (`ChatWidget.tsx:423`). **That selector matches nothing anywhere in the
   repository**, so the button always falls through to the "isn't available on
   this screen" toast — while the widget is in fact mounted by the admin
   layout. **BROKEN.**
2. Its config table asserts "Provider: Groq API (only approved provider)"
   (`:61`) and the footer asserts "Anthropic, OpenAI, Gemini, and Cohere are
   explicitly prohibited. All AI features use Groq API exclusively" (`:104`).
   Contradicted by §A.7, §A.23, §A.24: Gemini 2.5 Flash, `claude-haiku-4-5`,
   and OpenAI Whisper all run in production paths. It also advertises 7 agents
   where 1 is reachable (§A.20).

A **third** admin AI surface is the CRM `CopilotPanel`
(`components/admin/crm/CrmShell.tsx:109`) — a slide-over, not the floating
bubble, not Zura-branded (§A.9).

### B.6 AFFILIATE surface

Mount `app/affiliate/portal/layout.tsx:28`;
`chatEndpoint="/api/affiliate/ai/chat"`. Inline prompt, no
`ZURA_SYSTEM_PROMPT`; the affiliate's **email address is interpolated into the
system prompt**. Only surface using the design token `bg-al-bg` (`:27`). No
persistence, no audit, no rate limit. `CODE-VERIFIED`.

### B.7 Cross-portal inconsistencies (observation only)

| # | Inconsistency | Evidence |
| --- | --- | --- |
| 1 | **Prompt source diverges.** Public streaming uses `CONCIERGE_SYSTEM_PROMPT`; public non-streaming (dormant) and buyer use `ZURA_SYSTEM_PROMPT`; dealer/admin/affiliate use inline prompts; voice uses `ZURA_VOICE_PROMPT`. **Five prompt bodies, one brand.** | §A.1–A.7 |
| 2 | **Panel header omits the Zura name on all four authenticated portals.** `isPublic ? "Zura" : "AutoLenis"` | `ChatWidget.tsx:263,266` |
| 3 | **A different assistant name is hard-coded as the authenticated fallback greeting: "Hi! I'm Alex, your AutoLenis concierge."** It is masked today only because all four layouts pass `initialGreeting`. | `ChatWidget.tsx:41` |
| 4 | **Client-side kill switch is inert.** `isAiEnabled()` reads `process.env.AI_KILL_SWITCH` from a `"use client"` component. `next.config.mjs` defines no `env` block and the variable is not `NEXT_PUBLIC_*`, so it is `undefined` in the browser and `killSwitch !== "true"` is always true. `aiAvailable` starts `true` and only flips on an `AI_DISABLED` response (`:187`) — which the public streaming path never returns. Same defect in `app/admin/ai/page.tsx:18`. | `CODE-VERIFIED` |
| 5 | **`agentType` is a dead prop.** Typed with five values (`:12`), sent on every authenticated request (`:174`), routed by nothing. | `route.ts:39` |
| 6 | **Three page grounds for one shell**: `#F8F9FA` (dealer), `#F4F6FA` (admin), `bg-al-bg` (affiliate), and the buyer layout's own. | layouts |
| 7 | **Widget bypasses the design system** — hard-coded `#0B5FD1`/`#0A4DB8` and raw `slate-*` rather than `al-*` tokens, in the one component rendered on every page of every portal. | `ChatWidget.tsx` |
| 8 | **No conversation persistence on any authenticated surface**, despite four schema models built for it. | §A.26 |
| 9 | **Rate limiting exists on exactly one AI endpoint, and it is the dormant one.** | §A.6 |
| 10 | **Audit logging exists on exactly one chat surface** (admin). | §A.3 |
| 11 | **No `role="log"`/`aria-live` on the message list** (`:340`), so streamed replies are not announced to screen readers; the panel is a plain `div` with no `role="dialog"`, no focus trap, and no focus move on open. | `CODE-VERIFIED` |
| 12 | **No test coverage** for `ChatWidget` or any chat route. | §A.1–A.6 |

---

### B.8 — THE CENTRAL QUESTION

> **Are these one Zura rendered in multiple contexts, or multiple unrelated
> implementations sharing a brand name?**

**Verdict: one shared *shell*, five unrelated *brains*. AutoLenis has a single
Zura presentation layer and five independent Zura implementations behind it.**

**Shared-module evidence (what genuinely is one Zura):**
- One component renders every web surface: `components/public/ChatWidget.tsx`,
  imported by all four portal layouts and four public pages.
- One provider wrapper for most paths: `lib/ai/groq-client.ts`.
- One kill-switch module (however unevenly applied): `lib/ai/kill-switch.ts`.
- One dormant action-boundary module imported by all four agents:
  `lib/services/ai/action-intent`.

**Absence-of-sharing evidence (what is not one Zura):**
- **Five different system prompts.** Only two of the six chat/voice surfaces
  import `ZURA_SYSTEM_PROMPT` — the buyer agent and the dormant
  `/api/public/ai/chat`. Public streaming, dealer, admin, affiliate, and voice
  each author their own.
- **No shared agent abstraction.** The four concierge agents share no base
  class, no interface, no context builder, no history policy. Each re-derives
  its own Prisma context. The one module that *was* a shared abstraction
  (`lib/ai/context-builder.ts` + `routeToAgent`) is dormant (§A.20).
- **Divergent transport contracts.** Public is a raw `text/plain` stream;
  authenticated portals are `{ success, data: { content } }` JSON. The single
  component carries two entirely separate `sendMessage` implementations
  (`ChatWidget.tsx:90-207`).
- **Divergent identity.** The public panel says "Zura"; all four authenticated
  panels say "AutoLenis"; the unused fallback says "Alex".
- **Divergent guarantees.** Rate limiting: 1 of 6 surfaces (and it is dormant).
  Audit: 1 of 6. Persistence: 1 of 6. Kill switch honoured: 3 of 6.
- **Voice Zura shares nothing with web Zura** but the name — separate prompt,
  separate store, separate providers, separate side-effect surface.

The brand is unified. The implementation is not.

---

## SECTION C — ORCHESTRATION INFRASTRUCTURE AUDIT

This section determines whether Phase 2 extends existing infrastructure or
proposes new. Building a parallel system is prohibited by `CLAUDE.md`, so each
row states what exists, where, and what is missing.

| # | Component | Present? | Path evidence | Assessment |
| --- | --- | --- | --- | --- |
| 1 | **Agent registry** | **Partial — two competing ones, both weak** | `lib/services/ai/agents.ts:85-105` (`AgentType` union + `routeToAgent` switch) — **dormant**. `lib/services/ai/action-intent/catalog.ts:303` (`listIntentsForActor`) — an *intent* registry keyed by actor, not an agent registry | No registry maps a surface to an agent implementation. The four live agents are wired by direct import in four route files |
| 2 | **Tool registry** | **Yes, deterministic and well-built** | `lib/services/ai/action-intent/catalog.ts:40-296` — 12 typed intents with Zod schemas, permitted roles, consequence class, approval requirement, activation key, canonical-service pointer | Genuine, tested (`catalog.test.ts`), fail-closed on unknown names (`authorize.ts:29-37`). **Extend this; do not build another.** |
| 3 | **Command registry** | **Yes** | `lib/services/ai/action-intent/commands.ts:16-161` (`COMMANDS`), `:163` (`getCommand`) — 12 lazy-imported adapters onto canonical services | Correct shape: commands invoke existing services rather than reimplementing logic |
| 4 | **Capability catalog** | **Yes** — same artifact as #2 | `catalog.ts` carries `consequence`, `availability`, `requiresHumanApproval`, `approverPermission`, `canonicalService`, `idempotency` per entry | Richer than a bare tool list |
| 5 | **AI router** | **NO** | Searched `aiRouter`, `intentRouter`, `orchestrat` across `app/`+`lib/`. Hits are `social-post.orchestrator.ts` (social publishing, unrelated) and `action-intent/engine.ts` | Each surface hard-wires one agent. No provider- or model-level routing either — model choice is a per-file constant |
| 6 | **Intent router** | **NO for the web surfaces; ad-hoc for voice** | `lib/voice/handle-turn.ts:98-170` runs a second LLM call that classifies `callReason` and branches on it (`:536-583`). That is the **only** intent classification in the product, it is voice-only, and it is LLM-mediated rather than deterministic | `guidance.ts` teaches models to *name* an intent, but nothing parses the reply |
| 7 | **Planner** | **NO** (one narrow exception) | `lib/ai/crm-copilot.ts:363` `generateAutomationPlan` produces a Zod-validated CRM automation plan — domain-specific, admin-only, draft-only | No general task planner |
| 8 | **Action layer** | **Yes, but with no input** | `lib/services/ai/action-intent/engine.ts:85,167,254,310` — propose → authorize → policy → approve → revalidate → execute → audit | Complete and tested. **`proposeIntent` has zero production callers** (§A.8) |
| 9 | **Policy layer** | **Yes, deterministic** | `lib/services/ai/action-intent/policy.ts:26-126`, deps at `:141-190` | Ownership/IDOR, auction/offer/deal/deposit state, and the `$99` fulfillment-gate money check. **Fail-closed on an unregistered intent** (`:135`) |
| 10 | **Approval boundary** | **Yes, server-authoritative** | `engine.ts:156-160` (halt), `:217-251` (`assertApprover`), `approval-permissions.ts:27-54` | SYSTEM can never approve (`:218`); admin intents enforce the declared RBAC permission (`:229`); unknown permission → deny (`approval-permissions.ts:52`); self-service intents allow same-principal confirmation only (`:240`). Reachable via `app/api/admin/action-intents/[id]/approve/route.ts:45` |
| 11 | **Command adapters** | **Yes** — same artifact as #3 | `commands.ts` | Every adapter delegates to a canonical service |
| 12 | **Audit architecture** | **Fragmented — no unified AI audit** | Present: `auditLogRecorder` → `AuditLog` for ActionIntent (`store.ts`); `createAuditLog` `ADMIN_AI_CHAT` (`app/api/admin/ai/chat/route.ts:31`); `writeCrmAuditLog` `CRM_COPILOT_GENERATE`/`_APPROVE`. Absent: buyer, dealer, affiliate, public, and voice AI interactions | Four of six Zura surfaces produce no audit record. `AiKillSwitchLog` (`schema.prisma:2711`) is never written |
| 13 | **Idempotency system** | **Yes, in the ActionIntent layer only** | `AiActionIntent.idempotencyKey @unique` (`schema.prisma`); `proposeIntent` collapse (`engine.ts:91-94`, `:148-150`); CAS transitions (`:319`, `:193`); `executionClaimedAt`/`executionAttempts`; tested by `postgres-concurrency.test.ts` | No idempotency on any *live* AI path. `/api/concierge` re-running its `after()` block would re-extract and re-promote |
| 14 | **AI kill switch** | **Present but PARTIAL** | `lib/ai/kill-switch.ts:5,11`; enforced in `groq-client.ts:41,85` and re-checked in 8 route handlers | **19 modules reach a model endpoint; 18 bypass the switch**: `lib/ai/acquisition.ts`, `lib/ai/crm-copilot.ts`, `lib/social/{market-index.generator, carousel.generator, competitor-monitor, visual-prompt.engine, trending-intelligence.engine, groq-script.engine}.ts`, `lib/services/acquisition/{twilio, gemini-maps, compound-search}.service.ts`, `lib/services/dealer-recruitment/{email-enrichment, email-template, phone-script-drafter}.service.ts`, `lib/voice/whisper-stt.service.ts`, and three `app/api/admin/social/*` routes. It is also **env-only** — no runtime toggle, no persistence, no admin control (`app/admin/ai/page.tsx` displays it read-only), and `AiKillSwitchLog` is never written |
| 15 | **Provider abstraction** | **NO** | `lib/ai/groq-client.ts` is a *Groq* client with two hard-coded model constants (`:8-9`), not a provider abstraction. `lib/ai/acquisition.ts:12-25` defines a second, parallel model lineup and calls Groq's REST endpoint directly, explicitly because "`groqChat()` … hardcodes its model" (`:2-6`). Gemini (`gemini-maps.service.ts:4`, `email-enrichment.service.ts:20`), Anthropic (`twilio.service.ts:121`), and OpenAI (`whisper-stt.service.ts`) each build their own HTTP call | **Four providers, at least nine model identifiers, zero abstraction.** Fallback logic exists only inside `groqChat` (`:65`) |

### C.16 — The structural gap Phase 2 must reckon with

The deterministic half of an AI action system is **built, tested, and correct**:
catalog, authorization, policy, approval, revalidation, commands, durable store,
audit, idempotency, concurrency safety — 10 module test files plus a route test
suite, wired into `package.json` as `test:action-intent` and
`test:action-intent-routes`.

The **AI half does not exist**. There is no code anywhere that reads a model's
response and produces an `ActionIntentProposal`. `buildActorGuidance` teaches
the model to name an intent (`guidance.ts:35-52`), but the four agents return
`{ content, model }` (§A.1–A.4) and every route returns that string straight to
the browser. `CODE-VERIFIED` by searching `proposeIntent`, `ActionIntentProposal`,
and `intentType` across `app/`, `lib/`, and `components/`, excluding the module
itself: zero hits.

**Phase 2 must extend this layer, not replace it.** The missing piece is one
extraction/adapter step, not a new orchestration system.

---

## SECTION D — AUTHORIZATION AND CROSS-PORTAL FINDINGS

### D.0 Where the authorization decision is actually made

| Capability | Decision point | Type |
| --- | --- | --- |
| §A.1 Buyer concierge | `getRequestBuyer` → `resolveAuthorizedBuyer` (`lib/auth/api.ts:132`) | **Deterministic server check** |
| §A.2 Dealer concierge | `getRequestDealer` (`app/api/dealer/ai/chat/route.ts:14`) | **Deterministic** |
| §A.3 Admin concierge | `getAdminFromRequest` + `mfaVerified` + `isActive` (`lib/auth/admin-api.ts:20,26`) | **Deterministic (authn); role check ABSENT** |
| §A.4 Affiliate concierge | `getRequestAffiliate` | **Deterministic** |
| §A.5 `/api/concierge` | none | **ABSENT** |
| §A.6 `/api/public/ai/chat` | none needed (no data access) | N/A |
| §A.7 Voice Zura | Twilio HMAC (`twilio-verify.ts:56-90`) | **Deterministic (transport); identity = caller phone** |
| §A.8 ActionIntent | `authorize.ts:29-91` + `policy.ts` + `engine.ts:217-251` | **Deterministic, fail-closed, defence-in-depth** |
| §A.9 CRM Copilot | `requirePermissionActor("ai.use")` | **Deterministic permission (all-admin scope)** |
| §A.10 Briefing | admin JWT+MFA / cron secret | **Deterministic (authn); no role scoping** |
| §A.11 Search interpreter | buyer session | **Deterministic** |
| §A.12–A.13 AMIPS | admin | **Deterministic (authn); no role scoping** |
| §A.14 Article generator | cron secret | **Deterministic** |
| §A.15–A.19 Social AI | `getAdminFromRequest` / cron secret | **Deterministic (authn); no role scoping** |
| §A.21 `/api/finder` | none | **ABSENT** |
| §A.23 Dealer-recruitment AI | admin routes | **Deterministic (authn)** |
| §A.24 Acquisition cluster | inherited from caller; Twilio HMAC for SMS inbound | **Mixed** |

**Cases where model output influences an access or control decision:**

1. **Voice `callReason` classification** (`handle-turn.ts:536-583`) — an LLM
   label selects whether to transfer a live call, dispatch a vehicle request
   (creating `User` + `Buyer`), or send a founder SMS. See §D.6.
2. **Not a case: `detectOptOutIntent`.** Initially suspected, then disproved by
   reading the handler: the deterministic keyword check runs first
   (`app/api/twilio/sms/inbound/route.ts:90`) and the model only widens it
   (`:91-93`). Model output cannot suppress an opt-out. See §D.6.
3. **Not a case:** ActionIntent. The model can only *name* an intent; every
   access decision is re-derived deterministically from authoritative state,
   twice (`authorize.ts`/`policy.ts` at proposal, and again at
   `engine.ts:288-307` immediately before execution). This design is correct.

### D.1 — HIGH · Anonymous AI endpoint with unbounded write authority

**`frontend/app/api/concierge/route.ts:60`**

Unauthenticated, un-rate-limited, CSRF-exempt (`frontend/proxy.ts:280`), and
not kill-switch protected. A single anonymous POST triggers two LLM calls and,
once the extractor believes the profile is complete (`route.ts:305-311`),
`promoteOpportunity` (`:336`) creating a `VehicleRequest` and enqueueing the
durable intake pipeline — dealer discovery, phone-script drafting, lead scoring,
alerts, outreach — plus a CRM contact upsert that **sets `consentEmail` and
`consentSms` to true** from a purely client-side lead gate (`:390-398`).

`sessionId` is minted client-side (`ChatWidget.tsx:70`) and is the only
identity. Any party may supply an arbitrary UUID and drive unlimited sessions.

**Impact:** unbounded LLM spend; unbounded `BuyerOpportunity` growth; synthetic
vehicle requests entering the dealer-sourcing pipeline; CRM contacts written
with an asserted-but-unverified consent basis.

**Evidence:** `route.ts:60` (no auth), no `limitGeneral` in the file, no
`isAiEnabled` in the file or in `lib/ai/acquisition.ts`, `proxy.ts:280`.
`CODE-VERIFIED`.

### D.2 — HIGH · The AI kill switch does not stop AI

**`frontend/lib/ai/kill-switch.ts:5`** + 18 bypassing modules (enumerated in
§C.14).

`AI_KILL_SWITCH=true` stops only calls routed through `groqChat`. It does **not**
stop the public streaming concierge, the CRM copilot, six social engines, three
dealer-recruitment services, Gemini dealer discovery, the Anthropic SMS drafter,
Whisper STT, or three admin social routes. The switch is env-only: flipping it
requires a redeploy, there is no admin control, and `AiKillSwitchLog`
(`schema.prisma:2711`) is never written, so no record of activation exists.

**Impact:** the platform's designated emergency stop for AI cannot stop the
majority of AI activity, including every public-facing AI path except the
dormant one.

**Evidence:** `CODE-VERIFIED` by enumerating every file containing a model
endpoint or SDK constructor and checking each for `assertAiEnabled`/`isAiEnabled`.

### D.3 — HIGH · Anonymous path mutates an authenticated buyer's record

**`frontend/app/api/finder/route.ts:187-207`**

The route is unauthenticated, un-rate-limited, and CSRF-exempt
(`frontend/proxy.ts:285`). On turn 7 it looks up
`prisma.buyer.findFirst({ where: { phone: extractedData.phone } })` using a
phone number supplied in the request body, and if a buyer matches it:

- overwrites that buyer's `leadScore` and `leadTemperature` (`:192-197`),
- reassigns the attacker's `LeadScore` rows to that `buyerId` (`:199`),
- links the attacker's `Conversation` to that buyer (`:204`),
- and, if the LLM scores the fabricated conversation "hot", sends an SMS to
  that phone number (`:223`).

No consent check, no ownership check, no rate limit. The SMS is
suppression-checked fail-closed
(`lib/services/acquisition/twilio.service.ts:160-171`), which limits — but does
not remove — the messaging exposure.

**Mitigating context:** no AutoLenis UI calls this route (§A.21), so it is not
in the normal traffic path. **It is still served and publicly reachable.**

**Evidence:** `CODE-VERIFIED`.

### D.4 — MEDIUM · Admin AI ignores the specific admin's role

**`frontend/app/api/admin/ai/chat/route.ts:14`** ·
**`frontend/lib/services/ai/admin-concierge.agent.ts:9-14`**

`getAdminFromRequest` proves *an* MFA-verified active admin. It does not
distinguish `SUPPORT_ADMIN` from `SUPER_ADMIN`. Every admin role receives the
same platform-wide aggregate context. The admin identity is not even passed to
`adminConciergeChat` (`:51`), so per-role scoping is not expressible without a
signature change. The same pattern holds for the morning briefing (§A.10 —
`adminRole` reaches the prompt but gates nothing), the AMIPS narrative (§A.12),
and the social AI routes (§A.15–A.19). `requirePermissionActor("ai.use")` on
the CRM copilot resolves to all five admin roles
(`action-intent/approval-permissions.ts:37`).

This is the brief's "admin paths that bypass the specific admin's role".
Exposure today is bounded — the context is aggregate counts, no PII — but the
boundary is structural, not incidental. `CODE-VERIFIED`.

### D.5 — MEDIUM · Client-side kill switch is inert

**`frontend/components/public/ChatWidget.tsx:6,72`** ·
**`frontend/app/admin/ai/page.tsx:18`**

Both `"use client"` modules call `isAiEnabled()`, which reads
`process.env.AI_KILL_SWITCH`. The variable is not `NEXT_PUBLIC_*` and
`next.config.mjs` declares no `env` block, so it is `undefined` in the browser
and the function always returns `true`. The widget's hide-when-disabled branch
(`:242`) and the admin console's "Kill Switch ON" badge (`:41`) therefore never
reflect a real kill-switch state.

Server routes still enforce correctly, so this is a **UI-truthfulness** defect,
not an access-control bypass: an operator reading the admin console would be
told AI is Active when it is disabled. `CODE-VERIFIED`.

### D.6 — MEDIUM · LLM output gates real-world side effects (voice)

**`frontend/lib/voice/handle-turn.ts:536-583`.** The `callReason` label produced
by an LLM extraction call selects a control-flow branch that can escalate to a
live call transfer (`:560-563`) and dispatch a vehicle request creating `User`
and `Buyer` rows (`lib/voice/dispatch-request.ts:128-236`). No deterministic
re-check follows the classification. The transfer path is separately flag-gated
(`call-transfer.service.ts:38`, requires the literal `"true"`), which bounds the
worst case; the dispatch path is not.

`CODE-VERIFIED` for the call path.

**Not a finding — STOP/opt-out detection.** This was flagged during discovery
and then **disproved by reading the handler**. `app/api/twilio/sms/inbound/route.ts`
runs the deterministic keyword set first (`:90`, keywords at `:25`) and calls
`detectOptOutIntent` only when that misses (`:91-93`). The model can add an
opt-out but can never remove one, and its failure path returns `false`
(`lib/ai/acquisition.ts:305-307`), leaving the deterministic result intact.
Signature verification is enforced fail-closed on this route (`:60-68`), and a
detected opt-out writes to the canonical suppression store plus the buyer flag
(`:104-110`). The lack of kill-switch protection on this call is real but
harmless here: with AI disabled the keyword check still governs. **No severity
assigned.** `CODE-VERIFIED`.

### D.7 — LOW · PII interpolated into a system prompt

**`frontend/lib/services/ai/affiliate-concierge.agent.ts:35`** — the affiliate's
email address is embedded in the system prompt and transmitted to Groq on every
turn. `frontend/app/buyer/layout.tsx:284` and
`frontend/lib/services/ai/buyer-concierge.agent.ts:72` similarly send the
buyer's first name, and `:76` sends the approved budget. All are the data
subject's own data, sent to the platform's contracted model provider — a
disclosure/DPA question rather than a boundary violation. Recorded for
completeness. `CODE-VERIFIED`.

### D.8 — LOW · Dealer prompt claims access the context does not grant

**`frontend/lib/services/ai/dealer-concierge.agent.ts:60`** tells the dealer
model it knows the buyer's "approved max" while the assembled context contains
no buyer data (`:37-42`). Dealer isolation holds today because the data is
absent, not because the rule is enforced. If a future change adds buyer context
to this agent, the prompt already invites disclosure. `CODE-VERIFIED`.

### D.9 — Explicit checks the brief required

| Question | Answer | Evidence |
| --- | --- | --- |
| Public/anonymous paths that reach authenticated data | **YES — 1 confirmed.** `/api/finder` reads and writes a `Buyer` row by attacker-supplied phone (§D.3). `/api/concierge` writes only its own session's `BuyerOpportunity`, but promotes into the authenticated pipeline (§D.1) | `CODE-VERIFIED` |
| Buyer-reachable paths that reach admin capability | **NO.** `/api/buyer/ai/chat` reaches only `buyerConciergChat`, whose reads are keyed on the server-resolved buyer id. ActionIntent would reject a buyer proposing an admin intent at `authorize.ts:51` and `:60` — and is unreachable regardless | `CODE-VERIFIED` |
| Dealer-reachable paths that read another dealer's records | **NO.** Every read in `dealer-concierge.agent.ts` is keyed on the server-resolved `dealer.id`; `policy.ts:59-72` would additionally enforce invitation ownership | `CODE-VERIFIED` |
| Affiliate-reachable paths that reach finance/admin data | **NO.** Reads are own-affiliate only. `affiliate.request_payout` is cataloged `UNAVAILABLE` (`catalog.ts:265`), rejected at `authorize.ts:41`, denied again at `policy.ts:113`, and hard-fails in `commands.ts:134` — triple defence | `CODE-VERIFIED` |
| Admin paths that bypass the specific admin's role | **YES** — §D.4 | `CODE-VERIFIED` |
| An agent whose broad internal capability is exposed to a narrower user through a shared entrypoint | **NO today, but the shape is present.** `ChatWidget` is one component serving five trust levels; separation rests entirely on the `chatEndpoint`/`buyerId` prop pair (`ChatWidget.tsx:36`) with the real boundary at each route's auth call. Since each endpoint hard-wires exactly one agent, a prop mistake yields a 401, not a privilege escalation. The risk becomes live the moment a single endpoint dispatches by a client-supplied selector — **the dormant `agentType` prop (§B.7 #5) is exactly that selector, already on the wire** | `CODE-VERIFIED` |

**Severity summary: 3 HIGH, 2 MEDIUM, 2 LOW. Nothing was fixed in this phase.**

---

## SECTION E — OVERLAP ANALYSIS

Capability-level diffs. **No consolidation or deletion is recommended — that is
an owner decision in a later phase.**

### E.1 `/api/concierge` vs `/api/public/ai/chat`

| Dimension | `/api/concierge` (§A.5) | `/api/public/ai/chat` (§A.6) |
| --- | --- | --- |
| Inputs | `sessionId`, `userMessage`, gate name/email | `message`, `history` |
| Outputs | `text/plain` stream | JSON `{ content, model }` |
| Data sources | `BuyerOpportunity` | none |
| Prompt | `CONCIERGE_SYSTEM_PROMPT` + dynamic | `ZURA_SYSTEM_PROMPT` |
| Model | 120b stream + 20b extraction | 120b, 300 tokens |
| Side effects | DB writes, VehicleRequest, pipeline, CRM, events | none |
| Rate limit | none | 20/hour per IP |
| Kill switch | **no** | yes |
| Status | ACTIVE | DORMANT |

**Verdict: NOT duplicates.** Different contracts, different purposes
(stateful intake vs stateless Q&A). The overlap is in *brand and audience*, not
capability. The notable fact is that the guarded one is unused.

### E.2 `/api/concierge` vs `/api/finder`

| Dimension | `/api/concierge` | `/api/finder` |
| --- | --- | --- |
| Flow | Free-form LLM conversation | 8 hard-coded questions (`route.ts:28-35`) |
| Extraction | `extractStructuredData` (20b) | `extractVehicleData` (8b-instant) |
| Persistence | `BuyerOpportunity` | `Conversation` + `LeadScore` |
| Scoring | Deferred to the intake pipeline | Inline at turn 7 (`:173`) |
| Buyer linkage | via `promoteOpportunity` | **direct `buyer.update` by phone** (`:192`) |
| Downstream | Durable intake pipeline | Direct founder + buyer SMS |
| Status | ACTIVE | DORMANT (no UI caller) |

**Verdict: DUPLICATED capability, different implementations.** Both are
anonymous conversational vehicle intake producing a scored lead. They persist to
**different tables** (`BuyerOpportunity` vs `Conversation`), so a lead arriving
through one is invisible to the other. `/api/concierge`'s own comment states the
"inline compound searches were retired so there is one discovery path"
(`route.ts:322-324`) — evidence of a deliberate consolidation that left
`/api/finder` behind rather than removing it.

### E.3 The seven-agent roster vs the four concierge agents

| Dimension | `lib/services/ai/agents.ts` (§A.20) | `lib/services/ai/*-concierge.agent.ts` (§A.1–A.4) |
| --- | --- | --- |
| Count | 7 personas + `routeToAgent` | 4 agents, one per portal |
| Context | Shared `lib/ai/context-builder.ts` | Per-agent bespoke Prisma reads |
| Prompt | `buildSystemPromptFromContext` + role line | Per-agent inline (buyer also uses `ZURA_SYSTEM_PROMPT`) |
| Guardrails | Per-persona (iPredict amounts, dealer identity during live auction) | Per-portal, generic |
| ActionIntent | Not integrated | Integrated (dormant) |
| Status | 6 of 7 + router DORMANT | ACTIVE |

**Verdict: DUPLICATED intent, disjoint implementations.** Both are "role-aware
Zura agents". The dormant set has the *stronger* guardrails and the only shared
context abstraction; the live set has the ActionIntent hooks. Neither imports
the other. Two per-portal system-prompt bodies exist for buyer, dealer, and
admin.

### E.4 `AiContextCache` vs `AiConversationContext`

Near-identical models (`schema.prisma:3278` and `:1380`): both keyed
`buyerId @unique`, both carrying a summary + `concerns` JSON, differing only in
`keyFacts` vs `preferences` and a `lastSessionAt` column. `AiContextCache` has
an accessor service (dormant); `AiConversationContext` has none.

**Verdict: DUPLICATED schema.** Neither is reachable from a live path (§A.26).

### E.5 Lead scoring — three implementations

| Implementation | Location | Type |
| --- | --- | --- |
| `computeDeterministicScore` | `lib/services/acquisition/scoring.service.ts:13` | Deterministic |
| `scoreLeadWithGroq` | `lib/ai/acquisition.ts:228` | LLM |
| `lib/crm/scoring-actions.ts:32` (`zura_conversation: 25`) | CRM action weights | Deterministic, different scale |

**Verdict: layered, not duplicated** for the first two —
`scoreLeadFromConversation` composes them with the deterministic path as
fallback (`scoring.service.ts:64-81`), which is the right shape. The CRM action
scoring is a **separate scoring plane** on a different scale; whether the two
planes are meant to agree is an open question (§F.5).

### E.6 Dealer discovery — Gemini Maps vs Groq Compound

`discoverDealersViaGeminiMaps` (Gemini 2.5 Flash, Maps grounding) and
`discoverDealers`/`enrichMarketData` (Groq `compound`/`compound-mini`) both
discover dealers for a market. **Verdict: composed, not duplicated** —
`compound-search.service.ts:374` calls the Gemini service, so they form one
pipeline with two providers.

---

## SECTION F — GAPS AND OPEN QUESTIONS

| # | Open question | What would resolve it |
| --- | --- | --- |
| **F.1** | Does the public Zura launcher actually render on production, and what are its real position, z-order, contrast, and mobile behaviour? | Network egress to `autolenis.com` from an audit environment (currently `403` at the proxy for all hosts), **or** an isolated preview deployment with its own database. Then anonymous Playwright observation as scoped in the brief. |
| **F.2** | Are the Twilio phone numbers actually pointed at `/api/twilio/voice/incoming`? | Twilio console webhook configuration. Determines whether Voice Zura (§A.7) is ACTIVE in fact or only in code. |
| **F.3** | What are the production values of `AI_KILL_SWITCH`, `ACTION_INTENT_EXECUTION_ENABLED`, `ACTION_INTENT_ACTIVE_KEYS`, `TWILIO_VERIFY_ALT_HOST`, and the transfer flag? | Vercel environment variables. §A.8's UNWIRED status holds regardless (no proposal producer), but PARTIAL-vs-ACTIVE for several capabilities depends on these. |
| ~~F.4~~ | ~~Does `/api/twilio/sms/inbound` run a deterministic STOP-keyword check alongside `detectOptOutIntent`?~~ | **RESOLVED IN THIS PASS — yes.** The keyword set `{STOP, STOPALL, UNSUBSCRIBE, CANCEL, QUIT, END}` (`route.ts:25`) is evaluated first at `:90`; the model runs only as a widening fallback at `:91-93`. Retained here as a record of the question and its answer. |
| **F.5** | Are `Buyer.leadScore` (0–100, `scoring.service.ts`) and the CRM action-score plane (`lib/crm/scoring-actions.ts`) meant to be the same number? | Product owner. They are written by different systems on different scales. |
| **F.6** | Was `/api/finder` intentionally retired, and may it be removed? | Product owner + deployment history. It is dormant as a product surface but live as an HTTP surface (§D.3). |
| **F.7** | Do `backend/`, `automation/make/`, or the root `tests/` tree contain AI capabilities not represented here? | Full enumeration. Tier 1/2 identifier sweeps across the whole repository surfaced **no** AI/LLM call sites outside `frontend/`; `automation/make/` and `frontend/migrations/data/make_cadences.json` reference Zura only as an event **source label** (`zura_conversation_captured`), not as an agent. Recorded as an **ASSUMPTION** that `frontend/` holds all AI code, based on a negative identifier sweep rather than a file-by-file read of every non-`frontend/` file. |
| **F.8** | Which surface is `AiChatSession`/`AiChatMessage` intended to serve? | Product owner. Four persistence models exist and none is written (§A.26); Phase 2 cannot know whether conversation persistence is a lapsed requirement or a deferred one. |
| **F.9** | Is the `Alex` greeting (`ChatWidget.tsx:41`) a legacy artifact or a second intended persona? | Product owner. |
| **F.10** | Is `/api/public/ai/chat` a deprecated endpoint or an unfinished migration target? | Product owner + git history. It is the *better-guarded* public endpoint (§E.1). |
| **F.11** | Are the dealer-outreach AI paths (§A.23) currently enabled to send? | Deployed env + `autolenis-dealer-outreach-governance` review. The skill requires outreach off by default. |
| **F.12** | Do any Vercel cron schedules actually invoke `social-generate`, `social-optimize`, `social-market-index`, `content-generation-drain`, or `morning-briefing`? | `vercel.json` / Vercel dashboard. Affects ACTIVE-vs-PARTIAL for §A.13–A.19. |
| **F.13** | Why is the Playwright MCP server configured for a Chrome channel absent from this container? | Environment owner. The MCP server seeks `/opt/google/chrome/chrome`; the working binary is `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Independent of F.1 — fixing it alone would not have enabled browser verification, because egress is blocked. |
| **F.14** | Do RLS policies constrain any of the AI read paths? | Supabase policy inspection. All AI reads observed here use the Prisma service connection; RLS was not evaluated in this pass. |

---

## SECTION G — REVIEW LOG (IMPECCABLE + CITATION VERIFICATION)

### G.1 What Impeccable actually did — stated plainly

`impeccable` **is installed** (`.claude/skills/impeccable/`) and **was invoked**
against this file. Its setup script ran:

```
$ node .claude/skills/impeccable/scripts/context.mjs
NO_PRODUCT_MD: This project has no PRODUCT.md yet. … for any other (scoped)
command against existing code, proceed using the code as context …
RESOLVED_CONTEXT: { "targetPath": null, "projectRoot": "/home/user/autolenisNewUpdatedfinal", … }
```

**Impeccable produced zero findings against this document, because auditing a
markdown document is outside its scope.** Impeccable is a frontend design skill:
its command set (`craft`, `audit`, `critique`, `polish`, `colorize`, `typeset`,
…) reviews UI code for accessibility, contrast, responsive behaviour, motion,
and design-system adherence. It has no markdown or prose-audit command, and it
found no `PRODUCT.md` to review against.

**I am therefore not claiming Impeccable flagged anything.** To do so would be
exactly the kind of unsupported claim this section exists to catch. What follows
separates two real things: a mechanical citation check I executed, and the
downgrades I made during my own verification pass.

### G.2 Mechanical citation verification (executed — this is real evidence)

Every backticked `path:line` claim in this document was extracted and checked
against the working tree at the baseline SHA: does the file exist, and does the
cited line (or the top of a cited range) fall within it?

```
citations checked             : 279
file resolves & line in range : 279
FAILURES                      : 0
```

Shorthand basenames used after a full path had been given (`engine.ts:85`,
`catalog.ts:40-296`, …) were resolved to their full paths; 18 bare `route.ts:NN`
references, which denote the route under discussion in that row, were checked
against the set of all `frontend/app/api/**/route.ts` files. **No citation in
this registry points at a nonexistent file or an out-of-range line.**

This does not prove each citation supports the specific claim attached to it —
only that every one is a real, in-range location. That distinction is stated
rather than glossed.

### G.3 Claims downgraded or corrected during verification

These are **my own** verification-pass corrections, not Impeccable findings.
Per the brief, unsupported claims were downgraded to `ASSUMPTION` /
`NOT VERIFIED` or corrected — none was deleted.

| # | Claim as first drafted | Resolution |
| --- | --- | --- |
| 1 | §B implied live Playwright observation of the public surface | **Downgraded.** Egress is blocked (§0). All §B rows restated `CODE-VERIFIED` or `NOT VERIFIED`; the zero-`BROWSER-VERIFIED` fact is stated up front rather than buried. |
| 2 | "All AI code lives in `frontend/`" | **Downgraded to ASSUMPTION** (§F.7), with its basis — a negative identifier sweep, not a file-by-file read — stated explicitly. |
| 3 | "Voice Zura is ACTIVE" | **Split.** Code path `CODE-VERIFIED`; live Twilio webhook wiring `NOT VERIFIED` (§F.2). |
| 4 | "AMIPS generator is ACTIVE" | **Downgraded to PARTIAL** — reachable from the pipelines, cron enablement `NOT VERIFIED` (§A.13, §F.12). |
| 5 | "`/api/finder` is dead code" | **Corrected, not softened.** Dormant as a product surface, live as an HTTP surface. §A.21 and §D.3 now state both, because only the second half carries the risk. |
| 6 | "The kill switch is broken" | **Restated as PARTIAL with a 19-module enumeration** (§C.14). "Broken" was imprecise — it works exactly where it is wired, which is the actual problem. |
| 7 | "No conversation persistence anywhere" | **Corrected.** `BuyerOpportunity` and `Conversation` do persist. The claim now reads "no persistence on any *authenticated* surface" (§A.26). |
| 8 | **"STOP detection is AI-only", carried as a MEDIUM finding** | **Withdrawn — disproved, not softened.** Reading `app/api/twilio/sms/inbound/route.ts` showed the deterministic keyword set (`:25`) is evaluated first at `:90`, with the model as a widening-only fallback (`:91-93`) whose failure path returns `false`. The finding was removed from §D.6, the open question closed (§F.4), and the MEDIUM count reduced from 3 to 2. **This is the correction that most changed the result, and it went in the reassuring direction — recorded because a finding withdrawn is as important as one raised.** |
| 9 | "The shared `ChatWidget` is a privilege-escalation risk" | **Downgraded.** No escalation is constructible today; §D.9 records the *shape* of the risk and names the dormant `agentType` prop as the latent selector. |
| 10 | Mobile responsive behaviour stated as fact | **Downgraded.** §B.2 now shows the arithmetic from source (`fixed`, 520 px, 24 px offset) and marks rendered behaviour `NOT VERIFIED`. |
| 11 | "`ai.use` is a narrow permission" | **Corrected** — it resolves to all five admin roles (`approval-permissions.ts:37`). §A.9 and §D.4 say so. |

**11 claims downgraded, corrected, or withdrawn. 1 finding withdrawn entirely
(#8), reducing the severity count from 3 HIGH / 3 MEDIUM to 3 HIGH / 2 MEDIUM.**

### G.4 Known limits of this review

- Impeccable contributed no document-level findings (G.1). A prose/consistency
  reviewer was not available in this environment; §G.3 is self-review.
- Citation verification proves location validity, not claim support (G.2).
- Fourteen items remain `NOT VERIFIED` and are enumerated in §F rather than
  resolved by inference.

## PHASE 1 CLOSING STATEMENT

**No implementation has started.** No application code was written, modified, or
deleted. No agent was created, consolidated, or removed. No authorization policy
was changed. No migration was written. No production record was read or mutated.
No merge, deploy, or PR. The only file added by this phase is this document,
under `docs/zura/`.

Phase 2 — design and routing architecture — is a separate run against this file.
