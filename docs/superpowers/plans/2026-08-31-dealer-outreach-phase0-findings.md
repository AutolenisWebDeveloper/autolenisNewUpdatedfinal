# Phase 0 — /admin/dealer-outreach inspection findings

Every line below was derived by reading running code and `schema.prisma` in this
session. Where a finding contradicts the task brief, the brief's claim is quoted and the
evidence given. Labels: **VERIFIED** = read in this session. **UNVERIFIED** = not
checkable from this environment.

## What the page does today (running code, not docs)

`app/admin/dealer-outreach/page.tsx` is an RSC shell: `requireAdmin()`, then a single
`dealerProspect.findMany({ include: { buyerOpp }, orderBy: createdAt desc, take: 250 })`,
status counts via `groupBy`, two backfill counts, and a `dealerOutreachLog.findMany`
filtered to `channel: "email"` and `status in (sent, delivered, replied)` to derive a
"latest outreach" map and a per-step sequence history. It renders a six-tile status
strip, four tabs (All / New / Active / Closed), an email-health banner, three action
buttons (run follow-ups, backfill emails, backfill scripts), and hands 250 serialized
rows to `DealerPipelineClient` for client-side search/filter/sort. Twelve API routes
exist under `app/api/admin/dealer-outreach/**` (list, stats, coverage, email-health,
compose, preview, send, send-batch, run-followups, pause-sequence, two backfills, plus
per-prospect detail / reenrich-email / regenerate-script). It is a **prospect browser
with an email sender bolted on** — there is no work queue, no prioritisation, no
contactability concept, no SMS, and no Apollo control surface.

## Findings that CONTRADICT the task brief

| # | Brief said | Evidence | Consequence |
|---|---|---|---|
| 1 | "Build ONE Apollo service module" (implying none exists) | **VERIFIED** — `apollo.service.ts` (3-stage adapter with an injectable `ApolloClient` seam), `apollo-reveal.service.ts` (cache → idempotency claim → atomic draw → reveal → store), `apollo-credit-ledger.service.ts` (per-cycle cap, atomic conditional `updateMany`, reserve/release taper) all ship today, with five test files | EXTEND these three. Creating a new Apollo module would be the exact parallel system the anti-duplication rule forbids. |
| 2 | "If the enum lacks values, write the migration" | **VERIFIED** — `enum DealerProspectStatus` already contains `DISCOVERED, SCRIPTED, DRAFTED, CONTACTED, REPLIED, ONBOARDED, DEAD` | **No enum migration is needed.** The full status machine is already expressible. |
| 3 | "Check `sms_opt_outs` … at SEND time" | **VERIFIED** — `grep smsOptOut lib/ app/` returns **zero** hits. `crm-sms.ts` documents its removal as F-014: the Prisma `SmsOptOut` table "was read here but has NO writer anywhere, so the check was dead and created false assurance of a second plane" | Do **not** reinstate it. `sms_suppression` is the single canonical store; wiring a writerless table back in would recreate the false-assurance bug. |
| 4 | "Check whether Playwright is already configured" | **VERIFIED** — `playwright.e2e.config.ts` + `playwright.visual.config.ts`, `tests/e2e/` with three specs, `test:e2e` / `test:visual` scripts | Extend `playwright.e2e.config.ts`. No third harness. |
| 5 | "Wire Playwright into the repo's existing CI gate" | **VERIFIED** — `.github/workflows/ci.yml` has three jobs (`ci`, `migrations`, `dependency-audit`); **none runs Playwright** | This is genuinely new CI work, not a config tweak. |
| 6 | "the three existing unapplied migrations (20261014/20261015/20261016)" | **UNVERIFIED against the live database.** On disk the chain runs to `20261101000001_affiliate_rls`; eight migration directories exist at or after `20261014`. Which are unapplied in production cannot be determined from this environment | The new migration is written and left unapplied regardless; the owner reconciles the applied set. |

## Findings the brief did not mention

