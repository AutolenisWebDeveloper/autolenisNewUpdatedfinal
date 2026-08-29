# Affiliate Portal — Audit Findings & Operational Remediation Plan

> **For agentic workers:** Execute with `superpowers:executing-plans` (or the repo-mirrored
> `superpowers-executing-plans`), task-by-task, checkbox (`- [ ]`) tracking, failing-test-first for
> every verified defect. Each task re-verifies its finding's file:line evidence before changing
> anything (lines drift). The full `autolenis-code-verification` loop (two independent reviews)
> runs after implementation.

**Goal:** Make `/affiliate/*` operational end-to-end — registration → onboarding → referral
attribution → commission accrual → approval → payout request → settlement — with the existing
design system, four-state pages, no dead ends, and Playwright-verified behavior.

**Architecture:** Every fix extends the existing services (`frontend/lib/services/affiliate/*`,
`lib/auth/affiliate-*`, the Stripe webhook commission walk, the admin command center). No parallel
systems. Money stays integer cents; every status transition becomes compare-and-set inside
`$transaction`; the disabled self-serve payout rail is rebuilt on the proven settlement CAS
pattern rather than re-enabled as it was.

**Tech stack:** Next.js 16 App Router · React 19 · TS strict · Prisma 5 · Supabase Postgres ·
Stripe · node:test (`tsx --test`) · Playwright (`playwright.e2e.config.ts`).

**Spec:** The task brief (affiliate portal full audit/remediation) + this document. Branch:
`claude/affiliate-portal-operational-ibwasl`. Draft PR only.

## Global constraints

- **No merge, no deploy, no production migration, no real payouts, no real emails/SMS.** Migration
  SQL is written + committed, application is an explicitly flagged owner-gated step.
- Edge routing only in `frontend/proxy.ts`; never a `middleware.ts`.
- Business logic in `frontend/lib/services/**`; handlers thin; Prisma singleton only.
- Money = integer cents; no float money; webhooks idempotent; multi-write transitions in
  `$transaction` with compare-and-set (`updateMany({ where: { id, status: expected } })`).
- Reuse `components/ui/kit` + `components/ui/patterns` + `--al-*` tokens; no new design language.
- Inngest stays removed. `buffer`/`context7` MCPs unavailable — never a dependency.
- Playwright: existing harness only; specs skip with explicit reason when `E2E_BASE_URL` /
  `E2E_STORAGE_STATE` absent; never `playwright install` (use `PW_CHROMIUM_PATH`).
- Preserve behavior outside the affiliate surface; the only out-of-surface edits are the ones a
  verified affiliate defect requires (Stripe webhook commission branch, `lib/auth/actions.ts`
  attribution sites, analytics affiliate metrics), each scoped to the defect.

---

## 1. Production evidence (Supabase project `aieybibvewmvrubcpthm`, read-only) — VERIFIED 2026-08-29

| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| affiliates | 2 | | affiliate_referrals | **0** |
| affiliate_clicks | 5 | | commissions | **0** |
| affiliate_profiles / tax / payment | 1 each | | affiliate_payouts | **0** |
| affiliate_onboarding_reviews | 1 | | affiliate_documents | 0 |
| referral_milestone_configs | 3 | | referral_milestones / tier_history / payout_methods / payout_schedules / compliance_records | 0 |

**The money path beyond click tracking has NEVER executed in production.** Attribution →
referral → commission → payout is unexercised live code. Nothing downstream of `AffiliateClick`
can be proven by production data; it is proven only by tests written in this plan. Stated per the
brief: the flow has never executed — we do not assume it works.

**Webhook-ledger evidence (added at plan revision, VERIFIED live):** `payment_provider_events`
has **0 rows** while `deposits` holds 7 PAID (+1 PENDING). The Stripe webhook handler has never
recorded an event in production; deposits reach PAID via the reconciler cron
(`deposit-activation-reconcile` → `deposit-settlement.service.ts:206-209`, which polls Stripe
PaymentIntents directly). Consequence: **commission accrual — created only in the webhook fee
branch (`stripe/route.ts:552-563`) — is currently unreachable in production**, as is any
`charge.refunded` handling. This is finding M16. Everything implemented in the webhook path is
therefore labeled **UNVERIFIED (production reachability)** in the PR, never FIXED-and-proven-live.

**Anon-key exposure check (added at plan revision, VERIFIED by grep):** the only browser Supabase
client on the affiliate surface is the register page's auth-session check
(`app/affiliate/register/page.tsx:8,70`); there are **zero** PostgREST `.from()` reads on any
affiliate table anywhere in `app/`, `lib/`, `components/`. All affiliate data access is
Prisma/service-role. Therefore RLS migration 002 is **hardening** (chain-provisioned envs, future
anon usage), not a live production risk — stated per the owner's requirement.

Physical-schema facts (information_schema, not `_prisma_migrations`): all 16 tables exist;
`affiliates` carries a **duplicate column pair** `lastInactiveNudgeAt` *and* `last_inactive_nudge_at`
(schema.prisma maps only the snake_case one — the camelCase column is orphaned); `commissions.rate`
is `double precision` (all amounts are `integer` cents); `commissions` has **no index on
`affiliate_id`**, `affiliate_payouts` has **no index beyond its PK**; `commissions.qualifying_event_id`
is UNIQUE (idempotency anchor, confirmed live).

## 2. Refuted hypotheses (evidence, not inference)

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| X1 | Step-10 canonical rewrite loops suspended/rejected affiliates | **REFUTED** (pre-stated in brief; independently re-confirmed) | `proxy.ts:92-94` PUBLIC_ROUTES + `proxy.ts:452-454` step-4 short-circuit |
| X2 | `PENDING` affiliates deadlock like the dealer portal | **REFUTED** | `requireAffiliate()` permits PENDING (`affiliate-session.ts:26-34`); no onboarding gate is even wired (R3) |
| X3 | Dashboard vs Earnings page disagree with the ledger (P0 candidate) | **REFUTED** | Both consume the same `getCommissionSummary` (`dashboard/page.tsx:29`, `earnings/page.tsx:12`, `earnings/route.ts:8`), `force-dynamic`, no cache. The real display defects are M1 (clawback) and M8 (buyer surfaces) |
| X4 | Payout double-pay under concurrent settlement | **REFUTED** for the admin rail | `settleApprovedCommission` (`affiliate-payout.service.ts:39-86`): one `$transaction`, APPROVED→PAID CAS via `updateMany`, count≠1 rolls the payout back; route 409s (`mark-paid/route.ts:49-62`); self-serve rail hard-disabled (503) so cannot race |
| X5 | Tax data stored unencrypted (PII exposure) | **REFUTED** | Only `tinLast4` / bank last4 are persisted (`schema.prisma:2489,2507-2508`; `finance/tax-info/route.ts:30-43` truncates in-handler); no full SSN/EIN at rest, so field-level crypto is not required |
| X6 | Cross-affiliate document access | **REFUTED** | Listing scoped by `affiliateId`, 1h signed URLs (`documents/route.ts:13-39`); admin 15-min signed URLs behind admin auth; storage path `${affiliate.id}/${type}/${uuid}` — bucket privacy itself is a deployment-checklist item (UNVERIFIED live, noted in §6) |
| X7 | `x-pathname` wiring broken | **REFUTED** (pre-stated) | `proxy.ts:399-400` sets unconditionally; consumers null-safe |
| X8 | Affiliate API routes skip auth | **REFUTED** | All 21 authenticated routes call `getRequestAffiliate` (per-route grep); only `register` (public by design) + token-credential `public/affiliate/unsubscribe` are unauthenticated |

## 3. Findings register

IDs are stable for the PR disposition table. Severity from the audits; **[dup]** marks the same
defect found independently by two auditors. Every finding below is VERIFIED at the cited
file:line unless marked ASSUMPTION.

