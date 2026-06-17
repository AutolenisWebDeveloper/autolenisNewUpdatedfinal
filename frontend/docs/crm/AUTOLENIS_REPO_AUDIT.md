# AUTOLENIS_REPO_AUDIT.md
**Scope:** STEP 2 of the Continuation & Finalization Brief — resolve the 4 keystones against real code, with `file:line` evidence.
**Repo:** `autolenisNewUpdatedfinal-main` · app root confirmed at `frontend/`.
**Method:** Direct file reads only. Every claim cites `file:line`. Where a fact is not in the repo (e.g. "applied to prod", Make-side state, Supabase-hosted functions), it is marked **NOT VERIFIABLE FROM REPO** — never inferred.
**Date:** 2026-06-16 · **Status:** Authoritative for app-side facts.

---

## 0. Executive correction (read first)

The repo is materially **more complete** than the inline 5-artifact package implies. The package's "❓ confirm" and "⚠ never emitted / phantom" markers are, in most cases, **refuted by code**. The genuine app-side gaps are narrow and specific (below). This is the precise "hallucinated incompleteness" the brief warned against — the audit's job is to separate what is genuinely missing from what merely looked missing.

**Verified true app-side gaps (only these):**
1. `POST /api/crm/reconcile/run` — **does not exist** (Step 4A).
2. `contacts.nurture_status` — **does not exist** anywhere (Step 4B).
3. `POST /api/crm/inactivity/run` — **does not exist** (Step 4C HTTP analog). *Note: the `buyer_inactive` emitter itself already exists and is cron-scheduled.*
4. `deposit_pending` — declared in the event union but **never emitted** (the only such event).
5. A `last_contacted_at` column on `contacts` — **does not exist**; reconcile must add it or derive recency from `contact_timeline_events`.
6. Coverage / NLLB dashboard surface — **not found** (Step 4F).

**Everything else the package flagged as missing is present and wired.** Details follow.

---

## KEYSTONE 1 — DISPATCH CONTRACT

### Files
- `app/api/crm/dispatch/email/route.ts`
- `app/api/crm/dispatch/sms/route.ts`
- Shared auth: `lib/crm/dispatch-auth.ts`, `lib/crm/dispatch-auth-decision.ts`, `lib/crm/dispatch-idempotency.ts`

### Auth — **dual-path, NOT a single static key**
Auth is delegated to `authorizeDispatch(request, endpoint)` (`email/route.ts:19`, `sms/route.ts:50`), which calls `decideDispatchAuth(...)` (`dispatch-auth.ts:72`). Two independent credentials (`dispatch-auth-decision.ts:32–64`):

| Path | Header | Secret | Compare |
|---|---|---|---|
| **HMAC (primary, code callers)** | `X-AutoLenis-Signature` | `CRM_DISPATCH_SECRET` | `HMAC-SHA256(secret, rawBody)` hex, constant-time (`dispatch-auth-decision.ts:43–49`) |
| **Static key (Make no-code)** | `X-Dispatch-Key` | `CRM_DISPATCH_KEY` | constant-time string compare (`dispatch-auth-decision.ts:54–59`) |

Precedence: signature header wins if present, else dispatch-key, else `missing_auth` (`dispatch-auth-decision.ts:43,54,63`). Constant-time compare hashes both sides to 32 bytes first so `timingSafeEqual` never throws on length mismatch (`dispatch-auth-decision.ts:26–30`).

### Mandatory headers BEYOND auth (this is what the doc-contract omits)
After the auth decision, **both paths** must also satisfy (`dispatch-auth.ts`):
- **`X-AutoLenis-Timestamp`** — epoch-ms; rejected if missing/NaN or skew > 5 min (`dispatch-auth.ts:28,89–93`). **The doc-derived contract omits this header — a static-key call without it returns `401 timestamp_skew`.**
- **`X-Idempotency-Key`** (preferred) or `body.idempotencyKey` fallback; 400 if neither (`dispatch-auth.ts:106–116`).

Also enforced on both paths: light rate limit 240/endpoint/min via Prisma `RateLimitEvent` (`dispatch-auth.ts:28–33,122–142`); DB idempotency via Supabase `idempotency_keys` (sha256 PK; 23505 ⇒ duplicate) with `replay|reclaim|reject` semantics (`dispatch-auth.ts:147–211`, `dispatch-idempotency.ts:13–24`).

