> Source: split verbatim from AUTOLENIS_CRM_PRODUCTION_PACKAGE.md. Statuses marked ❓/⚠ are superseded by AUTOLENIS_REPO_AUDIT.md where code was checked.

# ARTIFACT 1 — CRM & Automation Blueprint

The master architecture document. Every engineer reads this first. **v2.0 · 2026-06-16 · Owner: Markist Athelus · Status: Authoritative**

## 1.1 System Overview

AutoLenis's CRM/automation system is the behavioral marketing and revenue engine for a buyer-first automotive reverse-auction platform. It identifies, tracks, scores, nurtures, converts, retains, and attributes every visitor, buyer, dealer, and affiliate across their lifecycle. Governing principle: no qualified lead is ever lost to lack of follow-up. Current reality: the spine (Router + Processor + content) is built; event coverage and the first dealer are the gates — not more campaigns.

## 1.2 Business Objectives

Capture every lead · track every meaningful action · score every prospect · nurture every contact · automate every follow-up · activate the first dealer · grow affiliates · increase conversion + retention · generate referrals · provide complete attribution · enforce compliance by construction.

## 1.3 AutoLenis vs Make.com Responsibilities

| Concern | AutoLenis (System of Record) | Make.com (Orchestration Brain) |
|---|---|---|
| Customer data, CRM, consent, suppression | Owns | Never |
| Sending email/SMS, compliance enforcement, audit | Owns (dispatch endpoints) | Never sends directly |
| Lead scoring, attribution, revenue | Owns | Reads via payload only |
| What/when/which-campaign, sequencing, delays, branching, enrollment | Emits events | Owns |
| Re-engagement / reconciliation logic | Provides queries/endpoints | Owns schedule + decision |

**Iron rule:** every communication routes back through an AutoLenis dispatch endpoint before delivery (TCPA / CAN-SPAM / consent / suppression / audit / attribution). Make holds no delivery credentials.

## 1.4 Data Flow

```
User action (app)
  → AutoLenis emits domain event  → POST (HMAC-signed) → Make Router webhook
      → Router maps event → campaign → AddRecord(enrollment) in Make data store
  Make Processor (every 15 min)
      → SearchRecord(active & due) → GetRecord(cadence step)
      → POST AutoLenis /api/crm/dispatch/{email|sms}  (X-Dispatch-Key)
          → AutoLenis enforces consent/suppression → Resend / Twilio → deliver
          → AutoLenis logs send + attribution
      → Processor advances enrollment (next_step, due_at) or completes
  Reconciliation (daily)  → backfill uncovered contacts → Router
  Inactivity (daily)      → dormant → re-engagement enrollment
```

## 1.5 User Lifecycle Maps

- **Buyer:** Visitor → Lead → Buyer (signup) → Vehicle Request → Auction → Offer(s) → Deal → Post-close
- **Dealer:** Prospect → Registered → Verified → Active Dealer → (Reactivation if dormant)
- **Affiliate:** Applicant → Approved → Active → Producer → (Reactivation if dormant)
- **Visitor:** Anonymous → Identified Lead (email captured) → Buyer (account)

## 1.6 Communication Architecture

- **Channels:** Email (Resend), SMS (Twilio), in-app tasks/notifications (CRM).
- **Single chokepoint:** all sends pass `dispatch/*` → consent + dual SMS suppression + CAN-SPAM footer + idempotency + audit.
- **Template rendering:** `TemplateService.renderInline` stamps the centralized CAN-SPAM footer unless a template carries `<!-- autolenis:footer:v1 -->` (suppression sentinel). SMS opt-out language is auto-appended at dispatch.
- **Idempotency:** every dispatch carries `idempotencyKey = campaign:contact_id:step`.
