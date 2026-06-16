# AUTOLENIS — Completion Workflow · Phase 0 Baseline (Grounding)

**Session:** 1 (discovery only — no code changed)
**Date:** 2026-06-14
**Branch:** `claude/epic-lamport-h6i6cy`
**Frontend root:** `frontend/`
**Method:** Read-only inspection. No DB connection. No writes. Production Supabase ref `aieybibvewmvrubcpthm` (decoy `vpwnjibcrqujclqalkgy` never targeted).

> NOTE ON PRIOR AUDIT: The doc named `AutoLenis_Feature_Status_Audit_VERIFIED.md` referenced in the
> guardrails **does not exist anywhere in the repo** (only `memory/phase_a_audit.md` is present).
> Its claims are reconciled here as *hypotheses stated in the task brief*, re-tested against live code.

---

## 1. App Router Route Tree

Counts (under `frontend/app`):
- **`page.tsx` (surfaces): 313**
- **`route.ts` (API + sitemaps + auth callback): 516**

By role segment:

| Segment | Page count (approx) | Notes |
|---|---|---|
| `(public)` | 57 | Marketing, legal, inventory browse, guides, refinance funnel, dealer/affiliate application, public offer-review/dealer-offer token pages |
| `auth/**` | 8 | signin, signup, verify-email, accept-terms, forgot/reset password, session-expired, unauthorized; `auth/callback/route.ts` (Supabase OAuth) |
| `buyer/**` | 47 | Full lifecycle: onboarding, prequal (+external/manual/declined/pending/result), search/searches, shortlist, auctions/auction, deal (financing/fee/payment/wallet/complete/receipt), insurance, esign, pickup, contracts, contract-shield, deposit, billing, messages, notifications, requests, trade-in, referral |
| `dealer/**` | 49 | apply/claim/invite, onboarding (agreement/fast-track), inventory (+bulk/feed/mapping/history), auctions, offers, quick-offer, deals, contracts, leads, opportunities, payments, pickups, scorecard, analytics, messages, settings, auth |
| `affiliate/**` | 18 | register/signin, portal (dashboard, earnings, payouts, finance, referrals, network, leaderboard, resources, compliance, onboarding, documents, notifications, settings, profile, income-calculator, referral-hub) |
| `admin/**` | 134 | The bulk of the app: dashboard, buyers, dealers (+applications/invite/health), deals (+esign/pickup), auctions, offers, prequal, payments (deposits/refunds), insurance-requests, contracts, contract-shield (+rules), external-preapprovals, CRM suite, content/SEO/social suites, AMIPS, dealer-outreach, reports (affiliate/buyers/dealers/funnel/pipeline/revenue/risk), operations, ops-dashboard, queues, manual-reviews, compliance/OFAC, settings/admins, security/mfa, auth (signin/setup-mfa/verify-mfa) |

API groupings under `app/api`:
- `api/admin/**` — largest API surface (buyers, dealers, deals, auctions, payments, affiliates, CRM, social, content, inventory, reports, queues, etc.)
- `api/buyer/**`, `api/dealer/**`, `api/affiliate/**` — role portals
- `api/public/**` — unauthenticated (inventory, contact, dealer-application, dealer-offer token, refinance, health, platform-stats, social-proof)
- `api/cron/**` — **42 scheduled jobs** (see vercel.json below)
- `api/jobs/**` — Inngest/event jobs (auction lifecycle, deal-complete, reminders) + `api/inngest/route.ts`
- `api/webhooks/**` — stripe, docusign, resend, twilio, microbilt, higgsfield, content-conversion
- `api/twilio/voice/**` — IVR (fallback route is **off-limits** per brief)
- `api/crm/dispatch/**` — email/sms/task/score dispatch
- sitemaps: `sitemap*.xml/route.ts`, `image-sitemap.xml/route.ts`

---

## 2. Service Layer (`frontend/lib/services/**`)

- **178 `.ts` files** across ~50 domain folders.
- Domains: acquisition, activity, admin, affiliate, agreement, ai, analytics, audit, auth, buyer, campaign, contact, content, contract, contract-shield, deal, dealer, dealer-recruitment, deposit, documents, email, esign, faith, ghl, identity, insurance, inventory, messaging, monitoring, notifications, nudge, offer, operations, payment, pickup, prequal, refinance, search, segment, seo, shortlist, sms, suppression, system, template, trade-in, trust, vehicle-request, voice, workflow (engine/prebuilt/service).

