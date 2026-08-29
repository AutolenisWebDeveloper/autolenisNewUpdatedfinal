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

## 4. Decisions taken by this plan (flag at plan review if you disagree)

1. **Activation model — keep auto-ACTIVE on email verification** (current server reality). Fix the
   register success copy, allow `PENDING` at sign-in with an "under review" banner path removed
   (PENDING only arises from the safety net; map it to the same portal experience as ACTIVE since
   `requireAffiliate` already permits it). Rejected: introducing human review pre-activation —
   contradicts the deployed model and adds an admin bottleneck the owner didn't ask for.
2. **Onboarding gate — wire `requireAffiliateWithOnboarding` into the portal layout** (its exempt
   list already covers onboarding/profile/settings/compliance; extend with dashboard + resources +
   notifications so a `NOT_STARTED` affiliate can see their home, get guidance, and read
   notices — the dashboard already renders an onboarding CTA). Earnings/finance/referral-hub/
   network/leaderboard/documents/income-calculator require the wizard. Payout eligibility
   additionally requires onboarding **APPROVED** + verified payout method. Rejected: deleting the
   gate — the brief requires an onboarding gate E2E and an operational approval flow.
3. **Payout request rail — rebuild, not re-enable.** `requestPayout` becomes: one `$transaction`
   that CAS-claims the affiliate's APPROVED commissions (`updateMany where status:"APPROVED",
   payoutId:null` → attach to a new `AffiliatePayout` in `REQUESTED` status), min threshold 2500¢,
   requires onboarding APPROVED + payout method. Admin settles via the existing mark-paid CAS
   (extended to settle a requested payout: REQUESTED→PAID flips its commissions APPROVED→PAID).
   Real money movement stays out (recorded-only settlement, existing TODO stands). No new enum
   value: the request state reuses the existing, currently-unreachable `PayoutStatus.PENDING`
   (M12), so no schema change is needed for the rail.
4. **Clawback semantics — one shared aggregation.** New `commissionLedgerTotals()` in
   `commission.service.ts`: `earned = SUM(amountCents) WHERE status IN (PENDING, APPROVED, PAID)
   + SUM(amountCents) WHERE status = REVERSED AND amountCents < 0`. In-place-reversed positive
   rows stay excluded; clawback offsets net out. All five consumers (summary, leaderboard SQL,
   digest, referrals page, admin) switch to the same rule. Rejected: converting in-place reverse
   to offsets (rewrites admin history semantics).
5. **Refunds → commissions:** in the `charge.refunded` fee branch, PENDING/APPROVED commissions
   whose `qualifyingEventId` starts with the refunded PI id are flipped to REVERSED (CAS);
   PAID ones trigger an ops alert (existing notification path) for manual clawback — never a
   silent auto-clawback of paid money. Cron auto-approval additionally requires the linked deal
   to not be CANCELLED/REFUNDED.
6. **Schema migrations are written but NOT applied** (owner-gated): indexes (D1, D7, D8, D9, D15),
   `affiliate_documents` drift reconciliation (D2), RLS enable deny-all for 16 tables (D3),
   `affiliate_referrals.referred_user_id` UNIQUE (D6 — safe: table has 0 rows), drop orphaned
   `affiliates."lastInactiveNudgeAt"` duplicate column, `payout_id` FK SET NULL→RESTRICT (D20).
   Code-side belt-and-braces (deterministic `orderBy`) ships regardless.
7. **Deferred entirely** (real, out of scope — see §7): Stripe Connect payouts; AffiliateTier
   implementation or table drop; milestone ledger; leaderboard masking redesign; visual-suite
   authenticated tier; O8 orphan reconciliation job (add detection message only); O16 role
   uniformity; R14 401→403.

## 5. Execution phases and tasks

Order is dependency-driven: money correctness first (it defines the semantics the UI must
display), then attribution, then the payout rail, then gates/routing, onboarding, data layer,
UI, dead code, E2E. **Every task:** (1) re-read the cited files and confirm the finding still
holds; (2) failing test first (`tsx --test` conventions of the sibling tests in
`lib/services/affiliate/__tests__/`); (3) minimal fix; (4) suite green; (5) commit with a
conventional message naming the finding ID. Commits are per-task.

### Phase 0 — Baseline (no fixes)

- [ ] **T0.1** Run `npm run typecheck && npm run lint && npm test` from `frontend/`; record
  results in the working notes. A pre-existing red is reported, not silently fixed.

### Phase 1 — Money correctness

- [ ] **T1.1 (M1/D5)** `commissionLedgerTotals` shared helper + clawback-aware aggregation.
  Test first: `__tests__/commission-ledger-totals.test.ts` — seed PAID 6000 + REVERSED −6000
  offset (clawback shape) + in-place REVERSED +5000 → `earnedCents` 0 from the first pair,
  excludes the third. Then implement in `commission.service.ts`; switch `getCommissionSummary`,
  leaderboard SQL `FILTER`, `digest.service.ts:104-108`, `referrals/page.tsx:36`, and the admin
  netting to it. Regression: existing `commission-basis`/`commission-durability` stay green.
- [ ] **T1.2 (M2)** Refund wiring + cron gating. Tests: reversal on `charge.refunded` for
  PENDING/APPROVED via CAS `updateMany({ where: { qualifyingEventId: { startsWith: pi.id },
  status: { in: ["PENDING","APPROVED"] } } })`; PAID → ops notification, untouched; cron
  approves only commissions whose `dealId` resolves to a deal not in CANCELLED/REFUNDED.
  Files: `app/api/webhooks/stripe/route.ts` (fee-refund branch), `app/api/cron/affiliates/route.ts`,
  logic in `commission.service.ts` (`reverseCommissionsForPaymentIntent`).
- [ ] **T1.3 (M3)** Legacy fee path: derive `buyerId` from `feeDeal.buyerId` when metadata absent;
  always attempt the walk; DLQ on failure (existing `autolenis/affiliate.commission_walk` topic).
  Test: webhook fixture without metadata still creates commissions.
- [ ] **T1.4 (M4)** Basis: fallback `PREMIUM_FEE_CENTS` → `PREMIUM_FEE_REMAINING_CENTS`; buyer
  advertised amount computed from the same constant. Test asserts 6000¢ both places.
- [ ] **T1.5 (M5)** Admin approve/reject/reverse → CAS `updateMany({ where: { id, status:
  expected } })`, 409 on count 0, REVERSED only from PENDING/APPROVED (REJECTED excluded), matching
  the settlement pattern. Extend `commission-authz-route.test.ts` siblings.
- [ ] **T1.6 (D13)** Wrap each admin money mutation + its audit `create` in one `$transaction`;
  remove `.catch(() => {})`. The `approvedAt`/`approvedBy`/`reversedAt` stamp columns are added
  to schema.prisma and to the Phase-6 owner-gated migration, and the code that writes them lands
  in the same branch — the PR flags the coupling explicitly: **deploying this code before
  applying the migration would fail**, so migration application precedes deploy (owner step).
- [ ] **T1.7 (M10/D19)** Manual commission idempotency: require a client `idempotencyKey`
  (zod), `qualifyingEventId = admin-manual-${affiliateId}-${dealId}-${idempotencyKey}`; set
  `basisCents`. Test: same key twice → one row + 409/no-op.
- [ ] **T1.8 (M8)** One buyer-surface definition: `buyer/referral.service.ts` counts
  `AffiliateReferral` (never `children`) and uses `commissionLedgerTotals`. Test pins it.
- [ ] **T1.9 (M15/D18)** Earnings level bars via `commission.groupBy(["level"], { _sum })` —
  drop the `take: 50` reduction. (UI file change; test in service if extracted, else covered by
  E2E render assertion.)
- [ ] **T1.10 (M11)** Call `isCommissionSettled` as a post-settle assertion inside
  `settleApprovedCommission`'s transaction (throw → rollback). Test: corrupted shape rolls back.
- [ ] **T1.11 (M9, partial)** Evaluate milestones from `recordAffiliateAttribution` (after upsert)
  instead of only the buyer page view; pay route → CAS `updateMany({ where: { id, paidAt:
  null } })`. Milestone *ledger* stays deferred (§7).
- [ ] **T1.12 (M13, partial)** Rate-limit `/api/public/referral/track` with the existing limiter
  used by auth actions; keep salt fallback but log a warning when `REFERRAL_IP_SALT` unset.
  Visitor-scoped conversion linking deferred (stats-only impact).

### Phase 2 — Attribution integrity

- [ ] **T2.1 (M6)** Call `recordAffiliateAttribution` from both `ensurePrismaUser` provisioning
  call sites (`signInAction`, `acceptTermsAction`) when `user_metadata.referralCode` exists.
  Test: provisioning path creates the `AffiliateReferral`.
- [ ] **T2.2 (M6)** Server-side cookie fallback: `signUpAction` reads `affiliate_ref` from
  `cookies()` when the form field is empty. Add `secure: true` to the cookie in `proxy.ts`.
- [ ] **T2.3 (D6)** Deterministic payee: `processFeeCommission` orders by `signedUpAt asc`
  (first-touch). UNIQUE(referred_user_id) migration SQL in Phase 6 (0 rows live → safe).
- [ ] **T2.4 (D12/M14)** Stamp `firstDealAt` (once) and increment `totalDeals` inside
  `processFeeCommission`'s transaction; also write `Buyer.affiliateId` on attribution so the
  inactive-cron's buyer signal works. Tests for both.
- [ ] **T2.5 (R10/O7)** Register page reads `?ref` + `affiliate_ref` cookie into a visible,
  editable "Referral code (optional)" field and POSTs it; API sets `level: parent.level + 1`
  (cap at 3). Failing test on the route level math first.

### Phase 3 — Payout request rail (per decision 3)

- [ ] **T3.1** `requestPayout` in `affiliate-payout.service.ts`: single `$transaction` — eligibility
  (onboarding APPROVED via `AffiliateOnboardingReview`, payout method exists, sum(APPROVED,
  payoutId:null) ≥ 2500¢) → create `AffiliatePayout` status `PENDING` → CAS-attach commissions
  (`updateMany where affiliateId, status:"APPROVED", payoutId:null → { payoutId }`; count must
  equal the pre-read set or rollback). Commissions stay APPROVED until settlement. Tests:
  happy path; below-threshold rejection; no-method rejection; onboarding-not-approved rejection;
  **two concurrent requests cannot claim the same commission** (CAS count mismatch → rollback).
- [ ] **T3.2** `/api/affiliate/payouts/request` replaces the 503 stub: zod body (optional note),
  auth via `getRequestAffiliate`, service call, typed errors (`BELOW_MINIMUM`,
  `NO_PAYOUT_METHOD`, `ONBOARDING_REQUIRED`, `NOTHING_TO_PAY`).
- [ ] **T3.3** Admin settlement of a requested payout: extend mark-paid to accept an
  `AffiliatePayout` in PENDING → one transaction flips payout PENDING→PAID (CAS) + its attached
  commissions APPROVED→PAID (CAS, count-verified) + audit row. Reuses `settleApprovedCommission`
  internals; invariant assertion from T1.10 applies.
- [ ] **T3.4** Finance Hub UI: replace "Payouts opening soon" with available-balance card +
  Request button gated on eligibility, using kit `ConfirmDialog` with the amount and
  "requests are reviewed and paid manually; this cannot be combined with a second request until
  settled" consequence copy; pending-request state; typed error surfacing. Delete
  `PayoutRequestButton.tsx` (U12) — superseded.

### Phase 4 — Routing & auth

- [ ] **T4.1 (R1)** `proxy.ts` step 10: exact `/affiliate/portal` (and trailing-slash) →
  redirect `/affiliate/portal/dashboard`. E2E asserts 200 chain later.
- [ ] **T4.2 (R4)** `limitAuthAttempt`-style IP+email throttle on register (reuse the existing
  limiter from `actions.ts:341-348`); correct the proxy CSRF comment (R9) — no behavior change
  to CSRF policy itself; neutralize enumeration by returning the same success envelope for
  existing emails (send "you already have an account" email instead — matches buyer forgot-password
  convention if present; if not, keep 409 but rate-limited, and say so in the PR).
- [ ] **T4.3 (R5)** Port the buyer `setAll` cookie-forwarding into `affiliate-api.ts` verbatim
  (attributed comment). Test mirrors the buyer helper's test if one exists; else unit-test the
  handler wiring.
- [ ] **T4.4 (R6/O10)** Align activation model (decision 1): fix register success copy; sign-in
  permits PENDING (drops the "under review" hard block; keeps SUSPENDED/REJECTED handling);
  safety-net provisioning unchanged.
- [ ] **T4.5 (R7/O1 + R8)** `unsubscribed/page.tsx`: proper `reason === "rejected"` card (what
  happened, the emailed reason exists, support contact, no dashboard link); delete the dead
  layout REJECTED branch (`portal/layout.tsx:19-27`).
- [ ] **T4.6 (O2)** Verification recovery: map `verify_required` to human copy + a resend action
  on the affiliate sign-in client; extend the existing resend-verification route to accept
  affiliates (branch on role, affiliate email template) — no second route. Register fails loudly
  (VERIFICATION_UNAVAILABLE) when `generateLink` fails instead of sending a dead-end email.
- [ ] **T4.7 (R12/O13)** Onboarding degraded state renders an error panel instead of
  self-redirect; `affiliate-session.ts:46-49` same fix when the gate goes live.
- [ ] **T4.8 (R13)** Sign-out: role-aware redirect (affiliates → `/affiliate/signin`);
  authenticated visitors to `/affiliate/signin` bounce to the dashboard (server-side, mirroring
  step-9's AUTH_ROUTES pattern or an in-page server check). Remember-me deferred.
- [ ] **T4.9 (R11/U13)** Register client validation = server zod rules (12 chars + classes);
  `noValidate` on the form so the styled error path owns validation.

### Phase 5 — Onboarding integrity

- [ ] **T5.1 (O3)** Transition guards in `saveOnboardingStep` + `submit`: step writes rejected
  (409) when status ∈ {SUBMITTED, APPROVED, REJECTED} unless NEEDS_CORRECTION; submit only from
  IN_PROGRESS/NEEDS_CORRECTION; all data+status writes in one `$transaction`; admin review 404s
  a nonexistent affiliate and requires an existing review row (no approve-from-nothing). Failing
  tests per illegal transition.
- [ ] **T5.2 (O4/O5/U7)** Wizard status rendering: NEEDS_CORRECTION banner listing
  `correctionItems` + `decisionNote`; SUBMITTED/UNDER_REVIEW → "submitted, under review" card;
  APPROVED → the existing success card; REJECTED → explanation card. Props already typed.
- [ ] **T5.3 (R3, decision 2)** Wire `requireAffiliateWithOnboarding` into `portal/layout.tsx`
  with the extended exempt list (dashboard, resources, notifications + existing four); pages
  drop their duplicate `requireAffiliate` **only** where the layout guarantees it (keep the
  call in pages that render user data — cheap after M7's include removal — decide per page and
  document); nav gating in `AffiliateSidebar` mirrors the gate (locked items with lock icon +
  tooltip, matching the buyer sidebar's existing gating pattern if present).
- [ ] **T5.4 (O15/U6)** Step 6 gates on a GOVERNMENT_ID upload specifically; upload path wrapped
  in try/catch with `apiErrorMessage` surfacing.
- [ ] **T5.5 (O11/O12)** One upload service consumed by both routes (union of type allowlists,
  identical MIME rules); one tax-classification vocabulary (finance enum wins; wizard maps its
  labels onto it; migration-free — column is text).
- [ ] **T5.6 (O9/O14/O8)** P2002 retry on referral-code create; escape admin reason/note in email
  HTML (`escapeHtml` helper already in repo — grep, reuse); register EMAIL_EXISTS branch
  distinguishes the Supabase-orphan case (Supabase user exists, no Prisma user) and returns a
  distinct message telling the user to contact support (reconciliation job deferred).

### Phase 6 — Data layer

- [ ] **T6.1 (D1/D7/D8/D9/D15/D6/D20/D2 + dup column + audit stamps)** One migration:
  `frontend/prisma/migrations/<ts>_affiliate_surface_reconciliation/migration.sql` —
  `CREATE INDEX` on `commissions(affiliate_id, status)`, `commissions(status, created_at)`,
  `buyers(affiliate_id)`, `affiliates(parent_id)`, `affiliate_referrals(referred_user_id)` +
  UNIQUE, `affiliate_payouts(affiliate_id)`; `affiliate_documents` drift fix (drop
  `document_type`, align nullability + `bigint`→`integer`, rename indexes to Prisma names);
  drop `affiliates."lastInactiveNudgeAt"`; `commissions` `approved_at`/`approved_by`/`reversed_at`;
  `payout_id` FK → RESTRICT. Idempotent (`IF NOT EXISTS` / guarded DO blocks) per repo migration
  conventions. schema.prisma updated to match. **NOT applied to production — owner-gated,
  called out in the PR.** `npm run test:migrations` (chain-from-zero) must pass.
- [ ] **T6.2 (D3)** Separate migration enabling RLS deny-all on all 16 affiliate tables,
  following `20260918000000_enable_rls_manual_tables` exactly. Owner-gated likewise.
- [ ] **T6.3 (M7/D4)** Drop the `commissions` include + slim `user` select in
  `getAuthenticatedAffiliate`; keep `children: { take: 1 }` only if a consumer needs it (grep;
  none found → drop). Typecheck catches any hidden consumer.
- [ ] **T6.4 (D10)** Admin `earningsTier` filter moves before pagination (tier derived from the
  commission `groupBy` already computed); `total` reflects the filtered set. Test with 2 pages.
- [ ] **T6.5 (D11)** `getAffiliateMetrics` → `commission.groupBy` + `affiliateReferral.groupBy`;
  no row loading. Numbers pinned by test.
- [ ] **T6.6 (D14)** Digest + inactive crons: eligibility in SQL (`lastDigestSentAt < weekStart
  OR NULL`, etc.), `orderBy: { id: "asc" }`, cursor loop. Test the watermark filter.
- [ ] **T6.7 (D15)** `getPayoutHistory` paginated (`take: 50` default + cursor param); API +
  finance page consume it.

### Phase 7 — UI (design-system conformance; Impeccable audit after)

- [ ] **T7.1 (U1)** Finance: remove the five `.catch(() => …)`; explicit error panel per the
  `documents/page.tsx:43-61` pattern (partial-failure aware: banking form only errors if its
  own read failed).
- [ ] **T7.2 (U2)** Notifications: error state + retry; toast (existing kit toast) on
  markRead/markAllRead failure.
- [ ] **T7.3 (U3)** Settings: load-failure → inline error + disabled form; save-failure →
  inline error; success → confirmation feedback.
- [ ] **T7.4 (U4)** Contrast pass: slate-300/slate-400 body copy → `--al-text-muted`/slate-500+;
  `text-white/40` disclaimer → `/70`; slate-400 stays only decorative.
- [ ] **T7.5 (U5/U8/U9)** Entry forms + wizard adopt shared `Input`/`Label` (solid focus ring,
  `htmlFor`/`id`, `aria-invalid`/`aria-describedby`); `aria-label` on password toggle
  (+`aria-pressed`) and copy buttons.
- [ ] **T7.6 (U10)** Responsive: `grid-cols-1 sm:grid-cols-3` (or 2/3) on earnings + network
  stat rows; network tree indentation collapsed on mobile (`ml-2 sm:ml-8` pattern).
- [ ] **T7.7 (U11)** Token migration: register/signin/unsubscribed hex → `--al-*`/slate
  utilities; `portal/layout.tsx` bg → token; income-calculator canvas colors extracted to a
  constants module referencing the token hex values with a comment (canvas can't read CSS vars).
- [ ] **T7.8 (U16/U15/U17)** Empty-state CTAs (earnings/referrals/network → Referral Hub link via
  the dashboard EmptyState pattern); REJECTED banner gains reason pointer + support contact;
  terminology: "Income Calculator" and "Referral Network" everywhere; drop "real time" claim;
  settings toggle cleanup; chevron `aria-hidden`.
- [ ] **T7.9 (U14, minimal)** Register's client-side session check → server-side redirect in the
  page (RSC wrapper). Notifications/settings stay client (working, consistent enough) — noted
  as accepted drift in the PR; deferred restructure.

### Phase 8 — Dead code

- [ ] **T8.1 (R2/O17/D17)** Delete: `PORTAL_PREFIXES`, `registerAffiliate`/`activateAffiliate`/
  `getAffiliateWithStats`, `getOnboardingStatus` (superseded by the wired gate's read),
  `getNetworkTree`, `PayoutRequestButton` (done in T3.4). Keep `payout-invariants.ts` (now
  called, T1.10). `AffiliateTier`/`TierHistory`/`PayoutSchedule` schema stays (deferred
  decision, §7) but the Finance "next payout" display driven by the never-written schedule is
  removed (honesty) in T3.4.

### Phase 9 — Playwright E2E + wrap-up tests

- [ ] **T9.1** `frontend/tests/e2e/affiliate-portal.spec.ts` on `playwright.e2e.config.ts`,
  desktop + mobile projects, DATABASE_URL `autolenis_e2e` guard + skip-with-reason exactly per
  `dealer-funnel.spec.ts`. Coverage (brief's list): unauthenticated `/affiliate/portal/dashboard`
  → signin redirect; bare `/affiliate/portal` → dashboard (T4.1); onboarding gate redirect for
  NOT_STARTED on a gated page + exempt pages reachable; dashboard renders with seeded data;
  earnings totals equal a direct Prisma ledger aggregation (DB-state assertion); payout request
  happy path (seeded APPROVED commissions → REQUESTED payout row + commissions claimed) and
  rejection path (below threshold → typed error surfaced); referral-link copy (clipboard grant);
  document upload (fixture PDF → row + listed); notifications read + mark-all-read; suspended
  affiliate → `/affiliate/unsubscribed` and API 401; every sidebar destination responds 200.
- [ ] **T9.2** Visual suite: NOT extended — the authenticated "dashboard tier" exists only as a
  comment in `design-system.visual.spec.ts` (no `DASHBOARD` targets, no auth baselines
  committed); building it is out of scope. Stated in the PR (per brief: "say so rather than
  forcing it").

### Phase 10 — Verification loop & delivery

- [ ] **T10.1** Gates, all from `frontend/`, actual output recorded: `npm run typecheck`,
  `npm run lint`, `npm run build`, `npm test`, `npm run test:auth`, `npm run test:admin-authz`,
  `npm run test:payments`, `npx playwright test -c playwright.e2e.config.ts` (expected: skips
  with reason unless a local server + seeded DB is stood up — attempt to stand one up; if the
  environment cannot, report exactly why), plus `pnpm test:all` per CLAUDE.md and
  `test:migrations` for T6.1/T6.2.
- [ ] **T10.2** First code review (independent reviewer agent on the actual diff), fix, re-test.
- [ ] **T10.3** Second independent review after fixes (fresh agent, fresh eyes), fix, regression
  re-run. `/security-review` scope: register rate limit, webhook changes, payout rail, RLS
  migration, attribution cookie.
- [ ] **T10.4** `autolenis-production-readiness` verdict (PASS / PASS WITH CONDITIONS / BLOCKED)
  with the NOT VERIFIED list (live infra items: bucket privacy, out-of-band RLS state, real
  email delivery, unapplied migrations).
- [ ] **T10.5** Draft PR with the FIXED / REFUTED / DEFERRED disposition table covering **every**
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
