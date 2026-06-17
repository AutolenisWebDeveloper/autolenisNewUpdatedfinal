> Source: split verbatim from AUTOLENIS_CRM_PRODUCTION_PACKAGE.md. Statuses marked ❓/⚠ are superseded by AUTOLENIS_REPO_AUDIT.md where code was checked.

# ARTIFACT 5 — Production Readiness & Compliance

## 5.1 Make.com Architecture (live state)

| Scenario | ID | State | Notes |
|---|---|---|---|
| Router (event → enrollment) | 5355993 (hook 2439911) | ON | ⚠ no inbound HMAC yet |
| Processor (due → dispatch → advance) | 5410176 KEEPER | OFF — reactivate | corrected delta cadence; echo-bound |
| Processor duplicates | 5410246, 5410025 | OFF | retired; 5410025 kept as real-contract ref |
| Reconciliation (NLLB sweep) | — | NOT BUILT | highest-value gap |
| Inactivity engine | — | NOT BUILT | blocked on *_inactive emitters |

**Data stores:** cadence 108892 (structure 402431), enrollment 108287.

**Dispatch contract:** `POST https://www.autolenis.com/api/crm/dispatch/{email|sms}`, header `X-Dispatch-Key: <CRM_DISPATCH_KEY>`, body `{contactId, email, templateKey, campaign, step, idempotencyKey}` (❓ confirm in audit).

## 5.2 Compliance

| Domain | Control | Status |
|---|---|---|
| CAN-SPAM | Centralized footer via sentinel; AUTOLENIS_PHYSICAL_ADDRESS env | ⚠ env must be set in prod before any marketing send |
| TCPA | consent_sms checked at dispatch; quiet hours | ◑ dispatch reads consent |
| Consent | consent_email/consent_sms per contact | ✅ |
| Opt-out | STOP handling; auto-appended SMS opt-out | ⚠ two STOP handlers write different planes — consolidate (separate PR) |
| FCRA | Prequal copy: no score/decision/guaranteed-rate; prequal_started data-free | ✅ |

## 5.3 Deliverability (start now — multi-week, parallel)

| Item | Purpose | Status |
|---|---|---|
| SPF | Authorize Resend to send | ❓ verify |
| DKIM | Sign mail | ❓ verify |
| DMARC | Policy + reporting | ❓ verify |
| A2P 10DLC | Twilio SMS registration | ⛔ start now |

## 5.4 Monitoring

| Instrument | Purpose | Status |
|---|---|---|
| Coverage dashboard | KPI = uncovered contacts (forbidden 4th state) → ~0 | NOT BUILT |
| Dead-letter queue | Capture Processor/Router failures | Make DLQ available; wire alerting |
| Event audit | Every dispatch logged with idempotency + attribution | ◑ app-side logging exists |
| Reconciliation jobs | Daily NLLB backfill + inactivity | NOT BUILT |

## 5.5 Production Checklist (gate to launch)

- [ ] Repo audit complete: dispatch contract + make-webhook signing + ownership split + event-coverage map
- [ ] CRM_DISPATCH_KEY rotated; injected into KEEPER processor ONLY
- [ ] Keeper (5410176) reactivated; echo→real endpoint flip; advancement verified
- [ ] Router inbound HMAC verification added (MAKE_WEBHOOK_SECRET)
- [ ] AUTOLENIS_PHYSICAL_ADDRESS set in prod (CAN-SPAM)
- [ ] SPF / DKIM / DMARC verified; A2P 10DLC approved
- [ ] STOP-handler consolidation merged (single suppression plane)
- [ ] App-side emitters closed for all ❓ events; buyer_inactive/dealer_inactive emitters live
- [ ] Reconciliation + Inactivity scenarios built; coverage dashboard reads ~0
- [ ] In-app vs Make ownership split confirmed (no double-send)
- [ ] migrations 06 (lead score) + 07 (content platform) confirmed applied to prod
- [ ] Remove crm-dispatch-echo-test Supabase function
- [ ] Financing templates + dealer recruitment/reactivation content (as those funnels open)