### Email body schema (`email/route.ts:25–35,74–93`)
`{ contactId? | email?, type?: 'transactional'|'marketing' (default 'transactional'), templateKey?, vars?: Record<string,string|number|null>, subject?, html?, idempotencyKey?, scenarioId? }`
- Recipient: `contactId` **or** `email` (resolved by `resolveDispatchContact`, `email/route.ts:42`).
- Content: either `templateKey`(+`vars`) **or** raw `subject`+`html` (`email/route.ts:77–93`).
- **Effective-type gate (Fix C):** `computeEffectiveEmailType(declaredType, templateKey)` — `transactional` only if declared AND the `templateKey` is allowlisted; marketing/raw-html/unlisted ⇒ marketing ⇒ consent required (`email/route.ts:32–35,50–57`). The label alone cannot bypass consent.
- Consent gate: marketing requires `contact.consent_email`; `do_not_contact` always blocks (`email/route.ts:50–60`).
- Suppression: `SuppressionService.isEmailSuppressed` (`email/route.ts:63`).

### SMS body schema (`sms/route.ts:47–60`)
`{ contactId? | phone?, body: string, fromPool?: 'tollfree'|'local' (default tollfree), idempotencyKey?, scenarioId?, state?, zip? }`
- **No `templateKey` for SMS** — Make sends the literal message text in `body`; the route does not render templates for SMS (`sms/route.ts:58,82–90`).
- Quiet-hours derived from `state`/`zip` (body, else linked Buyer address) (`sms/route.ts:12–39,80`).
- Send via `sendCrmSms` which gates on `consent_sms` + `do_not_contact` + **both** suppression planes (see §4 / Compliance).

### Responses
- Auth fail: `401 {status:'unauthorized', error}` (`dispatch-auth.ts:35–37`); `timestamp_skew`, `missing_idempotency_key`, `invalid_json` 400/401 variants; in-flight duplicate `409 {status:'processing', retryable:true}` (`dispatch-auth.ts:193–199`).
- Email success: `200 {status:'sent'|'duplicate'|'dev_skipped', providerId, channel:'email'}`; deterministic gates (`no_consent`, `suppressed`, `contact_not_found`) return 200/404 with a status Make branches on; real send failure `502 {status:'failed'}` (`email/route.ts:105–150`).
- SMS success: `200 {status, sid, channel:'sms'}`; gates 200/404; send failure 502 (`sms/route.ts:118–123`).

### Prod host — **NOT VERIFIABLE FROM REPO**
The host `https://www.autolenis.com` is not asserted by the route code; it comes from deploy config. Routes are relative (`/api/crm/dispatch/{email|sms}`). Treat the host as deploy-config, confirm in Vercel.

### VERDICT on the agent-derived contract
```
POST https://www.autolenis.com/api/crm/dispatch/email
header  X-Dispatch-Key: <CRM_DISPATCH_KEY>
body    {contactId, email, templateKey, campaign, step, idempotencyKey}
```
- **Auth header `X-Dispatch-Key` (static):** ✅ valid path — but **incomplete**: also requires `X-AutoLenis-Timestamp` (mandatory) and `X-Idempotency-Key`/`body.idempotencyKey`.
- **`templateKey`:** ✅ real and consumed.
- **`campaign`, `step`:** ❌ **NOT consumed by the route.** They are harmless extra fields (ignored). The route's real discriminators are `type`, `vars`, `scenarioId`. The cadence `campaign`/`step` live in Make's data store and only surface as `idempotencyKey` (`campaign:contact_id:step`) and optional `scenarioId`.
- **`email` + `contactId` both:** ✅ either resolves the recipient.

**Corrected minimal Make static-key contract:**
```
POST /api/crm/dispatch/email
Headers:
  X-Dispatch-Key:        <CRM_DISPATCH_KEY>
  X-AutoLenis-Timestamp: <epoch_ms>            # REQUIRED (≤5 min skew)
  X-Idempotency-Key:     <campaign:contact_id:step>
  Content-Type:          application/json
Body: { "contactId": "...", "type": "marketing",
        "templateKey": "welcome_d0", "vars": {...}, "scenarioId": "5410176" }
```

---

## KEYSTONE 2 — OUTBOUND SIGNING (`lib/events/make-webhook.ts`)

> Note: the file is at **`lib/events/make-webhook.ts`**, not `lib/crm/make-webhook.ts` as the brief assumed.

### Envelope shape (`make-webhook.ts:19–37`, built in `lib/events/emit.ts:127–143`)
```jsonc
{
  "event": "<DomainEventType>",
  "version": 1,
  "idempotencyKey": "<event>:<domainEntityId>",   // emit.ts:78
  "occurredAt": "<ISO-8601>",
  "contact": {
    "id", "email", "phone", "firstName", "lastName",
    "consentEmail", "consentSms", "lifecycleStage"   // camelCase, NESTED
  },
  "data": { ... }
}
```
- **Refutes the doc's "target payload"** `{ event, contact_id, email, phone, occurred_at, attribution{}, data{} }`: real payload nests a `contact` object with **camelCase** fields, has **no** top-level `contact_id`/`email`/`phone`, and carries **no `attribution` block**.