7. **VERIFIED — `sendDealerEmail` under-reports every blocked send.** The
   `dealerOutreachLog.create` is at step 5, after seven early returns
   (`not_configured`, `not_found`, `no_email`, `already_contacted`, `suppressed`,
   `undeliverable`, `rate_limited`). Six are real attempts that leave **no row at all**.
   This is the concrete defect behind Phase 2's "unconditional write" requirement, and it
   means the current 0-row `dealer_outreach_log` cannot be read as "nothing was ever
   attempted" — only as "nothing ever got past every gate".

8. **VERIFIED — the paid Apollo path is domain-first and therefore capped at ~9%.**
   `apolloResolveAndReveal` stage 1 is `organizations/lookup` keyed on
   `normalizeWebsiteHost(website)`. With website coverage at 133/1,532, org resolution
   fails for ~91% of the list before a person is ever searched. This corroborates the
   brief's conclusion that People Search must be the primary acquisition route — and
   explains *why* in terms of the running code.

9. **VERIFIED — waterfall is already deliberately suppressed.** `peopleMatch` passes
   `reveal_personal_emails: false, reveal_phone_number: false` and no waterfall params,
   with a comment that Apollo only cascades to variable-cost partner providers when a
   waterfall param is present. The brief's "waterfall behind its own flag, OFF by
   default" is therefore *preserving* an existing invariant, not introducing one.

10. **VERIFIED — reveal idempotency is keyed on the wrong axis for this job.**
    `ApolloReveal` is `@@unique([rooftopId, cycleKey])`. The brief requires the spend
    guard keyed on `apollo_person_id`. These are different keys: two prospects at one
    rooftop share a claim today, but one Apollo person appearing under two rooftops would
    be revealed twice. Hence the new unique `apollo_person_id` column.

11. **VERIFIED — a compliance gap the brief does not resolve.** `sendCrmSms` hard-gates
    on `contact.consent_sms` (explicit TCPA consent) and `do_not_contact`. Dealer
    prospects carry **no consent record of any kind**, and Apollo direct dials are
    vendor-sourced. Phase 3 as specified would send SMS to numbers with no consent basis.
    The plan builds the path with DNC + suppression + quiet-hours gates and a flag that
    is OFF by default, and records consent basis per row — but **whether to enable it is
    an owner/counsel decision**, flagged rather than silently assumed.

12. **VERIFIED — the 594 `contact_name` values are unusable as-is.** `contact_source`,
    `contact_confidence` and `contact_linkedin` are NULL on all 1,532 rows, so no
    provenance exists for any of them. `contact-resolution.service.ts` actively *clears*
    the person block when it falls back to a role inbox, confirming these fields are
    treated as untrustworthy by the code itself. The queue therefore reads personnel
    from `dealer_contact_profiles` only.

## Reuse decisions (REUSE → EXTEND → CONSOLIDATE → CREATE)

| Need | Decision | Target |
|---|---|---|
| Apollo HTTP | **REUSE** the single `apolloFetch` + `ApolloClient` seam | `apollo.service.ts` |
| Credit cap | **REUSE** the atomic conditional draw | `apollo-credit-ledger.service.ts` |
| Reveal orchestration | **EXTEND** with per-person keying | `apollo-reveal.service.ts` |
| Rooftop keys/normalizers | **REUSE** — no second normalizer | `dealer-identity.service.ts` |
| Send-safe definition | **REUSE** `SEND_SAFE_STATUSES` | `contact-resolution.service.ts` |
| Suppression | **REUSE** `SuppressionService` | `suppression.service.ts` |
| Twilio | **REUSE** the `crm-sms.ts` client pattern | no new SDK wrapper |
| Unconditional write | **REUSE** the `withCronRun()` pattern | `cron-monitor.service.ts` |
| Playwright | **EXTEND** the existing e2e config | `playwright.e2e.config.ts` |
| Queue read-model | **CREATE** — nothing equivalent exists | `outreach-queue.service.ts` |

---

