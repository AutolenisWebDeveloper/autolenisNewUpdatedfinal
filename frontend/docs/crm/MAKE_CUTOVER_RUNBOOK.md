# AutoLenis CRM — Make.com Cutover & Controlled Go-Live Runbook

Status at time of writing: code + prod-DB schema staged for a single controlled
go-live. The CRM event spine, dispatch, suppression, scoring, and templates are
in place; non-Make senders are closed behind a kill-switch; compliance gates are
hardened. **Emission is still dark** until an operator deploys HEAD and flips the
Make/env switches below. Nothing in this cutover sends to real contacts.

Prod Supabase ref: `aieybibvewmvrubcpthm`. App: `frontend/`.

---

## What was done in-repo (agent) — applied & verified

| Tranche | Change | Evidence |
|---|---|---|
| T0 | Pre-flight state captured | prod behind HEAD; migrations 10/13 absent; 0 active workflows |
| T1 | In-app engine gated at both boundaries (`workflow.engine.ts` `enrollContact`/`executeWorkflowFromNode`); lead-magnet + social-lead-nurture crons gated + removed from `vercel.json`; all `workflows` archived | `CRM_INAPP_ENGINE_ENABLED` grep; `workflows` 2 archived / 0 active |
| T2 | CAN-SPAM physical address HARD gate (`template.service.ts` + `dispatch/email`); SMS opt-out unified to `sms_suppression`; START no longer auto-resubscribes; ungated marketing SMS gated (`lib/crm/sms-gate.ts`) | suppressed-number lookup blocks every path; test row inserted/blocked/cleaned |
| T3 | Migrations 06/10/13 applied to prod | `lead_scoring_events` exists; `contacts.nurture_status`/`last_contacted_at` present |
| T4 | 5 emitters wired (`dealer_verified`, `dealer_activated`, `dealer_inactive` (new cron), `affiliate_approved`, `affiliate_commission`); `deposit_pending` kept (see note); 7 templates seeded (Financing ×3, Dealer/Affiliate Reactivation ×2 each) | emitter grep; prod `email_templates` 45→52 |
| T5 | `make_cadences.json` (52 rows / 24 campaigns) + Processor request spec | JSON validated; every `template_key` present in prod |
| T6 | Schema-readiness dry-run found & fixed a blocker: `contact_timeline_events` CHECK rejected `domain_event` — now allowed | dry-run wrote `domain_event` + ledger + score, then cleaned up |

**deposit_pending note:** kept as a valid lifecycle stage + trigger + "Deposit
Reminder" prebuilt. Its only natural emit site is the deposit payment-link route,
which is inside the do-not-touch Stripe-integration perimeter, so the emitter is
deferred (see operator optional step E). It does not block go-live.

---

## T6-A / T6-B / T6-C — Operator activation steps (require Vercel + Make access)

These could not be executed in-repo: this environment has no Vercel project access
and no prod credentials (env values are write-only). Run them in order.

### Step A — Deploy HEAD with Make forwarding still OFF (dry activation)
1. Merge the cutover PR to the production branch.
2. In Vercel (project under team `autolenis`), confirm the deploy builds and
   promotes to production. Verify the deployed commit SHA matches HEAD.
3. **Leave `MAKE_WEBHOOK_URL` and `MAKE_WEBHOOK_SECRET` UNSET.** The spine will
   write `domain_event` timeline rows + accrue `lead_score`, but the Make forward
   no-ops (logged WARN), so nothing dispatches.
4. Confirm `CRM_INAPP_ENGINE_ENABLED` is unset/`false` (kill-switch off).
5. Set `AUTOLENIS_PHYSICAL_ADDRESS` to the REAL registered mailing address (or
   marketing email will be blocked by the CAN-SPAM hard gate — by design).

### Step B — Fire ONE test domain action in prod and verify (proves deploy + mig 10)
Pick a low-risk real action (e.g. submit one test vehicle request, or sign up one
test buyer). Then run, against ref `aieybibvewmvrubcpthm`:
```sql
-- Expect >= 1 (proves the deployed spine writes the timeline row):
SELECT count(*) FROM contact_timeline_events WHERE event_type='domain_event';
-- Expect the test contact to have a non-null score (proves migration 10 + scoring):
SELECT email, lead_score, lead_temperature, nurture_status, last_contacted_at
FROM contacts WHERE lead_score IS NOT NULL ORDER BY updated_at DESC LIMIT 5;
```
- `domain_event` present + score non-null → deploy + migration 10 good.
- `domain_event` present but score still null → migration-10/scoring problem.
- Neither present → the deploy didn't take (still old code).