### Signing (`make-webhook.ts:59–78`)
- Body signed = `JSON.stringify(envelope)` (raw bytes).
- `signature = HMAC-SHA256(MAKE_WEBHOOK_SECRET, body).digest('hex')` (`make-webhook.ts:61`).
- Headers sent: `X-AutoLenis-Signature` (the HMAC), `X-AutoLenis-Event`, `X-AutoLenis-Timestamp` (`Date.now()` ms), `X-Idempotency-Key` (`make-webhook.ts:71–74`).
- Refuses to send unsigned if `MAKE_WEBHOOK_SECRET` unset (`make-webhook.ts:53–57`); best-effort, 5 s timeout, non-blocking (`make-webhook.ts:39,64–91`).

### What the Make Router's inbound verification MUST do
Compute `HMAC-SHA256(MAKE_WEBHOOK_SECRET, rawBody).hex()` and constant-time compare to the inbound `X-AutoLenis-Signature`. Optionally reject `X-AutoLenis-Timestamp` skew > 5 min for symmetry. **This is identical in scheme to the inbound dispatch HMAC path — same algorithm, same hex encoding, different secret (`MAKE_WEBHOOK_SECRET` vs `CRM_DISPATCH_SECRET`).**

---

## KEYSTONE 3 — OWNERSHIP SPLIT (`CRM_INAPP_ENGINE_ENABLED`)

### The flag is GLOBAL, not per-campaign
Only one functional read (`lib/events/emit.ts:222`). `emitDomainEvent` (the single emit seam) **always** forwards to Make when `MAKE_WEBHOOK_URL` is set (`emit.ts:203–217`), and **additionally** drives the legacy in-app engine `WorkflowEngine.triggerForEvent(...)` **only** while `CRM_INAPP_ENGINE_ENABLED === 'true'` (`emit.ts:222–235`).

Other references are comments/docs only: `app/admin/crm/automations/page.tsx:10`, `app/api/public/request-vehicle/route.ts:587`, `lib/inngest/functions.ts:643`.

### Double-send model
- Flag **OFF (default):** Make owns every send; in-app engine fires for nothing. **No double-send.**
- Flag **ON:** for **every** event, *both* Make (if the Processor/cadence is live) *and* the in-app `WorkflowEngine` act ⇒ **global double-send across all campaigns**, not selective.

**Correction to the package framing:** there is no per-campaign "in-app sends X vs defers Y" split. It is all-or-nothing. The single mitigation is **keep `CRM_INAPP_ENGINE_ENABLED` OFF in prod** once the Make Processor owns sends (it is the default-OFF cutover flag, `emit.ts:39–40`).

### Idempotency key note
Outbound emit key = `event:domainEntityId` (`emit.ts:78`). The dispatch-time idempotency key (`campaign:contact_id:step`) is constructed by Make for the dispatch call. Different hops, different keys — by design.

---

## KEYSTONE 4 — EVENT COVERAGE

### Canonical declared union (`lib/types/crm.ts:339`)
`DomainEventType = Exclude<WorkflowTriggerType,'manual'>` (`emit.ts:46`). 22 non-`manual` declared events.