### Money path (M)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| M1 | P1 | Clawback writes a **negative REVERSED** offset (original stays PAID) but every affiliate-facing total (summary, leaderboard, digest, referrals page) **excludes REVERSED rows** → affiliate/leaderboard/digest permanently overstate earnings after any clawback; admin nets them. Two reversal mechanisms with opposite aggregation semantics. **[dup: D-audit]** | `admin-affiliate-command-center.service.ts:855-880` vs `commission.service.ts:128-150`, `affiliate-leaderboard.service.ts:47`, `digest.service.ts:104-108`, `earnings/page.tsx:23` |
| M2 | P1 | `charge.refunded` never touches Commission; cron auto-approves `PENDING` on **age alone** (7 days from fee payment, not deal outcome) → refunded deal leaves a payable APPROVED commission | `webhooks/stripe/route.ts:632-721`; `cron/affiliates/route.ts:12-17` |
| M3 | P2 | Legacy fee path (deal resolved via `stripeFeePIId`, no metadata) **silently skips the commission walk** — no log, no DLQ | `webhooks/stripe/route.ts:479-485,552` |
| M4 | P2 | Basis fallback pays 15% of `PREMIUM_FEE_CENTS` (49900) when basis missing → **overpays ~25%** (real basis is $400 `amount_received` after deposit credit); buyer surface advertises 7485¢ while ledger pays 6000¢ | `commission.service.ts:22,28`; `buyer/referral.service.ts:24`; `constants.ts:8` |
| M5 | P2 | Admin approve/reject/reverse are read-then-write (no CAS); REJECTED→REVERSED allowed | `…/approve/route.ts:21-35`, `reject/route.ts:21-36`, `reverse/route.ts:30-48` |
| M6 | P2 | Attribution silent drops: `ensurePrismaUser` provisioning paths (signIn `actions.ts:403`, acceptTerms `actions.ts:590-600`) never call `recordAffiliateAttribution`; cookie is only read client-side at signup (JS-off drops it); `affiliate_ref` cookie lacks `secure` | `lib/auth/actions.ts`; `proxy.ts:408-416`; `SignUpClient.tsx:150-154` |
| M7 | P2 | `requireAffiliate` loads **all APPROVED commissions** (unbounded, no consumer) + `user: true`, ~2× per page view (layout + page) **[dup: D4]** | `affiliate-session.ts:11-18`; `portal/layout.tsx:16` + 14 pages |
| M8 | P2 | Three conflicting referral/earning definitions on buyer surfaces: buyer referral API counts `children` (sub-affiliates!) and includes REJECTED; page counts `AffiliateReferral` + APPROVED-only; portal excludes REJECTED+REVERSED | `buyer/referral.service.ts:14-16` vs `buyer/referral/page.tsx:22-43` vs `commission.service.ts:127-150` |
| M9 | P2 | Milestones evaluated **only on `/buyer/referral` page view**; pay route read-then-write; milestone money is a bare `paidAt` timestamp with no ledger record | `buyer/referral/page.tsx:36`; `admin/referral-milestones/[id]/pay/route.ts` |
| M10 | P3 | Admin manual commission `qualifyingEventId` includes `Date.now()` → double-submit double-pays (≤$1,000 each); `basisCents` left null **[dup: D19]** | `admin/affiliates/[affiliateId]/commissions/route.ts:60` |
| M11 | P3 | `payout-invariants.ts` (`isCommissionSettled`) imported **only by its test** — never on a write path | grep; `affiliate-payout.service.ts:68-71` satisfies it structurally |
| M12 | P3 | Dead money schema: `AffiliateTier`/`AffiliateTierHistory` zero references; `AffiliatePayoutSchedule` displayed (`finance/page.tsx:40-48`) but nothing honors it; `PayoutStatus` PENDING/PROCESSING/FAILED/REVERSED unreachable | grep; `schema.prisma:1935-1940,3085-3106` |
| M13 | P3 | Click tracking unauthenticated + unlimited (no rate limit); conversion marks the affiliate's most recent unconverted click **by anyone**; `hashIp` falls back to a hardcoded salt | `public/referral/track/route.ts`; `referral.service.ts:25,107-117` |
| M14 | P3 | Commissions accrue to non-ACTIVE affiliates; `Buyer.affiliateId` never written by the referral chain → inactive-cron's buyer signal dead | `commission.service.ts:30-40`; `cron/affiliate-inactive/route.ts:50-54` |
| M15 | P3 | Earnings level bars computed from `take: 50` rows next to full-table summary cards — disagree past 50 commissions **[dup: D18]** | `earnings/page.tsx:14-26` |
| M16 | P1 | Commission accrual depends exclusively on the Stripe webhook fee branch, and the webhook ledger has never recorded a production event (0 `payment_provider_events` rows vs 7 PAID deposits, which reach PAID via the reconciler) → accrual and refund handling are unreachable live | §1 webhook-ledger evidence; `stripe/route.ts:552-563`; `deposit-settlement.service.ts:206-209` |

### Routing & auth (R)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| R1 | P2 | Bare `/affiliate/portal` → step-10 rewrite to `/affiliate/portal/portal` → **404**; reachable via post-sign-in redirect (`getSafeAffiliateRedirect` accepts the bare prefix) | `proxy.ts:640-647`; `lib/auth/urls.ts:13-19`; no `app/affiliate/portal/page.tsx` |
| R2 | P2 | `PORTAL_PREFIXES` dead code; no edge role↔portal isolation (server-side gate covers it — two-hop bounce verified) | `proxy.ts:158-163` |
| R3 | P1 | `requireAffiliateWithOnboarding()` has **zero callers** — onboarding never enforced; `getOnboardingStatus` also dead; onboarding APPROVED gates nothing (payouts included) **[dup: O6]** | `affiliate-session.ts:39-68`; grep |
| R4 | P1 | `/api/affiliate/register`: **no rate limiting** on an unauthenticated route calling service-role `createUser` + sending email; proxy CSRF-exempts it under a rationale ("protected by session auth") that doesn't apply; 409 enables email enumeration | `register/route.ts:66-244`; `proxy.ts:302-313` |
| R5 | P2 | `getRequestAffiliate` uses a no-op `setAll` → rotated Supabase cookies dropped → mid-session 401s; the buyer helper documents and fixes exactly this | `affiliate-api.ts:17` vs `lib/auth/api.ts:36-67` |
| R6 | P2 | Model contradiction: register auto-creates `ACTIVE` (comment: on email verification) while success copy promises a 2-day human review; sign-in blocks `PENDING` ("under review") though `requireAffiliate` permits it — PENDING affiliates (safety-net-provisioned) are fully locked out **[dup: O10]** | `register/route.ts:173`; `register/page.tsx:159`; `actions.ts:372-397,174-190` |
| R7 | P1 | REJECTED affiliates redirected to `/affiliate/unsubscribed?reason=rejected`, which renders the **digest-unsubscribe card** ("You won't receive the weekly digest") + a "Back to dashboard" link that bounces straight back **[dup: O1]** | `affiliate-session.ts:32-34`; `unsubscribed/page.tsx:10,35-55,67` |
| R8 | P3 | Portal layout REJECTED-may-view-dashboard branch is unreachable (requireAffiliate already redirected) — two files encode contradictory products | `portal/layout.tsx:19-27` |
| R9 | P2 | Proxy CSRF comment claims Supabase cookies are HttpOnly; `@supabase/ssr@0.6.1` default is `httpOnly:false` (SameSite=Lax does the real work) | `proxy.ts:304-305`; `node_modules/@supabase/ssr/dist/main/utils/constants.js:4-11` |
| R10 | P2 | Register page never transmits `referralCode` (no `?ref` read, no `affiliate_ref` read, no field) → `parentId` never set self-serve; `level: parentId ? 2 : 1` hardcodes 2 (not `parent.level+1`) **[dup: O7]** | `register/page.tsx:111-124`; `register/route.ts:37,93-100,174` |
| R11 | P3 | Client validation says 8-char password; server requires 12 + classes | `register/page.tsx:93` vs `register/route.ts:26-32` |
| R12 | P3 | Onboarding page self-redirects (`?step=1` → same URL) when `ensureOnboardingRecord` returns null (unmigrated-DB fallback) → redirect loop in exactly the environment the fallback was written for **[dup: O13]** | `onboarding.service.ts:15-25`; `onboarding/page.tsx:20-22` |
| R13 | P3 | Sign-out lands affiliates on buyer `/auth/signin`; signed-in affiliates visiting `/affiliate/signin` get the form (no authenticated bounce); no remember-me on affiliate sign-in | `AffiliateSidebar.tsx:63`; `actions.ts:419`; `proxy.ts:139-145,598` |
| R14 | P3 | Suspended/rejected get 401 "Not authenticated" from all APIs (technically misleading; matches buyer convention; page nav shows the friendly notice first) — judged acceptable, optional 403 | `affiliate-api.ts:29-31` |

