---
name: autolenis-communications-consent
description: >-
  Authoritative rules for AutoLenis outbound communications and consent — SMS via
  Twilio (toll-free + local A2P pools), transactional email via Resend, inbound
  STOP/START/HELP keyword handling, TCPA consent + quiet hours, and the
  suppression stores that every send path must consult. Use this skill when
  working on lib/services/sms, lib/services/email, lib/services/notifications,
  lib/services/messaging, lib/services/suppression.service.ts, the Twilio inbound
  webhooks, or any task mentioning "SMS", "STOP", "opt-out", "unsubscribe",
  "A2P", "TCPA", "quiet hours", "suppression", "Resend", "EmailSendLog",
  "do_not_contact", or "consent".
---

## Purpose & Authority

This skill owns **every outbound message AutoLenis sends** (SMS + email) and the
**consent/suppression** machinery that gates them. It is the source of truth for
TCPA compliance (explicit consent, quiet hours, STOP/HELP), the Twilio number
pools, the Resend transactional path, idempotency via `EmailSendLog`, and the
canonical suppression stores. When generic guidance about "just send a text" or
"append an unsubscribe link" conflicts with the hard consent gates and
single-source-of-truth suppression rules here, **this skill wins**. Sending
without consent, skipping suppression, or duplicating STOP handling is a
compliance defect, not a style choice.

## When this skill activates

- Editing `frontend/lib/services/sms/**` (`twilio.service.ts`, `crm-sms.ts`),
  `frontend/lib/services/email/**` (`resend.service.ts`, sequences, templates),
  `frontend/lib/services/notifications/**`, `frontend/lib/services/messaging/**`,
  `frontend/lib/services/suppression.service.ts`.
- Editing inbound webhooks: `frontend/app/api/webhooks/twilio/inbound/route.ts`,
  `frontend/app/api/twilio/sms/inbound/route.ts`, and the dispatch route
  `frontend/app/api/crm/dispatch/sms/`.
- Any task mentioning: SMS, STOP/START/HELP, opt-out/unsubscribe, A2P, TCPA,
  quiet hours, suppression, `do_not_contact`, `consent_sms`, Resend,
  `EmailSendLog`, notification preferences.

## Architecture & key files

**SMS — two deliberately separate senders:**
- `frontend/lib/services/sms/twilio.service.ts` — shared one-off transactional
  sender (voice receptionist confirmations, social). Fire-and-forget, never
  throws. Uses `TWILIO_FROM_NUMBER`. **Bodies must already contain the required
  "Reply STOP to opt out." disclosure — nothing is appended here.**
- `frontend/lib/services/sms/crm-sms.ts` — the **hardened CRM SMS path**
  (`sendCrmSms`, backs `/api/crm/dispatch/sms`). Captures a REAL delivery
  outcome and hard-gates on TCPA consent + suppression + quiet hours. Selects
  from pools: `tollfree` (`TWILIO_TOLLFREE_NUMBER`, +18662803328) or `local`
  (`TWILIO_LOCAL_NUMBER`, +14695359785). Returns `CrmSmsStatus`: `sent`,
  `no_consent`, `suppressed`, `quiet_hours`, `invalid_phone`, `not_configured`,
  `failed`. It does NOT duplicate STOP/HELP handling.

**Inbound / keyword handling (the ONLY place STOP/START/HELP live):**
- `frontend/app/api/webhooks/twilio/inbound/route.ts` and
  `frontend/app/api/twilio/sms/inbound/route.ts`. Keyword sets:
  STOP = `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT`; START = `START, YES,
  UNSTOP`; HELP = `HELP, INFO`. STOP → `SuppressionService.suppressSms(...,
  'stop')`; START → `SuppressionService.handleSmsStart(...)` (preserves the
  suppression row, stamps `restarted_at` — does NOT auto-re-enable sending);
  HELP → informational reply.

