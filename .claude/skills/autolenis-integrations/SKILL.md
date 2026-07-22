---
name: autolenis-integrations
description: >-
  The integration constitution for AutoLenis — every third-party vendor is
  reached through a typed adapter in frontend/lib/services/<domain>/ (or
  lib/<vendor>/) with timeouts, retry+backoff, idempotency, signature
  verification, error mapping, sandbox mode, degraded fallback, observability,
  and secret isolation. Use this skill when integrating or changing any external
  provider: Stripe, Supabase, Twilio, ElevenLabs/Polly, Resend, DocuSign,
  MicroBilt/iPredict, Groq/Anthropic/Gemini/OpenAI, MarketCheck, Buffer,
  Higgsfield, GoHighLevel, Make.com, Inngest, Upstash QStash/Redis, or Sentry —
  or when an SDK call is about to be written inside a page/component. Keywords:
  webhook, adapter, SDK, retry, backoff, idempotency, signature, sandbox,
  timeout, circuit breaker, degraded mode. Overrides ad-hoc SDK usage.
---

## Purpose & Authority

This skill owns how AutoLenis talks to the outside world. Every third-party call
goes through a **typed adapter** in the service layer — never a raw SDK call
scattered across a page, component, or route handler. The adapter is the single
place that holds the vendor secret, sets timeouts, retries with backoff,
verifies signatures, maps vendor errors to AutoLenis errors, supports a sandbox,
degrades gracefully, and emits observability. Where generic advice ("just import
the SDK and call it", "await it inline in the route", "wrap in try/catch and log")
conflicts with anything here, this skill wins.

## When this skill activates

- Adding or changing any call to an external vendor.
- Editing anything under `frontend/lib/services/<domain>/` that wraps a vendor,
  or `lib/stripe.ts`, `lib/inngest/`, `lib/qstash/`, `lib/voice/`, `lib/ai/`,
  `lib/amips/`, `lib/crm/`, `lib/observability/`.
- Handling an inbound webhook (`app/api/webhooks/*`, Twilio, QStash, CRM
  dispatch).
- Keywords: webhook, signature, retry, backoff, idempotency, sandbox, timeout,
  circuit breaker, degraded mode, provider fallback, `after()`.

## Architecture & key files

Real vendor adapters (ground truth):

- **Stripe** — `lib/stripe.ts` (`getStripe`, lazy, hard-fails if
  `STRIPE_SECRET_KEY` unset, pinned `apiVersion`), `lib/services/payment/`,
  `lib/payments/`. Webhook: `app/api/webhooks/stripe/route.ts`.
- **Supabase** — `lib/supabase.ts`, `lib/supabase-service.ts`, `lib/prisma.ts`.
- **Twilio (SMS/voice)** — `lib/services/sms/twilio.service.ts`,
  `lib/services/acquisition/twilio.service.ts`, verification in
  `lib/voice/twilio-verify.ts`. Toll-free +18662803328, local +14695359785.
  Voice TTS: ElevenLabs primary → Polly fallback (`lib/voice/`, `lib/ai/zura-voice.ts`).
- **Resend (email)** — `lib/services/email/resend.service.ts`, `EmailSendLog`.
  Dealer outreach uses `DEALER_OUTREACH_FROM_EMAIL`.
- **DocuSign (e-sign)** — `lib/services/esign/docusign-auth.service.ts` (JWT
  grant, RSA-SHA256, `isDocuSignConfigured`), `esign.service.ts`,
  `envelope-template.service.ts`. `ESignEnvelope` model, `DOCUSIGN_*` env,
  `DOCUSIGN_WEBHOOK_SECRET`.
- **MicroBilt / iPredict (prequal)** — `lib/services/prequal/microbilt.service.ts`
  (soft pull only, `MICROBILT_SANDBOX`, 10s AbortController timeout, error →
  MANUAL_REVIEW, `rawResponse` AES-256-GCM encrypted).
- **LLM** — `lib/ai/groq-client.ts` (Groq primary `openai/gpt-oss-120b`,
  fallback `openai/gpt-oss-20b`), `lib/ai/kill-switch.ts` (`AI_KILL_SWITCH`,
  `assertAiEnabled`). Anthropic Claude Haiku 4.5 (buyer first-contact), Gemini
  2.5 Flash (dealer discovery/grounding, `lib/services/acquisition/gemini-maps.service.ts`).
- **MarketCheck (inventory)** — `MARKETCHECK_API_KEY`, `lib/services/inventory/adapters/`,
  `lib/amips/`, `scripts/amips-*`.
- **Buffer / Higgsfield (social/content)** — `BUFFER_*`, `lib/services/content/`.
- **GoHighLevel (CRM)** — `lib/services/ghl/` (`tag-sync`, `GHL_*`).
- **Make.com** — inbound `app/api/crm/dispatch/*`, HMAC via
  `lib/crm/dispatch-auth.ts` (`CRM_DISPATCH_SECRET`, `X-AutoLenis-Signature`).
- **Background transport** — Inngest (`lib/inngest/`), Upstash QStash
  (`lib/qstash/` — `dispatch`, `verify`, `receiver`), Upstash Redis/ratelimit.
- **Observability** — Sentry (`@sentry/nextjs`, `instrumentation*.ts`),
  `lib/logger.ts`, `lib/observability/` (`alert` → `pageOnCall`/`notifyOncall`).

## Core rules & invariants

1. **One typed adapter per vendor; SDKs never leak into pages/components.** All
   vendor access lives in the service layer behind a typed function. A page,
   component, or route handler calls the adapter, never the raw SDK.
2. **Lazy client construction, fail loud on missing secrets.** Instantiate the
   SDK on first use inside a getter (like `getStripe`/`getGroqClient`), never at
   module top (Turbopack/`next build` evaluates module scope before runtime env
   exists). A missing critical secret throws — never a placeholder that silently
   sends bad requests.
3. **Every outbound call has a hard timeout.** Use an `AbortController` (e.g.
   MicroBilt's 10s) or the SDK's timeout option. No unbounded awaits.
4. **Retry with exponential backoff on transient/rate-limited failures.**
   8s / 16s / 32s per the platform standard; cap attempts; jitter where
   possible. Non-idempotent operations only retry behind an idempotency key.
5. **Idempotency on anything with side effects.** Payments key on the Stripe
   PaymentIntent/`eventId`; webhooks claim via the unique `eventId`/`key_hash`
   row (`idempotency_keys`); jobs converge on `sha256(identity)`
   (`lib/inngest/idempotency.ts`). A retried or duplicated delivery must never
   double-charge, double-send, or double-create.
6. **Verify every inbound signature before acting.** Stripe
   `constructEvent(STRIPE_WEBHOOK_SECRET)` (fail loud 500 if unset), Twilio
   `validateRequest` (`lib/voice/twilio-verify.ts`), QStash `receiver.verify`
   (`lib/qstash/verify.ts`), DocuSign HMAC (`DOCUSIGN_WEBHOOK_SECRET`), Make/CRM
   HMAC + timestamp skew (`CRM_DISPATCH_SECRET`). Unverified → 401/400, no side
   effects.
7. **Map vendor errors to AutoLenis errors at the boundary.** The adapter
   translates provider failures into typed results or a domain error; callers
   never see raw SDK exceptions or vendor error shapes. Timeouts/soft failures
   downgrade to a safe state (MicroBilt → `MANUAL_REVIEW`), never a raw throw to
   the user.
8. **Sandbox / test doubles are first-class.** Adapters honor a sandbox flag
   (`MICROBILT_SANDBOX`, `DOCUSIGN_ENV`) that returns deterministic mocks with
   no network/OAuth. Tests inject a double at the adapter seam — never hit the
   live vendor.
9. **Provider fallback chains where defined.** Groq→Anthropic, ElevenLabs→Polly,
   Gemini→Groq. Per-stage try/catch isolation; a fallback fires on failure of
   the primary, and the adapter logs **which provider/model actually served**.
10. **Degraded mode over hard failure for non-critical paths.** If a vendor is
    down, degrade (queue, skip, fallback, mark pending) rather than break the
    user flow — except revenue/safety-critical paths (payment throttle fails
    CLOSED). `AI_KILL_SWITCH` short-circuits all LLM calls via `assertAiEnabled`.
11. **Secret isolation.** Each vendor's secret is read only inside its adapter,
    from `process.env`, `server-only` where applicable. Never send a secret to
    the client, log it, or reuse one vendor's key for another.
12. **Third-party work runs off the request path.** Non-blocking side effects
    (emails, CRM sync, social posts, enrichment) go through `after()`, Inngest,
    or QStash — not inline in the request. Every background job needs a manual
    backfill/retry endpoint.

## Workflows

**Add a new vendor integration.** Create/extend
`lib/services/<domain>/<vendor>.service.ts` with: a lazy client getter
(fail-loud on missing secret), a typed function per operation, an
`AbortController` timeout, retry+backoff for transients, error mapping to a
domain result, a sandbox branch, and observability (log provider/model,
`notifyOncall`/`pageOnCall` on outage). Add env vars; wire the caller to the
adapter, not the SDK. If it has side effects, run it via `after()`/Inngest/QStash
and add a manual backfill route. Add a test that injects a double.

**Add an inbound webhook.** Read the raw body first (single consumption; clone
if you must re-read — see `lib/qstash/verify.ts`) → verify the signature/HMAC →
claim idempotency on the unique event id (upsert the `WebhookEvent`/
`PaymentProviderEvent` row) → run side effects inside a `$transaction` with the
claim so a redelivery acks as duplicate → return 2xx only after commit; return
5xx on config errors so the provider retries. Exempt the route from CSRF in
`proxy.ts` (webhooks self-authenticate).

**Call an LLM.** `assertAiEnabled()` → build the prompt (never include PII) →
call the primary via its adapter with timeout → on rate limit/failure fall back
per the chain → **validate/coerce the structured output at the boundary** before
any use → log which provider/model fired. Cache expensive results on stable keys
(zip, make, model, radius).

**Charge / refund via Stripe.** Only in `lib/services/payment/` behind
`getStripe`; amounts are integer cents; create with an idempotency key; never
trust a client-reported payment status — the verified webhook is the source of
truth; the webhook is signature-verified + idempotent.

## Boundaries — do / never

**Do**
- Route every vendor call through its typed adapter.
- Lazily construct clients; fail loud on missing secrets.
- Set timeouts; retry transients with 8/16/32s backoff; key idempotency.
- Verify inbound signatures before side effects.
- Provide sandbox modes and inject test doubles at the adapter seam.
- Log the provider/model that served; alert on outage; degrade gracefully.

**Never**
- Import or call a vendor SDK directly from a page, component, or route handler.
- Construct an SDK client at module top level, or fall back to a placeholder key.
- Fire an unbounded request with no timeout, or retry a non-idempotent op without
  an idempotency key.
- Act on a webhook before verifying its signature and idempotency.
- Leak a secret to the client/logs or reuse one vendor's key for another.
- Send PII to an LLM or to MicroBilt fields marked AutoLenis-internal.
- Block the request path on non-critical third-party work.
- Build a parallel client for a vendor that already has an adapter — extend it.

## Best practices & examples

- Timeout pattern: `const ac = new AbortController(); const t =
  setTimeout(() => ac.abort(), 10_000); ... fetch(url, { signal: ac.signal });`
  then `clearTimeout(t)` — MicroBilt returns `MANUAL_REVIEW` on abort, never
  throws to the buyer.
- Idempotency convergence (`lib/inngest/idempotency.ts`): a `23505`
  unique-violation on the `idempotency_keys` insert means another worker owns the
  key → return, don't duplicate.
- Config probe before use: DocuSign (`isDocuSignConfigured`) and MicroBilt
  (`getMicroBiltConfigStatus`) expose non-secret readiness for the admin
  system-health page — surface config state without leaking secrets.
- QStash verify reads `request.clone().text()` so the handler can still call
  `request.json()` — a body is consumable once.

## Acceptance criteria

- [ ] Vendor reached only through a typed adapter in the service layer; no SDK in
      a page/component/route.
- [ ] Client constructed lazily; missing secret fails loud, no placeholder.
- [ ] Hard timeout set; transient retries use 8/16/32s backoff.
- [ ] Side effects are idempotent (keyed); duplicate deliveries are safe.
- [ ] Inbound signatures verified before any side effect.
- [ ] Vendor errors mapped to domain results; soft failures degrade safely.
- [ ] Sandbox mode exists; tests use doubles, not the live vendor.
- [ ] Fallback chain honored; the serving provider/model is logged.
- [ ] Secrets isolated to the adapter; no PII in prompts or vendor payloads.
- [ ] Non-critical third-party work runs via `after()`/Inngest/QStash with a
      manual backfill/retry endpoint.

## Cross-skill links

- `autolenis-payments-and-ledger` — Stripe adapter, webhook idempotency,
  money-cents.
- `autolenis-ai-safety-and-orchestration` — LLM provider selection, kill switch,
  structured-output validation, prompt-injection defense.
- `autolenis-communications-consent` — Twilio/Resend send paths, suppression,
  consent.
- `autolenis-auth-security-privacy` — signature verification, secret isolation,
  CSRF exemptions for webhooks.
- `autolenis-observability-sre` — Sentry, logger, on-call paging, DLQ/backfill.
- `autolenis-supabase-postgres` — idempotency/webhook tables and transactions.
- `autolenis-system-architecture` — background-job model and the
  no-parallel-systems rule.
