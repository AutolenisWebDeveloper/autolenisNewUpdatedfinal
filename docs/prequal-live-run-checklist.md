# Prequalification — live-run checklist (real MicroBilt iPredict pull)

This is the operator checklist for running a **real, credentialed** prequal soft pull on a
**consenting subject** (yourself or someone who has read and agreed to the exact FCRA consent text).
The engineering side is fail-closed and mock-tested; the items below are the things only you can
arrange (credentials, permissible purpose, environment). **Do not run against a non-consenting third
party — that lacks a permissible purpose under the FCRA.**

## 1. What MicroBilt gives you

From MicroBilt (iPredict Advantage), obtain:

- **OAuth2 client credentials** — `client_id`, `client_secret` (grant type `client_credentials`).
- **Endpoint URLs** — the OAuth token URL (`…/OAuth/Token`) and the report URL
  (`…/iPredict/GetReport`). MicroBilt provides separate **sandbox**
  (`apitest.microbilt.com`) and **production** (`api.microbilt.com`) hosts.
- **The four `MsgRqHdr` identity values** — `MemberId`, `MemberPwd`, `UserName` and
  `ProductID`. The spec's security scheme is `oauth: []` only: the Bearer token
  identifies the *caller* but selects neither the member account nor the product,
  so these travel in the request body. All four are account-specific and issued by
  MicroBilt. Without them the adapter refuses to call GetReport at all (§5).
- **A worked request example.** Ask MicroBilt support for one. Parts of the request
  contract remain **unconfirmed**: iPredict has never returned a parsed report in
  production, and the remaining suspects are payload-shaped (whether an `MBCLVRq`
  envelope is required, and whether `ContactInfo` is an object or an array). Do not
  guess at those — see §6 and §7.

> **Not confirmed as required:** the adapter also sends `X-CAID` and `X-Product`
> headers, populated from `MICROBILT_CAID` / `MICROBILT_PRODUCT`. **The published
> iPredict spec does not define either header**, so obtaining a CAID may not be
> necessary at all; both are optional in code and default harmlessly. They are
> left in place until MicroBilt's example confirms or refutes them — do not
> block a cutover on getting a CAID.

## 2. Environment variables (set in the target environment, e.g. Vercel project env)

| Variable | Purpose | Notes |
| --- | --- | --- |
| `PREQUAL_ENCRYPTION_KEY` | AES-256-GCM key encrypting the stored `rawResponse` | **64-char hex.** Must be the SAME key already in prod — do **not** rotate, or existing encrypted reports won't decrypt. Fail-fast: a missing/short key refuses to encrypt. |
| `MICROBILT_SANDBOX` | `true` → hardcoded APPROVED mock, no network/OAuth; `false` → real call | Start `true`, then flip to `false`. |
| `MICROBILT_BASE_URL` | Production report URL — the **full URL including `/GetReport`** | The value is used **verbatim**; nothing appends the spec path. **Must end in `/GetReport`** or the call is refused as `REPORT_URL_INVALID`. Must NOT contain `apitest.` (refused as `CONFIG_MISMATCH`). A missing URL is `URL_NOT_CONFIGURED`. All three route to MANUAL_REVIEW — fail-closed, never an approval. |
| `MICROBILT_OAUTH_BASE_URL` | Production OAuth token URL | `…/OAuth/Token`. |
| `MICROBILT_SANDBOX_URL` | Sandbox report URL | Used only when `MICROBILT_SANDBOX=true` (returns the mock before any network call, so optional for the mock path). |
| `MICROBILT_OAUTH_SANDBOX_URL` | Sandbox OAuth token URL | As above. |
| `MICROBILT_CLIENT_ID` | OAuth client id | Must NOT contain the literal `placeholder` (guard → MANUAL_REVIEW). |
| `MICROBILT_CLIENT_SECRET` | OAuth client secret | Read only inside the adapter; never logged or sent to the client. |
| `MICROBILT_MEMBER_ID` | `MsgRqHdr.MemberId` | **Required for a real pull.** From MicroBilt. |
| `MICROBILT_MEMBER_PASSWORD` | `MsgRqHdr.MemberPwd` | **Required.** A credential — read only inside the adapter, never logged, never shown on the health page, and stripped from the stored report before encryption. |
| `MICROBILT_USERNAME` | `MsgRqHdr.UserName` | **Required.** From MicroBilt. |
| `MICROBILT_PRODUCT_ID` | `MsgRqHdr.ProductID` | **Required.** The value that selects IPredict Advantage. |
| `MICROBILT_CAID` | `X-CAID` header | **Optional / unverified** — not defined by the published iPredict spec; the product is selected by `MsgRqHdr.ProductID`, not this header. Safe to leave unset. |
| `MICROBILT_PRODUCT` | `X-Product` header | **Optional / unverified** — as above. Defaults to `IPredict Advantage` if unset. |
| `CURRENT_TERMS_VERSION` | Stamped on the `PrequalConsent` audit row | Optional; defaults to `2026-01-01`. |

Legacy fallbacks still honored: `IPREDICT_GET_REPORT_URL` (report), `MICROBILT_OAUTH_TOKEN_URL` (OAuth).
Prefer the `MICROBILT_*_BASE_URL` names. **These are the only MicroBilt variables the
code reads** — `MICROBILT_IPREDICT_BASE_URL`, `IPREDICT_REPORT_PERFORMANCE_URL` and
`IPREDICT_GET_ARCHIVE_REPORT_URL` appeared in older runbooks but have never been read
anywhere in the repo; setting them configures nothing.

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