(Schema-readiness for these exact writes was already proven by the agent's
dry-run; Step B confirms the *deployed code path* fires them.)

### Step C — Turn on Make forwarding and confirm receipt
1. Set `MAKE_WEBHOOK_URL` (Router 5355993 webhook hook 2439911 URL) and
   `MAKE_WEBHOOK_SECRET` in Vercel; redeploy/restart.
2. Fire one more test action.
3. In Make, open Router 5355993 execution history and confirm the inbound
   execution with header `X-AutoLenis-Signature` and the event envelope.

### Step D — Make UI configuration (the Make side of the contract)
In org 7865508 / team 2374031:
1. **Processor 5410176:** repoint from the Supabase ECHO test receiver to
   `https://www.autolenis.com/api/crm/dispatch/email`. Configure the HMAC signer
   per `migrations/data/make_cadences.json → processor_request_spec`
   (header `x-autolenis-signature` = `HMAC_SHA256(CRM_DISPATCH_SECRET, rawBody)`,
   plus required `x-idempotency-key`, body using `scenarioId`). Toggle **ON**.
2. **Reconciliation 5412069:** the endpoint `POST /api/crm/reconcile/run` already
   exists (auth: `x-dispatch-key: <CRM_DISPATCH_KEY>` OR `Authorization: Bearer
   <CRON_SECRET>`). Toggle **ON**.
3. **Cadence store 108892:** load all rows from
   `frontend/migrations/data/make_cadences.json` (`cadences[]`). Use
   `campaign_triggers` to wire Router event → campaign.
4. **Router 5355993:** add inbound HMAC verification —
   verify `X-AutoLenis-Signature == HMAC_SHA256(MAKE_WEBHOOK_SECRET, rawBody)`
   and reject on mismatch.
5. Remove the `crm-dispatch-echo-test` receiver once the Processor points at real
   dispatch.

### Step E (optional) — deposit_pending emitter
If a deposit-pending nurture is wanted, add one `emitDomainEvent('deposit_pending', …)`
call at the deposit payment-link send site. This file is in the Stripe perimeter,
so make it a deliberate, separately-reviewed change.

---

## T7 — Residual OUT-OF-REPO steps required to be fully live

These cannot be verified or changed from the codebase:

1. **Twilio:** verify ownership of (866) 280-3328; complete A2P 10DLC brand +
   campaign approval; bind a Messaging Service (none exists in code today) and/or
   set `TWILIO_TOLLFREE_NUMBER`/`TWILIO_LOCAL_NUMBER` in Vercel. Point Twilio's
   inbound SMS webhook at the canonical handler.
2. **DNS / Resend:** confirm SPF, DKIM, DMARC for the sending domain.
3. **Vercel env values:** set `MAKE_WEBHOOK_URL`, `MAKE_WEBHOOK_SECRET`,
   `CRM_DISPATCH_SECRET`, `CRM_DISPATCH_KEY`, `AUTOLENIS_PHYSICAL_ADDRESS` (real),
   keep `CRM_INAPP_ENGINE_ENABLED` off; rotate `CRM_DISPATCH_KEY` after sharing
   with Make.
4. **Make UI:** Step D toggles (Processor repoint+ON, Reconciliation ON, cadence
   load, Router inbound HMAC, remove echo receiver).

## Final GO / NO-GO

**NO-GO until the human clicks above are done.** The repo + prod DB are staged:
spine, dispatch, suppression, scoring, templates, cadence data, and the
`domain_event` constraint fix are all in place and verified; every non-Make
sender is disabled behind `CRM_INAPP_ENGINE_ENABLED`. Remaining gating is entirely
operator-side: deploy HEAD (A), verify the live spine (B), set Make env + toggle
the Make scenarios (C/D), set a real `AUTOLENIS_PHYSICAL_ADDRESS`, and complete the
Twilio 10DLC / DNS items (T7). After Step C confirms a Router receipt and Step D is
green, the system is GO.