Largest / most central services (bytes):
| Service | Size | Role |
|---|---|---|
| `email/resend.service.ts` | 99 KB | Central email sender (40+ templates, idempotent via `EmailSendLog`) |
| `admin/admin-buyer-command-center.service.ts` | 41 KB | Admin buyer ops aggregation |
| `prequal/microbilt.service.ts` | 31 KB | Prequal/IBV bureau integration |
| `email/vehicle-offers.email.ts` | 30 KB | Offer email composition |
| `prequal/admin-prequal.service.ts` | 28 KB | Admin prequal decisions |
| `admin/admin-affiliate-command-center.service.ts` | 28 KB | Admin affiliate ops |
| `admin/admin-dealer-command-center.service.ts` | 27 KB | Admin dealer ops |
| `analytics.service.ts` | 26 KB | Analytics rollups |
| `workflow.engine.ts` | 23 KB | CRM/automation engine |
| `acquisition/unified-buyer-intake.service.ts` | 21 KB | Lead intake |
| `prequal/prequal.service.ts` | 19 KB | Prequal core |
| `operations.service.ts` | 16 KB | Ops dashboard data source |
| `offer/offer.service.ts` | 13 KB | Offer → deal creation |
| `deal/deal.service.ts` | — | **Deal state machine** (see §4) |

---

## 3. Prisma Schema

- **File:** `frontend/prisma/schema.prisma` (single file, ~175 KB)
- **Models: 203**
- **Enums: ~80** (full list captured in session). Lifecycle-load-bearing enums:

