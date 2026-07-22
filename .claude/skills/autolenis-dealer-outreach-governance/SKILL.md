---
name: autolenis-dealer-outreach-governance
description: Governs whether and how qualified dealer prospects may be contacted — outreach eligibility, campaign assignment, contact priority, calling windows, email rules, SMS consent requirements, suppression + do-not-contact + opt-out handling, frequency limits, duplicate-contact prevention, outreach ownership, message approval, follow-up sequences, escalation, and activity/outcome logging. Public availability of a phone/email is NOT consent for every channel; SMS requires consent + messaging-law controls; marketing email needs sender identity + opt-out. Third-party sales skills may recommend but never bypass these controls. Outreach stays disabled by default until approvals, consent controls, and credentials are reviewed and explicitly enabled. Use before any dealer outreach.
---

# AutoLenis Dealer Outreach Governance

## Purpose & authority
The compliance gate between a qualified prospect and an actual contact. Extends the existing dealer
outreach + suppression + consent stack; **no third-party skill may launch or bypass outreach.**
Outreach is **disabled by default** until governance + consent + credentials are explicitly enabled.

## Existing architecture to extend — READ BEFORE WRITE
- Outreach: `lib/services/dealer-recruitment/dealer-email-send.service.ts`,
  `dealer-followup.service.ts`, `email-template.service.ts`, `phone-script-drafter.service.ts`,
  `unsubscribe-token.service.ts`; `DealerOutreachLog` (per-attempt log powering rate limiting),
  `DealerProspect` (`sequencePausedAt`, `sequencePauseReason` = bounced|opted_out|replied|manual).
- Consent/suppression: `lib/services/suppression.service.ts`, `SmsOptOut`, `PrequalConsent`, Twilio
  STOP/START/HELP webhooks — all governed by `autolenis-communications-consent`.
- Crons: `app/api/cron/dealer-followup`, `dealer-inactive`, `dealer-invitation-reminder`.

## Governance controls
Outreach eligibility · campaign assignment · contact priority · calling windows · email rules · SMS
consent requirements · suppression rules · do-not-contact handling · opt-out handling · frequency
limits · duplicate-contact prevention · outreach ownership · message approval · follow-up sequences ·
escalation · activity logging · outcome logging.

## Core rules
1. **Public ≠ consent.** A published phone/email does not authorize every channel. **SMS requires
   consent + messaging-law controls** (A2P/TCPA/quiet hours). **Marketing email requires sender
   identity + working opt-out** (unsubscribe token). Calling respects suppression + time windows +
   internal policy.
2. **Eligibility gate.** Only `VERIFIED`, non-suppressed, non-opted-out prospects with a valid
   channel are eligible; `bounced`/`opted_out`/`replied` pause the sequence.
3. **Frequency + dedup.** Enforce per-prospect frequency limits and duplicate-contact prevention via
   `DealerOutreachLog`; every attempt + outcome is logged and auditable.
4. **Third-party skills recommend only.** Apollo/Sales-Do may draft/suggest; sending happens only
   through the governed AutoLenis paths with approval and the kill switch respected.
5. **Never send real outreach from automated tests.**

## Prohibited behavior
Contacting suppressed/opted-out/unverified prospects; SMS without consent; email without opt-out/
sender identity; exceeding frequency limits; third-party skills sending directly; auto-enabling
outreach without explicit review.

## Testing & acceptance criteria
Opt-out/suppression, consent-required-for-SMS, frequency-limit, duplicate-prevention, sequence-pause,
and outcome-logging tests; a guard that no test sends real messages. Done = outreach only to
eligible, consented, non-suppressed prospects, fully logged, disabled-by-default until enabled.

## Cross-skill links
`autolenis-dealer-prospecting-orchestrator` · `-contact-verification` · `-dealer-lead-scoring` ·
`-dealer-prospect-review-queue`; `autolenis-communications-consent` · `autolenis-dealer-marketplace`
· `autolenis-integrations` · `autolenis-observability-sre`.