### Emit census (grep of `emitDomainEvent('<name>'`)
| Event (declared) | Emitted? | Site (`file:line`) |
|---|---|---|
| `buyer_signup` | ✅ | `app/auth/callback/route.ts:143` |
| `vehicle_request_submitted` | ✅ | `app/api/public/request-vehicle/route.ts:590` |
| `deposit_pending` | ❌ **never** | — (declared `lib/types/crm.ts`; no emit anywhere) |
| `deposit_paid` | ✅ | `app/api/webhooks/stripe/route.ts:183` |
| `auction_started` | ✅ | `lib/services/auction/auction.service.ts:44` |
| `offer_received` | ✅ | `lib/services/offer/offer.service.ts:238` |
| `offer_selected` | ✅ | `app/api/buyer/auctions/[auctionId]/select-offer/route.ts:110` |
| `docusign_signed` | ✅ | `lib/services/esign/esign.service.ts:155` |
| `purchase_completed` | ✅ (×2) | `app/api/admin/deals/[dealId]/pickup/complete/route.ts:148`; `app/api/dealer/pickup/scan/route.ts:112` |
| `refinance_inquiry` | ✅ | `lib/services/refinance/refinance-lead.service.ts:121` |
| `dealer_invited` | ✅ | `app/api/admin/dealers/invite/route.ts:85` |
| `affiliate_signup` | ✅ | `app/api/affiliate/register/route.ts:219` |
| `buyer_inactive` | ✅ (cron) | `lib/inngest/functions.ts:679` (fn `inactivityScannerFn`, cron `0 * * * *`, `:646,:649`) |
| `trade_in_submitted` | ✅ | `lib/services/trade-in/trade-in.service.ts:54` |
| `saved_search_created` | ✅ | `app/api/buyer/searches/route.ts:51` |
| `saved_search_matched` | ✅ (cron) | `lib/inngest/functions.ts:814` (fn `savedSearchMatcherFn`, cron `0 */6 * * *`, `:766,:768`) |
| `calculator_completed` | ✅ | `app/api/tools/dealer-fee-lead/route.ts:169` |
| `exit_intent_captured` | ✅ | `app/api/public/crm/exit-intent/route.ts:65` |
| `partial_lead_captured` | ✅ | `app/api/public/crm/partial-lead/route.ts:110` |
| `lead_magnet_downloaded` | ✅ | `app/api/leads/lead-magnet/route.ts:150` |
| `zura_conversation_captured` | ✅ | `app/api/concierge/route.ts:494` |
| `prequal_started` | ✅ | `lib/services/prequal/prequal.service.ts:318` |

Both cron emitters are **registered and served**: in `inngestFunctions[]` (`lib/inngest/functions.ts:1142–1143`) and served at `app/api/inngest/route.ts:6–9` (`functions:[...inngestFunctions, ...contentFunctions]`).

### Package "defect list" — corrected against code
| Package claim | Reality (evidence) |
|---|---|
| `saved_search_match` = PHANTOM, no emitter | ❌ **Wrong name + wrong status.** Real event `saved_search_matched` **is** emitted by cron (`functions.ts:814`). |
| `buyer_inactive` = declared, never emitted; inactivity blocked | ❌ **Refuted.** Emitted hourly by `inactivityScannerFn` (`functions.ts:646,679`), registered (`:1142`). App-side inactivity is **already live**. |
| `deposit_pending` = declared, never emitted | ✅ **Confirmed** — the only truly unemitted declared event. |
| `dealer_inactive` = declared, build emitter | ❌ **Not in the union at all** (`lib/types/crm.ts`); grep for `dealer_inactive` → **no occurrence** in code. It is a doc fabrication, not a defect. |
| `vehicle_request_submitted` vs `_created` | ✅ **Resolved:** real name is **`vehicle_request_submitted`** (`request-vehicle:590`). `_created` is never emitted. |
| `offer_accepted` / `deal_completed` / `deal_formed` (target names) | Real names differ: `offer_selected`, `purchase_completed`. Bind campaigns to the **real** names. |
| `affiliate_registered` / `dealer_registered` / `dealer_verified` (target) | Real lifecycle events present: `affiliate_signup`, `dealer_invited`. No `dealer_registered`/`dealer_verified`/`affiliate_registered`/`affiliate_approved` events exist — those package campaigns are **bound to non-existent events** until built. |
| `exit_intent_triggered` / `zura_conversation_started` (target) | Real: `exit_intent_captured`, `zura_conversation_captured`. |

### User actions that emit nothing (genuine coverage gaps, if those funnels matter)
- No `financing_requested` event (declared union has none; package already notes "no templates").
- No `dealer_registered` / `dealer_verified` / `affiliate_approved` / `affiliate_link_created` / `affiliate_conversion` events — the dealer-verification and affiliate-activation/producer campaigns in the package are **not yet wired to any emitter**.
- `deposit_pending` — declared, unused. Either emit it (e.g. on Stripe `payment_intent.requires_action` / checkout-created) or remove it from the union to kill the dead trigger.

---

## SUPPORTING FACTS VERIFIED (compliance + Step-4H)