### Onboarding (O) — beyond R-series dups

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| O2 | P1 | Email-verification dead end: `generateLink` failure swallowed → email tells user to find a "separate Supabase email" that **does not exist** (`email_confirm:false` sends none); sign-in then renders the literal string `verify_required`; no affiliate-reachable resend (existing resend route is buyer-branded) | `register/route.ts:102-104,134-150`; `resend.service.ts:991-1006`; `AffiliateSignInClient.tsx:49-51`; `actions.ts:359-362` |
| O3 | P2 | Onboarding transitions unguarded + non-transactional: any step POST resets SUBMITTED/APPROVED → IN_PROGRESS; re-POST of submit flips APPROVED → SUBMITTED (erases admin decision); admin review can approve a never-started onboarding; nonexistent affiliateId → unhandled FK 500 | `onboarding.service.ts:27-41`; `submit/route.ts:28`; `review/route.ts:50-67` |
| O4 | P2 | `correctionItems`/`decisionNote` collected but **never rendered** — NEEDS_CORRECTION affiliate sees a blank wizard at step 1 with no guidance | `review/route.ts:56,63`; `OnboardingWizard.tsx:23-25,110` |
| O5 | P2 | Post-submit UI says "Onboarding Complete! Your account is active" for SUBMITTED/UNDER_REVIEW too; no pending/rejected/needs-correction rendering **[dup: U7]** | `OnboardingWizard.tsx:110,250-268` |
| O8 | P2 | Orphaned Supabase user (crash between createUser and Prisma tx, or failed rollback) makes the email permanently unusable: register → EMAIL_EXISTS, sign-in → invalid credentials; no reconciliation | `register/route.ts:84,106,122-128,186-188` (occurrence ASSUMPTION) |
| O9 | P3 | Referral-code generation check-then-insert (unique constraint makes it safe; collision = 500, no P2002 retry) | `register/route.ts:49-56` |
| O11 | P3 | Two divergent document-upload routes (types + MIME allowlists differ) | `api/affiliate/documents/upload` vs `…/onboarding/documents/upload` |
| O12 | P3 | Tax-classification vocabulary drift: finance route writes `"INDIVIDUAL"\|"LLC"\|…`, wizard sends `"individual"\|"llc_single"\|…` into the same column | `finance/tax-info/route.ts:12`; `OnboardingWizard.tsx:444-449`; `tax/route.ts:10` |
| O14 | P3 | Admin-typed rejection reason interpolated unescaped into email HTML (admin-only input, low risk) | `resend.service.ts:1077` |
| O15 | P3 | Wizard step 6 satisfied by any doc type; server submit requires GOVERNMENT_ID → confusing late failure | `OnboardingWizard.tsx:150,560-566`; `onboarding.service.ts:98` |
| O16 | P3 | Admin role granularity: onboarding review restricted to 3 roles; account approve/reject accept any MFA'd admin | `review/route.ts:35-37` vs `approve/route.ts:26-27` |
| O17 | P3 | Dead code inventory: `registerAffiliate`/`activateAffiliate`/`getAffiliateWithStats` (JS money reduction + unsafe code generator), `getOnboardingStatus`, `requireAffiliateWithOnboarding`, `PayoutRequestButton`, `OnboardingStatus.UNDER_REVIEW` never written, layout REJECTED branch | grep-verified |

### Data layer (D) — beyond dups (D4=M7, D5=M1, D18=M15, D19=M10)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| D1 | P1 | `commissions`: no index on `affiliate_id`/`status` — every summary/dashboard/cron/leaderboard read is a full scan (physically confirmed live) | `schema.prisma:875`; pg_indexes |
| D2 | P1 | Migration-built `affiliate_documents` **cannot accept the app's inserts**: baseline migration adds `document_type text NOT NULL` (not in Prisma), nullable `type`/`file_name` (Prisma required), `bigint` vs `Int` → NOT NULL violation on every upload in a chain-provisioned DB (production manually aligned: ASSUMPTION) | `20260423999999_baseline…/migration.sql:70-88` |
| D3 | P1 | **Zero RLS** statements for all 16 affiliate tables in the migration chain (other tables got the 20260918 treatment); moot on production *if* out-of-band enable happened; any chain-provisioned env exposes PII/financial tables via anon PostgREST | migration grep |
| D6 | P2 | `AffiliateReferral` unique is per `(affiliateId, referredUserId)` pair — one user can hold rows under two affiliates; `processFeeCommission` resolves with `findFirst` **no orderBy** → nondeterministic payee | `schema.prisma:3041`; `commission.service.ts:117-121` |
| D7 | P2 | `Buyer.affiliateId`: no index, no FK; inactive-cron does per-affiliate `findFirst` in a ≤500 loop → up to 500 sequential scans | `cron/affiliate-inactive/route.ts:56-60` |
| D8 | P2 | `affiliates.parent_id`: FK but no index (network/digest/leaderboard/referrals paths) | `schema.prisma:231-262` |
| D9 | P2 | `affiliate_referrals.referred_user_id` unservable by the composite unique — **Stripe webhook hot path** does an unindexed lookup | `commission.service.ts:117` |
| D10 | P2 | Admin list `earningsTier` filter applied **after** skip/take → broken pagination and `total` | `admin-affiliate-command-center.service.ts:186,298-302` |
| D11 | P2 | `analytics.getAffiliateMetrics` loads every affiliate with **all** commission rows + the whole `affiliateReferral` table into JS and reduces money client-side | `analytics.service.ts:477-521` |
| D12 | P2 | `AffiliateReferral.firstDealAt`/`totalDeals` never written → conversion metrics permanently zero; two conversion definitions coexist | grep; `analytics.service.ts:498-500` |
| D13 | P2 | Money-mutation audit logs swallowed (`.catch(() => {})`) or non-atomic; commissions carry no `approvedAt/By`/`reversedAt` — the audit log is the only record and it can silently fail | `approve/route.ts:41-47`, `reject`, `mark-paid:67-80`, `reverse:45-67` |
| D14 | P2 | Digest/inactive crons: `take: 500`, no orderBy, no cursor/watermark filter in SQL → >500 affiliates = arbitrary subset served weekly | `digest.service.ts:151-156`; `cron/affiliate-inactive/route.ts:27-36` |
| D15 | P3 | `affiliate_payouts.affiliate_id` unindexed; payout-per-commission design scales the table; `getPayoutHistory` unbounded | `affiliate-payout.service.ts:56-66,113` |
| D16 | P3 | Six affiliate columns with no FK (AffiliateReferral both ids, ComplianceRecord, TierHistory, PayoutSchedule, ReferralMilestone.buyerId, Commission.dealId, Buyer.affiliateId); buyer hard-delete leaves dangling referrals that still count toward milestones | schema + `admin-buyer-command-center.service.ts:1213` |
| D17 | P3 | Dead tables/exports (see M12/O17); `getNetworkTree` is a callable unbounded recursive N+1 | `affiliate-network.service.ts` |
| D20 | P3 | `commissions.payout_id` FK is ON DELETE **SET NULL** — a payout delete would fabricate the exact corruption `isCommissionSettled` defines (no delete path exists today) | `20260919000002…/migration.sql:29-35` |
| D21 | P3 | `Commission.rate` Float (money itself Int; audit-reproduction imprecision only) | `schema.prisma:856` |
| D22 | P3 | Leaderboard exposes real affiliate UUIDs + exact cents to any active affiliate; downline emails masked as 2 chars + **full domain** | `affiliate-leaderboard.service.ts:70-83`; `network/route.ts:24-27` |

