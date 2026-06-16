# Make.com Orchestration — Router + Processor

AutoLenis owns every send (consent, suppression, idempotency, audit). Make.com
only **decides branching/delays/sequencing** and calls back into
`/api/crm/dispatch/*`. It never talks to Resend/Twilio directly. This document
describes the two scenarios that implement that contract and the steps to
activate them.

## Topology

```
domain event ──HTTP(signed)──▶ [Router scenario] ──▶ Data Store "Nurture Enrollment"
 (emitDomainEvent →                                        │
  forwardToMake)                                           ▼
                                   [Processor scenario] ──HTTP(X-Dispatch-Key)──▶ /api/crm/dispatch/email
                                    every 15 min, scans due rows                  (AutoLenis owns the send)
```

### Team / resource IDs (team 2374031, org 7865508)

| Resource | Name | ID |
|---|---|---|
| Webhook (instant trigger) | `autolenis` | hook `2439911` |
| Router scenario | AutoLenis Router — Event → Enrollment | `5355993` |
| Processor scenario | AutoLenis Processor — Dispatch Due Enrollments | `5410025` |
| Data Store | AutoLenis Nurture Enrollments | `108287` |
| Data Structure | AutoLenis Nurture Enrollment | `400444` |

## Router (scenario 5355993, instant via hook 2439911)

`gateway:CustomWebHook` → `util:SetVariable2` (map `event` → `campaign`) →
`datastore:AddRecord`.

- Enrollment record key = `idempotencyKey` (`event:domainEntityId`). Unique per
  occurrence, so a retried event replaces (overwrite) the same row — idempotent
  — while a genuinely new occurrence (e.g. a second offer) enrolls separately.
- Record fields: `contact_id, email, phone, campaign, next_step=1,
  due_at=now, status="active", enrolled_at=now`.
- Event → campaign map (the `switch()` in module 2): `buyer_signup→welcome`,
  `vehicle_request_submitted→vr_received`, `auction_started→auction_live`,
  `offer_received→offer_in`, `offer_selected→deal_formed`,
  `deposit_paid→deposit_confirmed`, `docusign_signed→contract_signed`,
  `refinance_inquiry→refi`, `trade_in_submitted→trade_in`,
  `saved_search_created→saved_search_confirm`,
  `saved_search_matched→saved_search_match`, `calculator_completed→calc_followup`,
  `exit_intent_captured→exit_intent_recovery`,
  `partial_lead_captured→abandonment`, `lead_magnet_downloaded→magnet`,
  `affiliate_signup→aff_welcome`, `dealer_invited→dealer_welcome`,
  `zura_conversation_captured→zura_followup`, `buyer_inactive→winback`,
  `purchase_completed→postclose`, else `unmapped`.

## Processor (scenario 5410025, every 15 min — **created PAUSED**)

`datastore:SearchRecord` (`status="active"` AND `due_at < now`, sort `due_at` asc,
limit 50) → `util:SetVariable2` (campaign → template_key) →
`http:ActionSendData` (POST dispatch, header `X-Dispatch-Key`) →
`datastore:UpdateRecord` (mark `completed`).

## ⚠️ Before activating — operator checklist

These scenarios are validated structurally and wired to the live data store, but
the following MUST be completed (most are the same blockers from the audit):

1. **Seed the templates** (`05` + `08_nurture` + `09`) to prod. Nothing renders
   until `email_templates` is populated and `template_key` exists.
2. **Set `CRM_DISPATCH_KEY`** in the Processor's `X-Dispatch-Key` header
   (currently the literal placeholder `REPLACE_WITH_CRM_DISPATCH_KEY`). Use the
   same secret the dispatch route verifies. Do not commit the secret anywhere.
3. **Confirm the dispatch base URL** in the Processor HTTP module
   (`https://www.autolenis.com/api/crm/dispatch/email`) matches prod.
4. **Set `MAKE_WEBHOOK_URL`** (`https://hook.us2.make.com/xzcpxlr10rj962t5cm7pma2g8v4srtcf`)
   and `MAKE_WEBHOOK_SECRET` in Vercel so the app forwards events.
5. **Confirm the RPC-driven field bindings** in the Make editor. The Data Store
   modules (`AddRecord`/`SearchRecord`/`UpdateRecord`) resolve their record-field
   and filter mappers via RPC against structure `400444`; the blueprint maps the
   spec field names directly, but open each module once in the UI to confirm the
   bindings populated as expected before going live.
6. **Extend the Processor step-table for multi-step sequences.** Today it sends
   the step-1 template (`campaign → template_key` switch) and marks the row
   `completed`. Multi-step nurture (e.g. `welcome_d0 → d1 → d3 → d5 → d7`) needs
   per-(campaign, next_step) → (template_key, delay) logic: instead of
   `completed`, set `next_step+1` and `due_at = now + delay`, and only mark
   `completed` at the end of the sequence.

### Signature verification note

`lib/events/make-webhook.ts` signs each envelope with
`X-AutoLenis-Signature = HMAC-SHA256(rawBody, MAKE_WEBHOOK_SECRET)`. Make has no
native HMAC function, so the Router does not verify that header; the real
security boundary is the **outbound** dispatch callback, which the dispatch route
authenticates via `X-Dispatch-Key` / its own HMAC path. Inbound protection comes
from the secret webhook URL (and optionally the hook's `x-make-apikey`).

## Activation order

Seed templates → set Processor secret + URL → set Vercel `MAKE_WEBHOOK_*` →
verify Router field bindings → send a test event and confirm one enrollment row →
activate the Processor (scenario 5410025) → confirm one dispatch + row flips to
`completed`.