# Addendum — STOP CONDITION #1 TRIGGERED (owner-defined)

Owner instruction: *"If Phase 0 inspection shows the current page ALREADY writes to
`dealer_outreach_log` and simply never executes, stop and report — the root cause is an
unreached code path, not a missing one."*

**It does. Reporting.**

## The write exists and is fully wired end to end — VERIFIED

| Layer | Evidence |
| --- | --- |
| UI | `OutreachActions.tsx` — Preview modal + Send + Send Followup buttons |
| Rendered | `DealerPipelineClient.tsx:405` renders `<OutreachActions>` per row |
| Route | `POST /api/admin/dealer-outreach/send` → `sendDealerEmail` (`send/route.ts:43`) |
| Service | `dealer-email-send.service.ts:329` — `prisma.dealerOutreachLog.create` |
| Other callers | `post-intake-outreach.service.ts:274`, `dealer-followup.service.ts:186`, `send-batch/route.ts:58` |

Four independent call paths reach the same writer. **Nothing about the log write is
missing.** The 0-row table is an execution fact, not a code gap.

## Why it never executes — the gate ordering, VERIFIED by line number

```
dealer-email-send.service.ts
  L192  missingEmailEnvVars()  → returns `not_configured`   ← BEFORE any DB access
  L251  suppression gate
  L314  issueProspectClaimToken(prospect.id)                ← mints claim_token
  L329  prisma.dealerOutreachLog.create(...)                ← the log write
```

`claim_token` is minted at **L314**, seventeen lines *before* the log write at **L329**.
Production has `claim_token` NULL on **0/1,532** rows. Therefore **no send has ever
reached L314**, which places the failure at or before the L192 env gate, the L251
suppression gate, or the intervening prospect-load / deliverability / rate-limit gates —
never at the writer itself.

## Prime suspect: `.env.example` contradicts `REQUIRED_EMAIL_ENV_VARS` — VERIFIED

`lib/services/dealer-recruitment/email-channel-config.ts:12`

```ts
export const REQUIRED_EMAIL_ENV_VARS = [
  "DEALER_OUTREACH_FROM_EMAIL",
  "DEALER_OUTREACH_REPLY_TO",
  "AUTOLENIS_PHYSICAL_ADDRESS",
  "RESEND_API_KEY",
] as const;
```

`frontend/.env.example:70-71`

```
DEALER_OUTREACH_FROM_EMAIL=   # optional
DEALER_OUTREACH_REPLY_TO=     # optional
```

The env template tells the operator two of the four **required** vars are **optional**.
An operator who followed the template left them blank; `missingEmailEnvVars()` then
returns non-empty and **every send on all four call paths returns `not_configured` at
L192**, before Prisma is touched. That single config contradiction fully explains 0 log
rows, 0 `contacted_at`, and 0 `claim_token` simultaneously.

**Status: ASSUMPTION, not verified.** Confirming it requires reading the deployed Vercel
environment, which this session cannot do. It is the highest-probability cause consistent
with every production number given, but the gate could equally be L251 (suppression) or
the `no_email` return at L~230 (1,365/1,532 prospects have no email at all — that return
is also log-less).

## What this changes in the plan

- **Task 6 shrinks.** It is no longer "build the log writer" — the writer exists. It
  becomes (a) move the write ahead of the gates so blocked attempts are recorded, and
  (b) fix `.env.example` so the required set stops being described as optional. The
  derived-read helpers and the idempotency index are unaffected.
- **A one-line fix may unblock outreach entirely**, independent of everything else in
  this PR. That is worth knowing before 13 tasks are built on the assumption that
  outreach is structurally absent. It is not structurally absent — it is gated shut.
- **The diagnostic gap is the real defect.** A send that fails at L192 returns a
  structured reason to the caller and logs a `warn`, but leaves no durable trace
  anywhere. Nobody could tell "never attempted" from "attempted and blocked" — which is
  precisely why this went unnoticed. Task 6's unconditional write is the permanent fix;
  the env correction is the immediate one.