0. **Set the four `MsgRqHdr` identity vars** (`MICROBILT_MEMBER_ID`, `MICROBILT_MEMBER_PASSWORD`,
   `MICROBILT_USERNAME`, `MICROBILT_PRODUCT_ID`). Without all four the adapter refuses to call
   GetReport at all. Confirm via the admin integrations health check that
   `identity.missing` is empty.
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
   `PREQUAL_ENCRYPTION_KEY` to decrypt the stored `rawResponse` for troubleshooting. If iPredict
   echoed the request back, `MemberPwd` is stored as `[REDACTED]` — the credential is stripped
   before encryption, so it is never persisted on the consumer-report record.

## 5. Fail-closed behavior you should expect (not bugs)

- **Missing/placeholder credentials or an `apitest.` URL in production** → the pull routes to
  `MANUAL_REVIEW` (reason `CONFIG_ERROR` / `CONFIG_MISMATCH` / `URL_NOT_CONFIGURED`) and alerts ops —
  it never silently fake-approves.
- **Any of the four `MsgRqHdr` identity vars missing or blank** → `MANUAL_REVIEW` with reason
  `IDENTITY_NOT_CONFIGURED`, **before** the GetReport call, so a misconfigured deployment never
  spends a real inquiry on a request MicroBilt cannot route. The ops log names exactly which
  environment variables are unset (names only — never their values).
- **Timeout (10s), OAuth failure, network error, HTTP error, or an iPredict ERROR body** →
  `MANUAL_REVIEW` with a provider-error reason + admin alert; never thrown to the buyer.
- **OFAC screening data absent on an otherwise-approved response** → treated as **indeterminate** and
  routed to `MANUAL_REVIEW` — an approval is issued only on an **affirmative OFAC clear**. An OFAC hit
  → `OFAC_REVIEW` (silent to the buyer) + ops alert.
- **Deceased indicator, MLA covered borrower, or a fraud warning** → `MANUAL_REVIEW`.

## 6. Reading a failure (what to do when a pull does not come back with a report)

Every failure is recorded, fail-closed, and diagnosable without a live retry:

1. **Find the reason.** `PreQualification.reason` (also on the
   `PREQUAL_PROVIDER_FAILURE` compliance event and in the admin alert email) has the
   grammar `BASE[:TYPE][:CODE]` — e.g. `HTTP_400:APPLICATION:MB1042`.
   - `BASE` is the failure kind (`HTTP_<status>`, `IPREDICT_ERROR`, `TIMEOUT`,
     `EMPTY_RESPONSE`, `REPORT_URL_INVALID`, `IDENTITY_NOT_CONFIGURED`, …).
   - `TYPE` is MicroBilt's own `RESPONSE.STATUS.error.type`: **`APPLICATION` = our
     request is malformed** (retrying it unchanged cannot help — an engineer must fix
     it); **`SYSTEM` = their service failed** (transient, may succeed on retry).
   - `CODE` is MicroBilt's error code. Only a short opaque token is promoted here —
     free-text messages are deliberately kept out of the plaintext reason because it
     travels into alert emails and MicroBilt echoes request data on some errors.
2. **Read the body.** The full response body of a failed call — including the 400 that
   names the offending field — is stored in `PreQualification.rawResponse`,
   AES-256-GCM encrypted with `PREQUAL_ENCRYPTION_KEY`. Decrypt it with:

   ```
   npx tsx scripts/decrypt-prequal-error.ts '<base64 rawResponse>'
   ```

   It is **never** written to an application log in cleartext. The stored copy is
   capped at 16,000 characters and marks itself `truncated` if it was longer. If
   iPredict echoed our request back, `MemberPwd` reads `[REDACTED]` — the credential
   is stripped *before* encryption, so it is never persisted on the consumer-report
   record even though that record is decryptable by an authorized operator.
3. **Check the config first on a `REQUEST_REJECTED` class.** `GET /api/admin/health/integrations`
   reports mode, URLs, product/CAID and whether credentials are present — no secrets.

## 7. Deferred: the request payload shape (do not change these speculatively)

iPredict has never returned a parsed report in production. Control-flow analysis of the
stored reasons rules out sandbox/host/credential/OAuth causes, which points at the request
payload. The **`MsgRqHdr` identity fields are no longer on this list** — they are now sent
and required (§2, §5), on the spec's own reading that `oauth: []` cannot select a member
account or product. The following remain **suspected but unconfirmed** and are deliberately
**not** changed until MicroBilt supplies a working request example:

- **The `MBCLVRq` envelope** — whether the request must be wrapped. Not added.
- **`ContactInfo` arity** — object (today) vs array. Not changed.
- **`X-CAID` / `X-Product` headers** — not defined by the published spec. Not removed.

Change **one** of these at a time. Changing several at once makes the next failure
uninterpretable, which is how the original eight-week outage stayed unexplained.

## Known non-blocking follow-ups (documented, not fixed in this pass)

- `mlaCovered` is stored as `false` when a response omits MLA data (the schema column is
  non-nullable). If MLA screening is part of your product, absence should arguably be indeterminate;
  making it tri-state would need a migration. Tracked, deferred.
- `highRiskAddressFlag` is parsed from the response but has no column, so it is not persisted (used
  nowhere). Add a column only if you want to store/act on it.
- The sandbox path cannot currently reach a real MicroBilt sandbox: `MICROBILT_SANDBOX=true`
  returns the hardcoded mock before any network call, while production mode refuses any
  `apitest.` URL. No configuration therefore produces a real sandbox call. This is a real
  finding, deliberately left alone — reopening it is its own decision, not a diagnostics fix.