| Fact | Evidence | Status |
|---|---|---|
| SMS opt-out text auto-appended at dispatch | `lib/services/sms/crm-sms.ts:110` → ``${body}\n\nReply STOP to opt out.`` | ✅ (do **not** add to template copy) |
| Footer sentinel | `lib/services/template.service.ts:35` `FOOTER_SIGNATURE='<!-- autolenis:footer:v1 -->'`; `hasFooter()` dedup `:38` | ✅ |
| **CAN-SPAM physical address fallback (the gate)** | `template.service.ts:26–28` → `AUTOLENIS_PHYSICAL_ADDRESS ?? '1234 Main St, Suite 100, San Francisco CA 94105'` | ⚠ **If env unset, marketing email ships a FAKE SF placeholder address → CAN-SPAM violation.** Also read in `dealer-outreach/compose:77` (`?? "AutoLenis, Inc."`), `email-template.service:210`, hard-required in `dealer-email-send.service:63`, presence-checked in `email-health:23`. **Hard gate: set in prod before any marketing send.** |
| SMS dispatch reads BOTH suppression planes + consent | `crm-sms.ts:77` (`consent_sms`/`do_not_contact`), `:81–84` (`SuppressionService` → `sms_suppression`), `:86–87` (`prisma.smsOptOut`) | ✅ Dispatch is defense-in-depth safe regardless of which STOP handler is active. |
| **Two STOP handlers write different planes** | `app/api/twilio/sms/inbound/route.ts:102–104` → `prisma.smsOptOut.upsert` (Plane B: SmsOptOut); `app/api/webhooks/twilio/inbound/route.ts:103–107` → `supabase.contacts.update` (Plane A: contact consent/`sms_suppression`) | ⚠ **Confirmed split.** Whichever Twilio URL is *inactive* leaves its plane stale. Dispatch stays safe (reads both), but reporting/consent state diverges. Consolidate in a separate PR after confirming the active Twilio URL. |
| migrations 06 (`contact_lead_score`) + 07 (`content_platform`) exist in repo | `migrations/06_add_contact_lead_score.sql`, `migrations/07_content_platform_foundation.sql` | ✅ in repo. **Prod-applied = NOT VERIFIABLE FROM REPO** (DB query required). |
| `crm-dispatch-echo-test` Supabase function | Not present in repo (searched). | It is a **Supabase-hosted edge function** (project `aieybibvewmvrubcpthm`), not app code. Removal is a Supabase-session task, not an app-code change. |
| `contacts` table (system of record is Supabase, not Prisma) | `migrations/01_phase1_foundation.sql:22` `CREATE TABLE contacts`; cols incl. `consent_email:35`, `lifecycle_stage:39` (CHECK), `do_not_contact:45` | ✅ — relevant to building 4A/4B as SQL + supabase queries. **No `last_contacted_at`, no `nurture_status` columns.** |

---

## CONSOLIDATED GAP LEDGER (what STEP 4 must actually build)

| Brief item | Real status | Action |
|---|---|---|
| 4A reconcile `/api/crm/reconcile/run` | **MISSING** | Build (real gap). Needs a recency signal — add `last_contacted_at` or derive from `contact_timeline_events`. |
| 4B `nurture_status` mirror | **MISSING** | Add column + maintenance (real gap). |
| 4C inactivity emitter (`buyer_inactive`) | **EXISTS** (Inngest cron, registered) | No build needed for the emitter. Optional: add `/api/crm/inactivity/run` HTTP analog if Make wants to poke it; otherwise the cron already drives it. `dealer_inactive` does **not** exist — net-new only if the dealer-reactivation funnel is actually wanted. |
| 4D event coverage | **~95% EXISTS** | Only real gaps: `deposit_pending` (emit or drop), and the dealer-verification / affiliate-activation events if those campaigns go live. `saved_search_matched` already exists. |
| 4E Router HMAC (spec) | spec only | Verify inbound `HMAC-SHA256(MAKE_WEBHOOK_SECRET, rawBody)` hex == `X-AutoLenis-Signature` (matches Keystone 2). |
| 4F coverage dashboard | **MISSING** | Build NLLB KPI surface (depends on 4B `nurture_status`). |
| 4G migrations 06/07 applied to prod | in-repo ✅; prod ❓ | Confirm via DB query (out of repo scope). |
| 4H STOP-handler consolidation | confirmed split | Separate PR; unify to a single plane after confirming the active Twilio URL. |

---

## NOT VERIFIABLE FROM REPO (do not assert as audited)
- Prod host `www.autolenis.com`; whether migrations 06/07/08–12 are **applied to prod**; all Make-side state (scenario IDs, data-store contents, ON/OFF); the Supabase `crm-dispatch-echo-test` function; whether `AUTOLENIS_PHYSICAL_ADDRESS` is actually set in the prod Vercel env. These require Vercel/Supabase/Make sessions or DB queries.

## DOCUMENT DISCREPANCY (STEP 1)
The brief says "two completed documents" are provided. Only **one** completed document (the 5-artifact package) plus the brief itself are present in the conversation. **`AUTOLENIS_CRM_SYSTEM_OVERVIEW_v2.md` ("Complete System Overview v2.0") was NOT provided** and therefore cannot be saved verbatim — it is not fabricated here. Provide its text to have it saved.