### UI / design (U)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| U1 | P1 | Finance Hub fabricates $0 balances on data failure — all five reads `.catch(() => zeros)`; invites re-entry of banking/tax data | `finance/page.tsx:25-43` |
| U2 | P1 | Notifications: fetch failure renders "No notifications yet"; markRead/markAllRead failures silent | `notifications/page.tsx:29,40,50` |
| U3 | P1 | Settings: load failure renders hardcoded defaults the user can then "save" over real prefs; save failure completely silent | `settings/page.tsx:29-34,42` |
| U4 | P1 | Contrast: `text-slate-300` body copy (~1.9:1), pervasive `text-slate-400` 12px copy (~3.0:1) vs the skill's 4.8:1 floor; `text-white/40` disclaimers | `leaderboard/page.tsx:178`; `earnings/page.tsx:54`; `income-calculator/page.tsx:241` |
| U5 | P1 | Entry-form focus rings ~invisible (`ring-al-primary/10`); shared `components/ui/input.tsx:9` does it right — pages hand-roll | `register/page.tsx:252-295`; `AffiliateSignInClient.tsx:145,172` |
| U6 | P2 | Wizard step-6 upload: raw fetch, `try/finally` no catch → rejection shows nothing | `OnboardingWizard.tsx:208-235` |
| U8 | P2 | Form labels not associated (`htmlFor`/`id` absent on register + all ~25 wizard fields); no `aria-describedby`/`aria-invalid`; repo has the correct pattern in `AffiliatePayoutMethodForm.tsx:78-96` | `register/page.tsx:250-296`; `OnboardingWizard.tsx:79-94` |
| U9 | P2 | Icon-only buttons unnamed: password toggle, referral-link copy (sibling `ReferralCodeCard.tsx:77-83` does it right) | `AffiliateSignInClient.tsx:174-181`; `ReferralHubClient.tsx:141-145` |
| U10 | P2 | `grid-cols-3` stat rows clip at 375px (earnings, network); network tree indents ~120px before L3 content; dashboard's `grid-cols-2 sm:grid-cols-4` is the in-repo fix pattern | `earnings/page.tsx:41`; `network/page.tsx:48,86-111` |
| U11 | P2 | Entry pages + layout use a parallel hardcoded-hex language incl. the exact drift shades the design-system skill kills (`#50D14E`, `#F8F9FB`, layout `bg-[#F8F9FA]`, `#059669` twice) | `register/page.tsx:40-296`; `portal/layout.tsx:30`; `PayoutRequestButton.tsx:43-46` |
| U12 | P2 | `PayoutRequestButton` orphaned (imported nowhere); if rewired as-is: POST with no confirmation, no amount, red-300 error text on light bg **[dup: O17]** | grep; `PayoutRequestButton.tsx` |
| U13 | P2 | Register custom validation unreachable: native `required` + no `noValidate` → mixed native/styled error model | `register/page.tsx:251-296` |
| U14 | P3 | Client/server hygiene: notifications + settings wholly client-fetched vs RSC siblings; register does client-side session redirect (flash); dashboard greeting uses server TZ | cited in audit |
| U15 | P3 | Terminology drift: "Income Calculator/Planner", "Network Tree"/"My Referral Network", Earnings-vs-Finance tile semantics ("Pending" vs "Approved (payable)") | `AffiliateSidebar.tsx:22-24` etc. |
| U16 | P3 | Empty states without CTA (earnings, referrals, network say "share your link", no link); REJECTED banner gives no reason/appeal; dashboard EmptyState is the correct pattern | `earnings/page.tsx:88-90` etc. |
| U17 | P3 | Polish: "real time" overclaim, ~imperceptible `/2`/`/3` tints, settings toggle dead classes vs inline styles, chevron `aria-hidden`, wizard buttons off-kit | cited in audit |

**Also correct (kept as-is, evidence in audits):** settlement CAS core; commission idempotency +
DLQ replay; webhook signature + event dedup; integer-cents math with explicit `Math.round`;
admin money-route hard role gates + tests; cron auth fail-closed; self-referral guard;
tax/banking last4-only; document scoping; noindex; segment loading/error boundaries;
`documents/` page four-state pattern; dashboard page as reference implementation; sidebar
mobile drawer a11y; all 14 nav items resolve; onboarding server-side completeness check;
H-6 banking unification + its test.

---

## 4. Decisions (owner-approved 2026-08-29, with amendments applied)

1. **Activation model — keep auto-ACTIVE on email verification** (owner-accepted). Fix the
   register success copy; sign-in permits PENDING. The real sybil control sits at the payout
   boundary, so **register rate limiting is in scope** (Phase 3), not deferred.
   **What the admin review surface means under auto-ACTIVE:** account-level approve/reject
   (`Affiliate.status`) is **not decorative** — it is the kill switch: reject/suspend revokes
   portal + API access (`requireAffiliate`/`getRequestAffiliate` enforce it server-side) at any
   time after auto-activation; "approve" on an already-ACTIVE affiliate is a no-op rail kept for
   safety-net-provisioned PENDING accounts. `AffiliateOnboardingReview` is a **second, distinct
   gate**: after this plan it gates exactly two things — the gated portal surfaces (decision 2)
   and payout eligibility (decision 3). It never grants or revokes login. The PR restates this
   so neither rail is mistaken for the other.
2. **Onboarding gate — wire `requireAffiliateWithOnboarding` into the portal layout.**
   **Live population check (owner-required, VERIFIED 2026-08-29):** 2 affiliates, both ACTIVE —
   one with onboarding `IN_PROGRESS`, one with **no review row at all**. The gate as written
   blocks only `NOT_STARTED`; a missing review row must resolve to the same treatment as
   `NOT_STARTED` (it is created on first wizard visit), so the no-row affiliate WILL be
   redirected from gated pages to the wizard once the gate ships — that is the intended launch
   behavior, affects exactly 1 existing account, and walls them out of nothing exempt. Neither
   existing affiliate loses dashboard/notifications/profile/settings/compliance access.
   **Exempt-set reconciliation (owner-required):** final set = the existing list in
   `affiliate-session.ts:53-58` (`onboarding`, `profile`, `settings`, `compliance`) **∪**
   {`dashboard`, `notifications`, `resources`}. Gated: earnings, finance, payouts(redirect),
   referrals, referral-hub, network, leaderboard, documents, income-calculator. A unit test
   proves: every portal route is either exempt or gated (no unreachable page), the gate's
   redirect target is exempt (no loop), and specifically a `NOT_STARTED` affiliate reaches
   `/affiliate/portal/compliance`. Payout eligibility additionally requires onboarding
   **APPROVED** + payout method.