**Suppression (single source of truth):**
- `frontend/lib/services/suppression.service.ts` — `SuppressionService`.
  `isEmailSuppressed` / `isSmsSuppressed`, `suppressEmail` / `suppressSms`,
  `unsuppressEmail`, `handleSmsStart`. Stores: **`sms_suppression`** and
  **`email_suppression`** (Supabase tables). Hard bounce / complaint / spam-trap
  also set `contacts.do_not_contact = true`; an SMS STOP writes `sms_suppression`
  (the canonical store every send path checks). Reasons are typed
  (`SmsSuppressionReason`, `EmailSuppressionReason`). Note: the Prisma `SmsOptOut`
  table has NO writer — `sms_suppression` is authoritative (do not resurrect a
  second plane).

**Email — Resend only:**
- `frontend/lib/services/email/resend.service.ts` — transactional email via
  Resend (the ONLY approved provider). **Idempotent: check `EmailSendLog` before
  every send.** `RESEND_API_KEY` / `FROM_NAME` from env; dealer outreach uses
  `DEALER_OUTREACH_FROM_EMAIL`. Templates in `lib/services/email/templates/**`;
  sequences in `lead-magnet-sequence.ts`, `nurture-sequence.ts`.

**Quiet hours / timezone:** `frontend/lib/crm/recipient-timezone.ts`
(`isRecipientInQuietHours`) — 08:00–21:00 **local to the recipient**; prefer
`state`, fall back to `zip`, else the CONUS-safe ET∩PT intersection.
**Notifications / preferences:** `lib/services/notifications/notification-preference.service.ts`,
`notification.service.ts`; buyer email helpers in
`lib/services/email/buyer-notifications.service.ts`.

## Core rules & invariants

1. **TCPA hard gate before any CRM SMS.** `sendCrmSms` refuses unless
   `contact.consent_sms === true && !contact.do_not_contact` (returns
   `no_consent`). No consent → no send, full stop.
2. **Suppression is checked on EVERY send path** against the canonical store
   (`sms_suppression` / `email_suppression`). A suppression-lookup error **fails
   closed** (do not send).
3. **STOP/START/HELP handling lives ONLY in the inbound Twilio webhooks.** Never
   duplicate keyword logic in senders, sequences, or dispatch.
4. **START does NOT auto-re-subscribe.** `handleSmsStart` preserves the
   suppression row and stamps `restarted_at`; re-enabling send requires the
   documented (manual-review) flow — never silently resume messaging.
5. **Quiet hours are enforced local to the recipient** (08:00–21:00), not a
   global server timezone; when location is unknown use the CONUS-safe
   intersection.
6. **Every transactional email is idempotent** — consult `EmailSendLog` before
   sending; never double-send.
7. **Resend is the only email provider; Twilio the only SMS provider.** Do not
   introduce SendGrid, Mailgun, Postmark, etc.
8. **Every marketing/CRM SMS body carries the required opt-out disclosure**
   (e.g. "Reply STOP to opt out."). The transactional `twilio.service.ts` does
   NOT append it — the caller must include it.
9. **Do not change `twilio.service.ts` for CRM needs** — it's depended on by the
   voice receptionist and social distribution; new gated sending goes through
   `crm-sms.ts`.
10. **A2P number pools are distinct** (toll-free vs local); select via
    `fromPool`, don't hard-code a raw `from` number in call sites.
11. **Record delivery outcomes** (CRM path writes `contact_timeline_events` +
    audit); never swallow a failure into a fake success.

## Workflows

**Send a CRM/marketing SMS:**
1. Normalize phone (`normalizePhone`); invalid → `invalid_phone`.
2. TCPA gate: `consent_sms && !do_not_contact` else `no_consent`.
3. Suppression check against `sms_suppression` (fail closed on error) else
   `suppressed`.
4. Quiet-hours check local to recipient (`state`/`zip`) else `quiet_hours`.
5. Select `from` from pool (`tollfree` | `local`); if unset → `not_configured`.
6. Send via Twilio; on success record real outcome + timeline/audit → `sent`;
   on error → `failed` (never a swallowed success).

