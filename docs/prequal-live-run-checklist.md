# Prequalification — live-run checklist (real MicroBilt iPredict pull)

This is the operator checklist for running a **real, credentialed** prequal soft pull on a
**consenting subject** (yourself or someone who has read and agreed to the exact FCRA consent text).
The engineering side is fail-closed and mock-tested; the items below are the things only you can
arrange (credentials, permissible purpose, environment). **Do not run against a non-consenting third
party — that lacks a permissible purpose under the FCRA.**

## 1. What MicroBilt gives you

From MicroBilt (iPredict Advantage), obtain:

- **OAuth2 client credentials** — `client_id`, `client_secret` (grant type `client_credentials`).
- **CAID** — your MicroBilt account identifier (sent as the `X-CAID` header).
- **Product name** — e.g. `IPredict Advantage` (sent as `X-Product`).
- **Endpoint URLs** — the OAuth token URL (`…/OAuth/Token`) and the report URL (`…/iPredict/GetReport`).
  MicroBilt provides separate **sandbox** (`apitest.microbilt.com`) and **production**
  (`api.microbilt.com`) hosts.

## 2. Environment variables (set in the target environment, e.g. Vercel project env)

| Variable | Purpose | Notes |
| --- | --- | --- |
| `PREQUAL_ENCRYPTION_KEY` | AES-256-GCM key encrypting the stored `rawResponse` | **64-char hex.** Must be the SAME key already in prod — do **not** rotate, or existing encrypted reports won't decrypt. Fail-fast: a missing/short key refuses to encrypt. |
| `MICROBILT_SANDBOX` | `true` → hardcoded APPROVED mock, no network/OAuth; `false` → real call | Start `true`, then flip to `false`. |
| `MICROBILT_BASE_URL` | Production report URL | **Must end in `/GetReport`.** Must NOT contain `apitest.` (guard routes to MANUAL_REVIEW if it does). |
| `MICROBILT_OAUTH_BASE_URL` | Production OAuth token URL | `…/OAuth/Token`. |
| `MICROBILT_SANDBOX_URL` | Sandbox report URL | Used only when `MICROBILT_SANDBOX=true` (returns the mock before any network call, so optional for the mock path). |
| `MICROBILT_OAUTH_SANDBOX_URL` | Sandbox OAuth token URL | As above. |
| `MICROBILT_CLIENT_ID` | OAuth client id | Must NOT contain the literal `placeholder` (guard → MANUAL_REVIEW). |
| `MICROBILT_CLIENT_SECRET` | OAuth client secret | Read only inside the adapter; never logged or sent to the client. |
| `MICROBILT_CAID` | `X-CAID` header | |
| `MICROBILT_PRODUCT` | `X-Product` header | Defaults to `IPredict Advantage` if unset. |
| `CURRENT_TERMS_VERSION` | Stamped on the `PrequalConsent` audit row | Optional; defaults to `2026-01-01`. |

Legacy fallbacks still honored: `IPREDICT_GET_REPORT_URL` (report), `MICROBILT_OAUTH_TOKEN_URL` (OAuth).
Prefer the `MICROBILT_*_BASE_URL` names.

## 3. Consent + permissible purpose (must be in place BEFORE the pull)

- **Permissible purpose:** the consumer's own **written instructions** under the FCRA
  (§604(a)(2) / §604(a)(3)(F)(i)) authorizing AutoLenis to obtain their credit profile **solely to
  prequalify them for credit**. This is captured as the "I AGREE" consent on the prequal form.
- The exact consent language is `FCRA_CONSENT_TEXT` (in `microbilt.service.ts`) — it is persisted
  **verbatim** to `PrequalConsent` (with IP + user-agent + terms version) **before** the bureau call,
  so a pull can never happen without a durable consent record. Do not paraphrase it.
- This is a **SOFT** inquiry only (no hard pull; does not affect the subject's score). The request
  carries `ReasonCode: "3"` and never sends income/employment to MicroBilt.
- On a **DECLINE**, an **FCRA §615 adverse-action notice** is sent automatically (with the bureau's
  principal reason codes), and an honest send-outcome `ComplianceEvent` is logged.
- The subject must genuinely be you or a person who has read and agreed to the consent text.

## 4. Exact steps for one real test pull (on yourself / a consenting subject)

1. **Sandbox smoke test first.** Set `MICROBILT_SANDBOX=true`, submit one prequal at
   `/buyer/prequal`. Confirm it returns APPROVED (mock) with no network/OAuth. This proves the app
   wiring end-to-end without spending a real inquiry.
2. **Switch to production.** Set `MICROBILT_SANDBOX=false` and the production `MICROBILT_BASE_URL`
   (`…/GetReport`) + `MICROBILT_OAUTH_BASE_URL` (`…/OAuth/Token`) + `client_id`/`client_secret`/`CAID`.
3. **Verify config (no secrets leaked).** Open the admin integrations health check
   (`GET /api/admin/health/integrations`, backed by `getMicroBiltConfigStatus`) and confirm
   `mode: PRODUCTION`, `credentialsPresent: true`, and the report/oauth URLs look right.
4. **Run the pull as the consenting subject.** Go to `/buyer/prequal`, enter the subject's **real**
   first/last name, DOB (MM/DD/YYYY), and address/city/state/ZIP, tick the **I AGREE** FCRA consent,
   and submit. (Income/employment are optional and are used only for the internal affordability gate;
   they are never sent to MicroBilt.)
5. **Verify the results:**
   - `PrequalConsent` row exists with the verbatim consent text + timestamp/IP.
   - `PreQualification` row: a real `decision`/`tier`/`maxOtdAmountCents`, `checkOfacAlert` reflecting
     the screening, `creditScore`/`adverseReasonCodes` populated, and `rawResponse` stored encrypted.
   - A `ComplianceEvent` was logged (approval / adverse-action / under-review as appropriate), and the
     corresponding email was sent.
6. **Inspect the raw response (authorized only).** Use `scripts/decrypt-prequal-error.ts` with
   `PREQUAL_ENCRYPTION_KEY` to decrypt the stored `rawResponse` for troubleshooting.

## 5. Fail-closed behavior you should expect (not bugs)

- **Missing/placeholder credentials or an `apitest.` URL in production** → the pull routes to
  `MANUAL_REVIEW` (reason `CONFIG_ERROR` / `CONFIG_MISMATCH` / `URL_NOT_CONFIGURED`) and alerts ops —
  it never silently fake-approves.
- **Timeout (10s), OAuth failure, network error, HTTP error, or an iPredict ERROR body** →
  `MANUAL_REVIEW` with a provider-error reason + admin alert; never thrown to the buyer.
- **OFAC screening data absent on an otherwise-approved response** → treated as **indeterminate** and
  routed to `MANUAL_REVIEW` — an approval is issued only on an **affirmative OFAC clear**. An OFAC hit
  → `OFAC_REVIEW` (silent to the buyer) + ops alert.
- **Deceased indicator, MLA covered borrower, or a fraud warning** → `MANUAL_REVIEW`.

## Known non-blocking follow-ups (documented, not fixed in this pass)

- `mlaCovered` is stored as `false` when a response omits MLA data (the schema column is
  non-nullable). If MLA screening is part of your product, absence should arguably be indeterminate;
  making it tri-state would need a migration. Tracked, deferred.
- `highRiskAddressFlag` is parsed from the response but has no column, so it is not persisted (used
  nowhere). Add a column only if you want to store/act on it.