3. **Payout request rail — rebuild, not re-enable — moved to Phase 6** (owner reorder: it is the
   only net-new capability, has zero live data, and is downstream of a funnel that cannot yet
   produce a commission). `requestPayout`: one `$transaction` that CAS-claims the affiliate's
   APPROVED commissions (`updateMany where status:"APPROVED", payoutId:null` → attach to a new
   `AffiliatePayout` in the currently-unreachable `PayoutStatus.PENDING` state — no new enum
   value, no schema change). Minimum threshold is a config constant
   (`AFFILIATE_PAYOUT_MINIMUM_CENTS = 2500` in `lib/constants.ts`), never a literal. Requires
   onboarding APPROVED + payout method. Admin settles via the existing mark-paid CAS pattern.
   Real money movement stays out (recorded-only settlement, existing TODO stands).
4. **Clawback semantics — one shared aggregation** (owner-approved as written). New
   `commissionLedgerTotals()` in `commission.service.ts`: `earned = SUM(amountCents) WHERE
   status IN (PENDING, APPROVED, PAID) + SUM(amountCents) WHERE status = REVERSED AND
   amountCents < 0`. In-place-reversed positive rows stay excluded; clawback offsets net out.
   All five consumers (summary, leaderboard SQL, digest, referrals page, admin) switch to it.
5. **Refunds → commissions** (owner-approved with reachability amendment). `charge.refunded` fee
   branch flips PENDING/APPROVED commissions matching the PI prefix to REVERSED (CAS); PAID →
   ops alert, never silent auto-clawback. **Reachability: the webhook path has never recorded a
   production event (M16), so this handler is inert in production until webhook delivery is
   fixed (owner/infra action — Stripe dashboard endpoint config, unverifiable from the repo).
   The PR labels it UNVERIFIED (production reachability), not FIXED.** The auto-approve cron
   stops approving on age alone: before approving, it reads the underlying payment state — the
   local refund records for the fee PI (`refund.service` writes) AND the linked deal's status —
   and skips any commission whose payment is refunded/disputed or whose deal is
   CANCELLED/REFUNDED. Because webhook-driven refund events may never arrive (M16), the cron's
   payment-state read is the effective production guard.
6. **Migration SQL split in two owner-gated files** (owner amendment), both under
   `frontend/prisma/migrations/` as chain migrations AND mirrored as standalone annotated files
   in `docs/plans/sql/` for manual owner application:
   - **001_affiliate_correctness.sql** — `affiliate_documents` drift fix, `commissions`
     indexes + `approved_at/approved_by/reversed_at`, `buyers(affiliate_id)`,
     `affiliates(parent_id)`, `affiliate_referrals(referred_user_id)` index + UNIQUE,
     `affiliate_payouts(affiliate_id)`, orphaned `affiliates."lastInactiveNudgeAt"` drop,
     `payout_id` FK → RESTRICT. **Every statement is followed by a verification query.**
   - **002_affiliate_rls.sql** — RLS enable deny-all on the 16 affiliate tables, separately
     applyable, each with a verification query.
   **Production-impact statement (owner-required):** until 001 applies, **BROKEN IN PRODUCTION:**
   document upload only if the production table carries the drifted baseline shape — live
   `information_schema` shows production does NOT have the drifted `document_type` column, so on
   production 001's drift section is a no-op guard and the breakage is confined to
   chain-provisioned environments; the index/uniqueness/stamp sections are performance +
   integrity hardening on production. 002 is **hardening only**: no affiliate path uses the anon
   key (verified, §1) — it protects chain-provisioned environments and any future anon usage.
7. **Deferred entirely** (§7): Stripe Connect payouts; AffiliateTier implementation or drop;
   milestone ledger; leaderboard masking redesign; visual-suite authenticated tier; O8 orphan
   reconciliation job (detection message only); O16 role uniformity; R14 401→403; U14
   client→RSC restructures; remember-me; visitor-scoped click conversion; broader FK program
   (D16 beyond what 001 carries).

## 4b. Up-front triage — FIX vs DEFER for every finding (owner criteria)

FIX only if: **money path** · **blocking a flow** · **security boundary** · **user-visible dead
end** · **one-line change**. Everything else defers with a reason. The UI phase is bounded to
four-state completeness, 375px/1280px responsiveness, and a11y — reusing the existing design
system; it is not a redesign.

| Disposition | Findings | Criterion |
|---|---|---|
| **FIX** | M1–M8, M10, M11, M15, M16(code side) | money path |
| **FIX (partial)** | M9 (evaluation trigger + pay CAS; ledger deferred), M12 (remove the false "next payout" display; tier schema deferred), M13 (rate limit + salt warning; visitor-scoping deferred), M14 (skip SUSPENDED/REJECTED in the walk + write `Buyer.affiliateId`; broader policy deferred) | money path / security |
| **FIX** | R1, R7, R12 (dead ends) · R3 (blocking gate) · R4 (security) · R5 (blocking — mid-session 401s) · R6, R10 (blocking flows) · R2, R8, R9, R11 (one-liners) · R13 (sign-out target + signin bounce only) | as noted |
| **FIX** | O2 (blocking) · O3 (security boundary) · O4, O5, O15 (dead ends / user-visible) · O9, O14 (one-liners) · O11, O12 (validation consistency on a security-adjacent path) · O17 (dead code removal) · O8 (detection message only) | as noted |
| **FIX** | D1, D6, D9 (money path) · D2 (blocking flow in chain envs) · D3 (security hardening, 002) · D7, D8, D15, D20 (001 migration lines) · D10, D11, D12, D13 (money correctness) · D14 (blocking at scale) · D17 (dead code) | as noted |
| **FIX** | U1–U3, U6 (error states) · U4, U5, U8, U9 (a11y) · U10 (375px) · U11 (token reuse — bounded swap, no redesign) · U12 (delete) · U13 (small) · U16 (dead-end empty states) · U15/U17 (only the one-line items: nav labels, `aria-hidden`, dead classes, "real time" copy) | bounded UI phase |
| **DEFER** | R14 (matches buyer convention) · O16 (cross-portal convention) · D16 broader FKs (needs an orphan policy) · D21 (no money impact) · D22 (by-design ambiguity, owner call) · U14 (restructure, not states/responsive/a11y) · M9-ledger, M12-tier, M13-visitor-scoping, M14-policy (above) · everything in §7 | outside criteria |

## 5. Execution phases and tasks

Order (owner-set): **money correctness → attribution → routing/auth → onboarding → data layer →
payout rail → UI → dead code → E2E → gates/review/PR.** Everything blocking a first commission
lands before the rail, which is the only net-new capability. **Every task:** (1) re-read the cited files and confirm the finding still
holds; (2) failing test first (`tsx --test` conventions of the sibling tests in
`lib/services/affiliate/__tests__/`); (3) minimal fix; (4) suite green; (5) commit with a
conventional message naming the finding ID. Commits are per-task.

### Phase 0 — Baseline (no fixes)

- [x] **T0.1** Run `npm run typecheck && npm run lint && npm test` from `frontend/`; record
  results in the working notes. A pre-existing red is reported, not silently fixed.

### Phase 1 — Money correctness

- [x] **T1.1 (M1/D5)** `commissionLedgerTotals` shared helper + clawback-aware aggregation.
  Test first: `__tests__/commission-ledger-totals.test.ts` — seed PAID 6000 + REVERSED −6000
  offset (clawback shape) + in-place REVERSED +5000 → `earnedCents` 0 from the first pair,
  excludes the third. Then implement in `commission.service.ts`; switch `getCommissionSummary`,
  leaderboard SQL `FILTER`, `digest.service.ts:104-108`, `referrals/page.tsx:36`, and the admin
  netting to it. Regression: existing `commission-basis`/`commission-durability` stay green.