**`DealStatus`** (16 states):
`PENDING → ACTIVE → FINANCING_PENDING → FEE_PENDING → FEE_PAID → INSURANCE_PENDING → CONTRACT_PENDING → CONTRACT_REVIEW → CONTRACT_APPROVED → SIGNING_PENDING → SIGNED → PICKUP_SCHEDULED → PICKUP_COMPLETE → COMPLETED`; terminal `CANCELLED`, `REFUNDED`.
> There is **no `SELECTED` state** (prior claim language uses it; reconciled in §6 / re-verification #6).

**`AuctionStatus`**: PENDING, ACTIVE, CLOSED, EXPIRED, CANCELLED, REOPENED.
**`InsuranceStatus`**: NOT_STARTED, QUOTE_REQUESTED, QUOTE_RECEIVED, POLICY_SELECTED, POLICY_BOUND, **EXTERNAL_UPLOADED** (proof-upload fallback), VERIFIED, FAILED.
**`ESignStatus`**: PENDING, SENT, DELIVERED, COMPLETED, DECLINED, VOIDED.
**`PreQualDecision`**: APPROVED, DECLINED, PENDING, MANUAL_REVIEW, OFAC_ESCALATED, OFAC_REVIEW. (`PreQualTier`, `PreQualDecision` both present.)
**Other relevant**: OfferStatus, DepositStatus, CommissionStatus, PayoutStatus, ExternalPreApprovalStatus, FinancingStatus/FinancingPath, ContractVersionStatus, ContractScanRuleType, PickupStatus, IdentityVerificationStatus, AntiCircumventionFlag.

Models cover prequal (`PreQualification`), auction (`Auction`, offers), insurance (quote/policy), contract (`ContractVersion`, contract-shield review/rules), affiliate (commissions/payouts/network), deposit, deal, identity, OFAC/compliance.

---

## 4. RBAC / Middleware / Auth

**Active middleware: `frontend/proxy.ts`** (sole middleware; no active `middleware.ts`). ~601 lines.
- Route classes: `PUBLIC_ROUTES`, `AUTH_ROUTES`, `ADMIN_AUTH_ROUTES`, `DEALER_AUTH_ROUTES` (proxy.ts:48–127).
- Portal prefix → role map (proxy.ts:137–154): `/buyer`→BUYER, `/dealer`→DEALER, `/affiliate/portal`→AFFILIATE, `/admin`→{SUPER/OPERATIONS/COMPLIANCE/FINANCE/SUPPORT}_ADMIN.
- Admin routes require `admin_token` JWT with **`mfaVerified=true`** (proxy.ts:412–425).
- Dealer routes require `dealer_token` JWT, role=DEALER (proxy.ts:427–451).
- Buyer/affiliate via Supabase session (proxy.ts:483–551); unauth → `/auth/signin?redirect=…`; suspended buyer → `/buyer/suspended`; terms-pending → `/auth/accept-terms`.
- CSRF: enforced via `X-CSRF-Token` vs `csrf-token` cookie, skipped for webhooks/cron/twilio/make/public + role API namespaces (proxy.ts:200–283).
- Cron auth: `Authorization` header vs `CRON_SECRET` (proxy.ts:287–295).

**Server-side authz helpers:**
| Helper | File | Behavior |
|---|---|---|
| `getAdminFromRequest()` | `lib/auth/admin-api.ts:15` | Verifies `admin_token` JWT, checks `mfaVerified` + `isActive`. `getAdminWithRole()` enforces role set. `createAuditLog()` at `:43`. |
| `getAuthenticatedAdmin()` / `requireAdminRole()` | `lib/auth/admin-session.ts:9,35` | Server-component admin guard. |
| Admin MFA/TOTP | `lib/admin-auth.ts` | RFC-6238 TOTP (otpauth), AES-256-GCM-encrypted secrets, 10 bcrypt recovery codes, 5-attempt/15-min lockout. **MFA mandatory, no skip.** |
| `getRequestBuyer()` | `lib/auth/api.ts:19` | Supabase session → Prisma buyer (+preQualification); null if unauth. |
| `getRequestDealer()` | `lib/auth/dealer-api.ts:17` → `dealer-session.ts:38` | Verifies `dealer_token`; blocks SUSPENDED/TERMINATED/PENDING. |
| `getRequestAffiliate()` | `lib/auth/affiliate-api.ts:13` | Supabase session → Prisma affiliate; blocks SUSPENDED/REJECTED. |

---

## 5. Integrations

- **Stripe**: SDK init `lib/stripe.ts` (lazy singleton, API `2026-04-22.dahlia`, hard-fails without `STRIPE_SECRET_KEY`). Service `lib/services/payment/stripe.service.ts` (createPaymentIntent/refund/retrieve/constructWebhookEvent). **Webhook** `app/api/webhooks/stripe/route.ts` — **idempotent via unique-index claim on `PaymentProviderEvent.eventId`** (route.ts:32–57; P2002 → ack duplicate). Refunds/disputes audit-logged (route.ts:360–369, 403–420).
- **Resend (email)**: `lib/services/email/resend.service.ts` (lazy client, `noreply@autolenis.com`, idempotent via `EmailSendLog`; outcomes SENT/DUPLICATE/FAILED/DEV_SKIPPED). 40+ templates in `lib/services/email/templates/`.
- **DocuSign (esign)**: `lib/services/esign/docusign-auth.service.ts` (JWT auth) + `esign.service.ts` (createEnvelope/sendEnvelope/handleEnvelopeCompleted). Webhook `app/api/webhooks/docusign/route.ts`.
- **Cron**: `frontend/vercel.json` defines **42 cron jobs** (auction-close */5, contract-shield hourly, prequal SLA/IBV/purge, inventory sync, social suite, affiliate digest/inactive, dealer followup/scorecard, morning-briefing, vehicle-offer-expire, health-check, sla-check, trust-check, workflow-automation, faith-verse-rotation, etc.).
- Other webhooks: docusign, resend, twilio/inbound, microbilt, higgsfield, content-conversion. Twilio voice IVR under `api/twilio/voice/**`.

---

## 6. Test Setup

- **Runner: Node native test runner via `tsx --test`** — *not Vitest* (the brief said "Vitest + Playwright"; reconciled — see deltas). Scripts in `package.json`:
  - `test` → `tsx --test lib/services/prequal/__tests__/*.test.ts lib/services/dealer-recruitment/__tests__/*.test.ts`
  - `test:content`, `test:admin-content` (`--experimental-test-module-mocks`), `test:seo`, `test:crm` (separate suites, **not run by default `test`**).
- **Playwright**: e2e at `tests/e2e/responsive-overflow.spec.ts` (`@playwright/test`) — separate, not run by unit scripts.
- **No `vitest.config.*` / `playwright.config.*` found** at frontend root (UNVERIFIED location for Playwright config).
- **~22 unit test files** total across `__tests__/` dirs (prequal, dealer-recruitment, content, crm, seo, admin/content) + 1 Playwright spec.

---

## 7. BASELINE COMMAND RESULTS (exact, from `frontend/`)

| Command | Result |
|---|---|
| `pnpm install` | **PASS** (exit 0). `prisma generate` ran in postinstall (Prisma Client v5.22.0). Done in 18.9s. |
| `pnpm tsc --noEmit` | **PASS — 0 errors.** |
| `pnpm lint` | **102 problems — 0 errors, 102 warnings** (16 auto-fixable). Warnings are mostly `no-unused-vars` + 1 `no-explicit-any`. |
| `pnpm build` | **PASS** (exit 0). Full Next.js 16 production build completed; all routes compiled (static/SSG/dynamic mix). No failing module. |
| `pnpm test -- --run` | **PASS — 22 pass / 0 fail.** Runs ONLY the default `test` script (prequal + dealer-recruitment node:test suites). `--run` is a Vitest flag and is inert here (harmlessly ignored by `tsx --test`). Suites `test:content`/`test:admin-content`/`test:seo`/`test:crm` and Playwright e2e were **not** executed by this command. |

**These are BASELINE evidence only — not remediation proof. No code changed this session; no remediation batches were run.**

---

## 8. Tech-Debt Re-measure (re-verification target #9)

| Metric | Prior claim | Live measurement | Delta |
|---|---|---|---|
| `any` types | 1,109 | **~4** (`: any` in lib/app/components; eslint `no-explicit-any` flags 1) | **MASSIVE DROP** — codebase was heavily de-`any`'d since the prior audit. |
| `console.*` in `lib/` | 113 | **538** (`console.{log,error,warn,info,debug}` across `lib/**`) | **INCREASED ~4.7×.** |
| Public routes missing error boundaries | (open) | **0 `error.tsx` under `app/(public)`**; only **4 `error.tsx`** in the whole `app/` tree; 123 `loading.tsx` present | **Gap CONFIRMED** — public segment has no route-level error boundary. |