**Inbound keyword (webhook):** parse first token → uppercase. STOP-set →
`suppressSms(..., 'stop')` + confirmation reply. START-set → `handleSmsStart`
(preserve row, stamp `restarted_at`, no auto-resume). HELP-set → info reply.

**Send transactional email (Resend):** build from a template; look up
`EmailSendLog` for idempotency key; if already sent, skip; else send via Resend
and write `EmailSendLog`. Bounce/complaint webhooks → `suppressEmail(...,
reason)` which also flags `do_not_contact` for hard bounce/complaint/spam-trap.

## Boundaries — do / never

**Do:**
- Gate every CRM SMS through `sendCrmSms`; check suppression on every path.
- Keep STOP/START/HELP centralized in the inbound webhooks.
- Use Resend + `EmailSendLog` idempotency for all transactional email.
- Select SMS numbers via the pool abstraction; include opt-out disclosure in
  marketing bodies.
- Do background/bulk sends off the request path (Inngest/QStash) and log the
  provider and outcome.

**Never:**
- Never send SMS/email to a suppressed or non-consented contact.
- Never fail-open on a suppression-lookup error.
- Never duplicate STOP/HELP keyword logic outside the inbound webhooks.
- Never auto-re-subscribe on START.
- Never bypass `EmailSendLog` idempotency or add a second email/SMS provider.
- Never modify `twilio.service.ts` to add CRM gating (use `crm-sms.ts`).
- Never resurrect the dead `SmsOptOut` Prisma table as a second suppression plane.
- Never swallow a delivery failure into a success.

## Best practices & examples

Suppression fails closed:
```ts
try {
  if (await SuppressionService.isSmsSuppressed(supabase, phone))
    return { status: 'suppressed', reason: 'sms_suppression' };
} catch {
  return { status: 'failed', reason: 'suppression_check_error' }; // fail closed
}
```

TCPA gate is non-negotiable:
```ts
if (!contact.consent_sms || contact.do_not_contact)
  return { status: 'no_consent', reason: 'TCPA_CONSENT_REQUIRED' };
```

Email idempotency before every Resend send:
```ts
if (await prisma.emailSendLog.findFirst({ where: { idempotencyKey } })) return; // already sent
await resend.emails.send({ from, to, subject, html });
await prisma.emailSendLog.create({ data: { idempotencyKey, to, template } });
```

## Acceptance criteria

- [ ] CRM SMS goes through `sendCrmSms` with the TCPA consent gate intact.
- [ ] Every send path checks the canonical suppression store and fails closed on
      lookup error.
- [ ] STOP/START/HELP logic remains only in the inbound Twilio webhooks; START
      does not auto-re-subscribe.
- [ ] Quiet hours enforced local to the recipient (08:00–21:00).
- [ ] Transactional email uses Resend and is idempotent via `EmailSendLog`.
- [ ] Marketing SMS bodies include the opt-out disclosure.
- [ ] SMS numbers selected via the pool abstraction (toll-free/local), not
      hard-coded.
- [ ] No second email/SMS provider and no revived `SmsOptOut` plane.
- [ ] Delivery outcomes recorded (timeline/audit); no swallowed failures.
- [ ] Bulk/background sends run off the request path with provider logged.

## Cross-skill links

- `autolenis-integrations` — Twilio/Resend/ElevenLabs env + client patterns.
- `autolenis-buyer-journey` — buyer notifications and nudge delivery consumers.
- `autolenis-dealer-marketplace` — dealer outreach email (`DEALER_OUTREACH_FROM_EMAIL`).
- `autolenis-auth-security-privacy` — webhook signature verification, PII, audit.
- `autolenis-observability-sre` — logging providers and delivery outcomes.
- `autolenis-domain-model` — `EmailSendLog`, suppression tables, `Contact`,
  consent fields.
- `autolenis-master` — platform-wide standards.