- [x] **T1.2 (M2/M16)** Refund wiring + cron gating. Tests: reversal on `charge.refunded` for
  PENDING/APPROVED via CAS `updateMany({ where: { qualifyingEventId: { startsWith: pi.id },
  status: { in: ["PENDING","APPROVED"] } } })`; PAID → ops notification, untouched. The cron
  reads **underlying payment state, not age alone**: skip any commission whose fee PI has a
  local refund/dispute record or whose linked deal is CANCELLED/REFUNDED (test both skip
  reasons + the approve case). Reachability: the webhook handler is inert in production (M16,
  §1) — PR labels it UNVERIFIED (production reachability); the cron's payment-state read is
  documented as the effective production guard. Files: `app/api/webhooks/stripe/route.ts`
  (fee-refund branch), `app/api/cron/affiliates/route.ts`, logic in `commission.service.ts`
  (`reverseCommissionsForPaymentIntent`).
- [x] **T1.3 (M3)** Legacy fee path: derive `buyerId` from `feeDeal.buyerId` when metadata absent;
  always attempt the walk; DLQ on failure (existing `autolenis/affiliate.commission_walk` topic).
  Test: webhook fixture without metadata still creates commissions.
- [x] **T1.4 (M4)** Basis: fallback `PREMIUM_FEE_CENTS` → `PREMIUM_FEE_REMAINING_CENTS`; buyer
  advertised amount computed from the same constant. Test asserts 6000¢ both places.
- [x] **T1.5 (M5)** Admin approve/reject/reverse → CAS `updateMany({ where: { id, status:
  expected } })`, 409 on count 0, REVERSED only from PENDING/APPROVED (REJECTED excluded), matching
  the settlement pattern. Extend `commission-authz-route.test.ts` siblings.
- [x] **T1.6 (D13)** Wrap each admin money mutation + its audit `create` in one `$transaction`;
  remove `.catch(() => {})`. The `approvedAt`/`approvedBy`/`reversedAt` stamp columns are added
  to schema.prisma and to the Phase-6 owner-gated migration, and the code that writes them lands
  in the same branch — the PR flags the coupling explicitly: **deploying this code before
  applying the migration would fail**, so migration application precedes deploy (owner step).
- [x] **T1.7 (M10/D19)** Manual commission idempotency: require a client `idempotencyKey`
  (zod), `qualifyingEventId = admin-manual-${affiliateId}-${dealId}-${idempotencyKey}`; set
  `basisCents`. Test: same key twice → one row + 409/no-op.
- [x] **T1.8 (M8)** One buyer-surface definition: `buyer/referral.service.ts` counts
  `AffiliateReferral` (never `children`) and uses `commissionLedgerTotals`. Test pins it.
- [x] **T1.9 (M15/D18)** Earnings level bars via `commission.groupBy(["level"], { _sum })` —
  drop the `take: 50` reduction. (UI file change; test in service if extracted, else covered by
  E2E render assertion.)
- [x] **T1.10 (M11)** Call `isCommissionSettled` as a post-settle assertion inside
  `settleApprovedCommission`'s transaction (throw → rollback). Test: corrupted shape rolls back.
- [x] **T1.11 (M9, partial)** Evaluate milestones from `recordAffiliateAttribution` (after upsert)
  instead of only the buyer page view; pay route → CAS `updateMany({ where: { id, paidAt:
  null } })`. Milestone *ledger* stays deferred (§7).
- [x] **T1.12 (M13, partial)** Rate-limit `/api/public/referral/track` with the existing limiter
  used by auth actions; keep salt fallback but log a warning when `REFERRAL_IP_SALT` unset.
  Visitor-scoped conversion linking deferred (stats-only impact).
