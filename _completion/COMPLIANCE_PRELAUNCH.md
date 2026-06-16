# AUTOLENIS — Pre-Launch Compliance Gates

**Date:** 2026-06-15 · **Owner:** founder + legal counsel · **Status of this doc:** living tracker, separate from code-axis readiness.

> Spun out of `REPORT.md` §8 so these are tracked as **named go-live gates with owners**, not buried footnotes. Each item was independently re-verified in code this session — the verdicts below reflect what the code actually does, not assumptions. **Correction to the prior closure report:** §8 listed FCRA/TCPA as "not verified / floating." On verification, both are substantially **implemented**; the residual work is legal sign-off + capture/coverage confirmation, not building the control.

---

## 1. FCRA adverse-action notice — **IMPLEMENTED (legal sign-off pending)**
**Gating:** before the first real declined prequal reaches a consumer.
**What exists (verified):**
- Automated decline path sends the notice: `lib/services/prequal/prequal.service.ts:382-405` — "FCRA § 615: Send adverse action notice on DECLINED decisions"; idempotent with honest audit outcomes (`ADVERSE_ACTION_NOTICE_SENT` / `SUPPRESSED_DUPLICATE` / failure), non-blocking.
- Admin decline path also sends it: `lib/services/prequal/admin-prequal.service.ts:634-645`.
- Notice content (`lib/services/email/templates/adverse-action.tsx`) includes the FCRA §615 required elements: CRA identification (**MicroBilt Corporation, 1-800-884-4747**, lines 67-70), statement the CRA didn't make the decision (line 74), **principal reason codes** (§615(a), lines 22-28), right to a **free report within 60 days** (line 80), right to **dispute** (line 81), and the FCRA citation (lines 85, 93).
- Buyer-facing declined page exists: `app/buyer/prequal/declined/page.tsx`.

**Residual (legal review — owner: legal):**
1. **ECOA / Reg B notice** is not evident in the template — an ECOA adverse-action notice (statement of specific reasons or right-to-reasons + the ECOA anti-discrimination boilerplate) is a *separate* requirement from FCRA §615 when a credit application is denied. **Confirm whether prequal constitutes a credit "application" under ECOA; if so, add the Reg B notice.**
2. **OFAC-denial path:** `OFAC_ESCALATED` / `OFAC_REVIEW` are distinct decision states and do **not** trigger the FCRA notice (by design — an OFAC hold is not a consumer-report-based credit denial). Confirm with legal that an OFAC-driven denial's notice regime is handled correctly.
3. **Retention:** compliance events are logged; confirm the notice + audit trail retention period meets FCRA recordkeeping expectations.

## 2. TCPA outbound-SMS consent — **IMPLEMENTED (capture-coverage check pending)**
**Gating:** before any proactive/outbound SMS to consumers.
**What exists (verified):**
- Hard consent gate before send: `lib/services/sms/crm-sms.ts:76-87` — requires `consent_sms === true` AND not `do_not_contact`; returns `no_consent`/`TCPA_CONSENT_REQUIRED` otherwise; checks suppression in both the CRM `sms_suppression` plane and the Prisma `SmsOptOut` table.
- Opt-out disclosure appended ("Reply STOP to opt out", `crm-sms.ts:110`).
- Inbound opt-out keyword handling: `app/api/twilio/sms/inbound/route.ts:21` (STOP/UNSUBSCRIBE/CANCEL/QUIT/END).
- Quiet-hours handling referenced in `crm-sms.ts`.

**Residual (owner: founder + legal):**
1. **Consent capture:** the gate *reads* `consent_sms`; confirm it is actually **captured with the required express-written-consent disclosure** at every SMS entry point (signup, lead-magnet, request-a-car, dealer/affiliate forms). Verify the capture UI + stored proof (timestamp, disclosure text, IP).
2. Confirm quiet-hours window + per-jurisdiction rules are correctly configured.

## 3. FTC claim substantiation — **OPEN (business artifact, not code)**
**Gating:** before paid acquisition traffic.
**What exists:** marketing **wording** is consistently disclaimed (no unqualified guarantees — verified across `pricing`, `refinance`, `for-affiliates`, prequal, pre-approval copy).
**Residual (owner: founder + marketing/legal):** any *quantitative* savings/"best price"/outcome claim used in ads or on-site needs **documented substantiation** on file before it runs. This is an evidence/records obligation, not a code change. Audit live + planned ad copy against substantiation files.

---

## Summary
| Gate | Code status | Blocking event | Owner |
|---|---|---|---|
| FCRA §615 adverse-action | **Implemented** | first real decline | legal (content sign-off, ECOA) |
| TCPA SMS consent | **Implemented** | first outbound SMS | founder + legal (capture coverage) |
| FTC substantiation | Wording clean; substantiation **open** | paid traffic | founder + marketing/legal |

None of these are code-axis blockers for merging PR #223 (lifecycle integrity). They are **business/legal go-live gates** that must be signed off before the corresponding launch events.