- [x] **T1.13 (M14, partial)** `walkCommissionTree` skips SUSPENDED/REJECTED affiliates at every
  level (their level's commission is not created; other levels unaffected). Test: suspended L1
  parent earns nothing, L2 grandparent still earns. (`Buyer.affiliateId` write lands in T2.4.)

### Phase 2 — Attribution integrity

- [x] **T2.1 (M6)** Call `recordAffiliateAttribution` from both `ensurePrismaUser` provisioning
  call sites (`signInAction`, `acceptTermsAction`) when `user_metadata.referralCode` exists.
  Test: provisioning path creates the `AffiliateReferral`.
- [x] **T2.2 (M6)** Server-side cookie fallback: `signUpAction` reads `affiliate_ref` from
  `cookies()` when the form field is empty. Add `secure: true` to the cookie in `proxy.ts`.
- [x] **T2.3 (D6)** Deterministic payee: `processFeeCommission` orders by `signedUpAt asc`
  (first-touch). UNIQUE(referred_user_id) migration SQL in Phase 6 (0 rows live → safe).
- [x] **T2.4 (D12/M14)** Stamp `firstDealAt` (once) and increment `totalDeals` inside
  `processFeeCommission`'s transaction; also write `Buyer.affiliateId` on attribution so the
  inactive-cron's buyer signal works. Tests for both.
- [x] **T2.5 (R10/O7)** Register page reads `?ref` + `affiliate_ref` cookie into a visible,
  editable "Referral code (optional)" field and POSTs it; API sets `level: parent.level + 1`
  (cap at 3). Failing test on the route level math first.
- [x] **T2.6 (owner-required) Full-chain attribution test.** One test,
  `__tests__/attribution-chain.test.ts`, that walks the COMPLETE chain in a single execution:
  simulated `?ref=` visit (proxy cookie semantics) → `affiliate_ref` value → buyer signup path
  (`signUpAction` server-side fallback from T2.2) → `recordAffiliateAttribution` →
  `AffiliateReferral` row asserted → fee-payment conversion (`processFeeCommission` with the
  referral in place) → `Commission` rows asserted at every level with correct basis and payee.
  This test must FAIL before T2.1–T2.5 land (proving the chain is dead and where — write it
  first, record which link breaks it) and pass after. Five isolated unit tests do not satisfy
  this task: the deliverable is one execution crossing every link, because 5 clicks → 0
  referrals in production is consistent with more than one break; this proves every break found
  is closed.

### Phase 3 — Routing & auth

- [x] **T3.1 (R1)** `proxy.ts` step 10: exact `/affiliate/portal` (and trailing-slash) →
  redirect `/affiliate/portal/dashboard`. E2E asserts 200 chain later.
- [x] **T3.2 (R4, owner-required in scope)** `limitAuthAttempt`-style IP+email throttle on
  register (reuse the existing limiter from `actions.ts:341-348`); correct the proxy CSRF
  comment (R9) — no behavior change to CSRF policy itself; neutralize enumeration by returning
  the same success envelope for existing emails (send "you already have an account" email
  instead — matches buyer forgot-password convention if present; if not, keep 409 but
  rate-limited, and say so in the PR).
- [x] **T3.3 (R5)** Port the buyer `setAll` cookie-forwarding into `affiliate-api.ts` verbatim
  (attributed comment). Test mirrors the buyer helper's test if one exists; else unit-test the
  handler wiring.
- [x] **T3.4 (R6/O10)** Align activation model (decision 1): fix register success copy; sign-in
  permits PENDING (drops the "under review" hard block; keeps SUSPENDED/REJECTED handling);
  safety-net provisioning unchanged.
- [x] **T3.5 (R7/O1 + R8)** `unsubscribed/page.tsx`: proper `reason === "rejected"` card (what
  happened, the emailed reason exists, support contact, no dashboard link); delete the dead
  layout REJECTED branch (`portal/layout.tsx:19-27`).
- [x] **T3.6 (O2)** Verification recovery: map `verify_required` to human copy + a resend action
  on the affiliate sign-in client; extend the existing resend-verification route to accept
  affiliates (branch on role, affiliate email template) — no second route. Register fails loudly
  (VERIFICATION_UNAVAILABLE) when `generateLink` fails instead of sending a dead-end email.
- [x] **T3.7 (R12/O13)** Onboarding degraded state renders an error panel instead of
  self-redirect; `affiliate-session.ts:46-49` same fix when the gate goes live.
- [x] **T3.8 (R13)** Sign-out: role-aware redirect (affiliates → `/affiliate/signin`);
  authenticated visitors to `/affiliate/signin` bounce to the dashboard (server-side, mirroring
  step-9's AUTH_ROUTES pattern or an in-page server check). Remember-me deferred.
- [x] **T3.9 (R11/U13)** Register client validation = server zod rules (12 chars + classes);
  `noValidate` on the form so the styled error path owns validation.

### Phase 4 — Onboarding integrity

- [x] **T4.1 (O3)** Transition guards in `saveOnboardingStep` + `submit`: step writes rejected
  (409) when status ∈ {SUBMITTED, APPROVED, REJECTED} unless NEEDS_CORRECTION; submit only from
  IN_PROGRESS/NEEDS_CORRECTION; all data+status writes in one `$transaction`; admin review 404s
  a nonexistent affiliate and requires an existing review row (no approve-from-nothing). Failing
  tests per illegal transition.
- [x] **T4.2 (O4/O5/U7)** Wizard status rendering: NEEDS_CORRECTION banner listing
  `correctionItems` + `decisionNote`; SUBMITTED/UNDER_REVIEW → "submitted, under review" card;
  APPROVED → the existing success card; REJECTED → explanation card. Props already typed.
- [x] **T4.3 (R3, decision 2 with owner amendments)** Wire `requireAffiliateWithOnboarding` into
  `portal/layout.tsx` with the **reconciled** exempt set (existing four: onboarding, profile,
  settings, compliance ∪ dashboard, notifications, resources); a missing review row is treated
  exactly as NOT_STARTED. Required tests (owner-mandated): every portal route is either exempt
  or gated (enumerated against the filesystem routes — no unreachable page); the gate's redirect
  target is in the exempt set (no loop); a NOT_STARTED affiliate **reaches
  `/affiliate/portal/compliance`**; a NOT_STARTED affiliate hitting a gated page lands on the
  wizard. Pages drop their duplicate `requireAffiliate` only where the layout guarantees it;
  nav gating in `AffiliateSidebar` mirrors the gate (locked items with lock icon + tooltip,
  matching the buyer sidebar's gating pattern if present). Live-population impact (§4 decision
  2): exactly 1 existing affiliate (no review row) becomes wizard-gated on gated pages — stated
  in the PR.
- [x] **T4.4 (O15/U6)** Step 6 gates on a GOVERNMENT_ID upload specifically; upload path wrapped
  in try/catch with `apiErrorMessage` surfacing.
- [x] **T4.5 (O11/O12)** One upload service consumed by both routes (union of type allowlists,
  identical MIME rules); one tax-classification vocabulary (finance enum wins; wizard maps its
  labels onto it; migration-free — column is text).
- [x] **T4.6 (O9/O14/O8)** P2002 retry on referral-code create; escape admin reason/note in email
  HTML (`escapeHtml` helper already in repo — grep, reuse); register EMAIL_EXISTS branch
  distinguishes the Supabase-orphan case (Supabase user exists, no Prisma user) and returns a
  distinct message telling the user to contact support (reconciliation job deferred).

### Phase 5 — Data layer

- [x] **T5.1 (001_affiliate_correctness — D1/D2/D6/D7/D8/D9/D15/D20 + dup column + audit
  stamps)** Chain migration `frontend/prisma/migrations/<ts>_affiliate_correctness/migration.sql`
  + annotated mirror `docs/plans/sql/001_affiliate_correctness.sql` for manual owner
  application. Contents: `affiliate_documents` drift fix (guarded: drop `document_type`, align
  nullability, `bigint`→`integer`, rename indexes to Prisma names); `CREATE INDEX` on
  `commissions(affiliate_id, status)`, `commissions(status, created_at)`, `buyers(affiliate_id)`,
  `affiliates(parent_id)`, `affiliate_referrals(referred_user_id)` + UNIQUE (live table has 0
  rows — safe), `affiliate_payouts(affiliate_id)`; drop orphaned
  `affiliates."lastInactiveNudgeAt"`; `commissions` `approved_at`/`approved_by`/`reversed_at`;
  `payout_id` FK → RESTRICT. Idempotent (`IF NOT EXISTS` / guarded DO blocks). **Every
  statement is followed by a commented verification query** (owner-required). schema.prisma
  updated to match. **NOT applied to production — owner-gated.** Production-impact statement
  per §4 decision 6 goes in the PR verbatim. `npm run test:migrations` (chain-from-zero) must
  pass.
- [x] **T5.2 (002_affiliate_rls — D3)** Separate chain migration + annotated mirror
  `docs/plans/sql/002_affiliate_rls.sql`, separately applyable: RLS enable deny-all on the 16
  affiliate tables, following `20260918000000_enable_rls_manual_tables` exactly, each statement
  with a verification query. Hardening-only on production (anon-key check, §1) — stated in the
  PR. Owner-gated likewise.
- [x] **T5.3 (M7/D4)** Drop the `commissions` include + slim `user` select in
  `getAuthenticatedAffiliate`; keep `children: { take: 1 }` only if a consumer needs it (grep;
  none found → drop). Typecheck catches any hidden consumer.
- [x] **T5.4 (D10)** Admin `earningsTier` filter moves before pagination (tier derived from the
  commission `groupBy` already computed); `total` reflects the filtered set. Test with 2 pages.
- [x] **T5.5 (D11)** `getAffiliateMetrics` → `commission.groupBy` + `affiliateReferral.groupBy`;
  no row loading. Numbers pinned by test.
- [x] **T5.6 (D14)** Digest + inactive crons: eligibility in SQL (`lastDigestSentAt < weekStart
  OR NULL`, etc.), `orderBy: { id: "asc" }`, cursor loop. Test the watermark filter.
- [x] **T5.7 (D15)** `getPayoutHistory` paginated (`take: 50` default + cursor param); API +
  finance page consume it.

### Phase 6 — Payout request rail (per decision 3; owner-moved after the funnel fixes)

- [x] **T6.1** `AFFILIATE_PAYOUT_MINIMUM_CENTS = 2500` added to `lib/constants.ts` (config
  constant, never a literal — owner-required). `requestPayout` in
  `affiliate-payout.service.ts`: single `$transaction` — eligibility (onboarding APPROVED via
  `AffiliateOnboardingReview`, payout method exists, sum(APPROVED, payoutId:null) ≥
  `AFFILIATE_PAYOUT_MINIMUM_CENTS`) → create `AffiliatePayout` status `PENDING` → CAS-attach
  commissions (`updateMany where affiliateId, status:"APPROVED", payoutId:null → { payoutId }`;
  count must equal the pre-read set or rollback). Commissions stay APPROVED until settlement.
  Tests: happy path; below-threshold rejection; no-method rejection; onboarding-not-approved
  rejection; **two concurrent requests cannot claim the same commission** (CAS count mismatch →
  rollback).
- [x] **T6.2** `/api/affiliate/payouts/request` replaces the 503 stub: zod body (optional note),
  auth via `getRequestAffiliate`, service call, typed errors (`BELOW_MINIMUM`,
  `NO_PAYOUT_METHOD`, `ONBOARDING_REQUIRED`, `NOTHING_TO_PAY`).
- [x] **T6.3** Admin settlement of a requested payout: extend mark-paid to accept an
  `AffiliatePayout` in PENDING → one transaction flips payout PENDING→PAID (CAS) + its attached
  commissions APPROVED→PAID (CAS, count-verified) + audit row. Reuses `settleApprovedCommission`
  internals; invariant assertion from T1.10 applies.
- [x] **T6.4** Finance Hub UI: replace "Payouts opening soon" with available-balance card +
  Request button gated on eligibility, using kit `ConfirmDialog` with the amount and
  "requests are reviewed and paid manually; this cannot be combined with a second request until
  settled" consequence copy; pending-request state; typed error surfacing. Delete
  `PayoutRequestButton.tsx` (U12) — superseded.

### Phase 7 — UI (design-system conformance; Impeccable audit after)

- [x] **T7.1 (U1)** Finance: remove the five `.catch(() => …)`; explicit error panel per the
  `documents/page.tsx:43-61` pattern (partial-failure aware: banking form only errors if its
  own read failed).
- [x] **T7.2 (U2)** Notifications: error state + retry; toast (existing kit toast) on
  markRead/markAllRead failure.
- [x] **T7.3 (U3)** Settings: load-failure → inline error + disabled form; save-failure →
  inline error; success → confirmation feedback.
- [x] **T7.4 (U4)** Contrast pass: slate-300/slate-400 body copy → `--al-text-muted`/slate-500+;
  `text-white/40` disclaimer → `/70`; slate-400 stays only decorative.
- [x] **T7.5 (U5/U8/U9)** Entry forms + wizard adopt shared `Input`/`Label` (solid focus ring,
  `htmlFor`/`id`, `aria-invalid`/`aria-describedby`); `aria-label` on password toggle
  (+`aria-pressed`) and copy buttons.
- [x] **T7.6 (U10)** Responsive: `grid-cols-1 sm:grid-cols-3` (or 2/3) on earnings + network
  stat rows; network tree indentation collapsed on mobile (`ml-2 sm:ml-8` pattern).
- [x] **T7.7 (U11)** Token migration: register/signin/unsubscribed hex → `--al-*`/slate
  utilities; `portal/layout.tsx` bg → token; income-calculator canvas colors extracted to a
  constants module referencing the token hex values with a comment (canvas can't read CSS vars).
- [x] **T7.8 (U16/U15/U17)** Empty-state CTAs (earnings/referrals/network → Referral Hub link via
  the dashboard EmptyState pattern); REJECTED banner gains reason pointer + support contact;
  terminology: "Income Calculator" and "Referral Network" everywhere; drop "real time" claim;
  settings toggle cleanup; chevron `aria-hidden`.
- [x] **T7.9 (U14, minimal)** Register's client-side session check → server-side redirect in the
  page (RSC wrapper). Notifications/settings stay client (working, consistent enough) — noted
  as accepted drift in the PR; deferred restructure.

### Phase 8 — Dead code

- [x] **T8.1 (R2/O17/D17)** Delete: `PORTAL_PREFIXES`, `registerAffiliate`/`activateAffiliate`/
  `getAffiliateWithStats`, `getOnboardingStatus` (superseded by the wired gate's read),
  `getNetworkTree`, `PayoutRequestButton` (done in T6.4). Keep `payout-invariants.ts` (now
  called, T1.10). `AffiliateTier`/`TierHistory`/`PayoutSchedule` schema stays (deferred
  decision, §7) but the Finance "next payout" display driven by the never-written schedule is
  removed (honesty) in T6.4.

### Phase 9 — Playwright E2E + wrap-up tests

- [x] **T9.1** `frontend/tests/e2e/affiliate-portal.spec.ts` on `playwright.e2e.config.ts`,
  desktop + mobile projects, DATABASE_URL `autolenis_e2e` guard + skip-with-reason exactly per
  `dealer-funnel.spec.ts`. Coverage (brief's list): unauthenticated `/affiliate/portal/dashboard`
  → signin redirect; bare `/affiliate/portal` → dashboard (T3.1); onboarding gate redirect for
  NOT_STARTED on a gated page + exempt pages reachable; dashboard renders with seeded data;
  earnings totals equal a direct Prisma ledger aggregation (DB-state assertion); payout request
  happy path (seeded APPROVED commissions → PENDING payout row + commissions claimed) and
  rejection path (below threshold → typed error surfaced); referral-link copy (clipboard grant);
  document upload (fixture PDF → row + listed); notifications read + mark-all-read; suspended
  affiliate → `/affiliate/unsubscribed` and API 401; every sidebar destination responds 200.
- [x] **T9.2** Visual suite: NOT extended — the authenticated "dashboard tier" exists only as a
  comment in `design-system.visual.spec.ts` (no `DASHBOARD` targets, no auth baselines
  committed); building it is out of scope. Stated in the PR (per brief: "say so rather than
  forcing it").

### Phase 10 — Verification loop & delivery

- [x] **T10.1** Gates, all from `frontend/`, actual output recorded: `npm run typecheck`,
  `npm run lint`, `npm run build`, `npm test`, `npm run test:auth`, `npm run test:admin-authz`,
  `npm run test:payments`, `npx playwright test -c playwright.e2e.config.ts` (expected: skips
  with reason unless a local server + seeded DB is stood up — attempt to stand one up; if the
  environment cannot, report exactly why), plus `pnpm test:all` per CLAUDE.md and
  `test:migrations` for T6.1/T6.2.
- [x] **T10.2** First code review (independent reviewer agent on the actual diff), fix, re-test.
- [x] **T10.3** Second independent review after fixes (fresh agent, fresh eyes), fix, regression
  re-run. `/security-review` scope: register rate limit, webhook changes, payout rail, RLS
  migration, attribution cookie.
- [x] **T10.4** `autolenis-production-readiness` verdict (PASS / PASS WITH CONDITIONS / BLOCKED)
  with the NOT VERIFIED list (live infra items: bucket privacy, out-of-band RLS state, real
  email delivery, unapplied migrations).
- [x] **T10.5** Draft PR with the FIXED / REFUTED / DEFERRED disposition table covering **every**
  ID in §3, each claim labeled VERIFIED / ASSUMPTION / UNVERIFIED; owner-gated steps (migrations,
  payout-rail enablement in production, RLS) called out explicitly. Do not merge.

## 6. Known-unverifiable in this environment (will be reported NOT VERIFIED)

- Supabase Storage bucket `affiliate-documents` privacy (deployment-checklist item).
- Whether out-of-band RLS enabling happened on production (D3 moot-ness).
- Real email delivery (Resend) and `generateLink` runtime semantics.
- Any behavior requiring the unapplied owner-gated migrations.
- E2E full-stack run if a local seeded server cannot be stood up (specs will skip with reason).

## 7. Deferred (real findings, out of scope — PR DEFERRED section)

| Finding | Why deferred | What it takes |
|---|---|---|
| Real payout money movement (Stripe Connect/ACH) | Owner-gated product+vendor decision; settlement stays recorded-only (existing TODO honest) | Connect onboarding, transfer adapter, webhook reconciliation |
| AffiliateTier/TierHistory implement-or-drop; PayoutSchedule scheduler | Dead schema; dropping = production migration beyond remediation scope | Owner decision, then either a tier engine or a drop migration |
| Milestone commission ledger (money as rows, not `paidAt` stamp) | Requires a design for milestone→ledger linkage | Extend Commission or a MilestonePayout model |
| Leaderboard/network masking redesign (D22) | Current exposure is by-design-ambiguous, no PII beyond domain | Owner call on masking policy |
| Visual-suite authenticated tier (T9.2) | Harness feature, not an affiliate defect | VISUAL_STORAGE_STATE capture job + baselines |
| O8 orphaned-Supabase-user reconciliation job | Low frequency; detection message ships (T5.6) | Cron + admin surface |
| O16 uniform admin role allowlists; R14 401→403 | Convention changes beyond the affiliate surface | Small, but cross-portal |
| Notifications/settings client→RSC restructure (U14) | Working; consistency-only | Page rewrite |
| Visitor-scoped click conversion (M13 residual) | Stats-only impact | Click-id cookie linkage |
