# AUTOLENIS V4 — PHASE A AUDIT REPORT
## Complete Gap Matrix | Missing Systems | Architecture Risks | Production Blockers | Recommended Build Order
### Executed against: AutoLenis_Master_Prompt_V4_FINAL.md + AutoLenis_V4_Execution_Prompt_HARDENED.md
### Audit Date: Phase A Execution
### Status: COMPLETE — STOP BEFORE CODE

---

## REPOSITORY STATE ASSESSMENT

### What Exists in /app (Current Workspace)

| File/Directory | Type | Notes |
|---|---|---|
| `/app/backend/server.py` | FastAPI hello-world | 86 lines, MongoDB CRUD skeleton, zero AutoLenis logic |
| `/app/frontend/src/App.js` | React CRA hello-world | 54 lines, single route, zero AutoLenis logic |
| `/app/frontend/package.json` | React 19 dependencies | Radix UI, Recharts, Tailwind v3 — partially overlapping |
| `/app/backend/requirements.txt` | Python dependencies | FastAPI, motor, bcrypt, pyjwt — not AutoLenis stack |
| `/app/backend/.env` | Env config | MongoDB URL only |
| `/app/frontend/.env` | Env config | REACT_APP_BACKEND_URL only |
| `/app/memory/` | Empty directory | — |
| `/app/tests/` | Empty directory | — |

### Stack Mismatch Summary

| Dimension | V4 Required | Current Workspace | Status |
|---|---|---|---|
| Framework | Next.js 16 (App Router) | React 19 (CRA) | **MISMATCH** |
| Language | TypeScript strict | JavaScript | **MISMATCH** |
| ORM | Prisma | None (raw motor) | **MISMATCH** |
| Database | PostgreSQL (Supabase) | MongoDB | **MISMATCH** |
| Auth | Supabase Auth + proxy.ts | None | **ABSENT** |
| CSS | Tailwind CSS v4 | Tailwind CSS v3 | **MISMATCH** |
| Deployment | Vercel (cron-enabled) | Unspecified | **MISMATCH** |
| Testing | Vitest + Playwright | pytest skeleton | **MISMATCH** |
| Type system | `env.d.ts` + Zod | None | **ABSENT** |

**Net assessment:** The existing scaffold is an incompatible project, not a stub of AutoLenis. Phase B's FIRST action must be complete scaffold replacement with a V4-compliant Next.js 16 TypeScript project. Nothing in the current workspace should be preserved except the `/app` directory itself.

---

## PHASE A — GAP MATRIX

---

### CONFIRMED EXISTING (no rebuild required, verify only)

**NONE.**

The workspace contains zero AutoLenis-related files, routes, components, services, or database models. There are no verified AutoLenis pages, no Prisma schema, no service layer, and no credentials configured. The "verified codebase baseline" metrics cited in the Execution Prompt (256 pages, 467 API routes, 119 service files, 173 components, 4,725-line Prisma schema, 211 test files) describe the **target state** of a complete build — not the current workspace state.

The scaffold hello-world files (`server.py`, `App.js`) are NOT AutoLenis content and will be replaced entirely.

---

### MISSING — BUILD REQUIRED

All items below are new construction. Every route, page, component, service, model, and configuration item listed here must be built from scratch per V4 specification.

---

#### 1. PROJECT INFRASTRUCTURE (ALL MISSING)

| Item | V4 Reference | Priority |
|---|---|---|
| `package.json` (Next.js 16 + pnpm) | Stack spec | P0 |
| `tsconfig.json` (strict mode) | Stack spec | P0 |
| `next.config.mjs` (CORS + headers) | D10 + Stack spec | P0 |
| `tailwind.config.ts` (v4) | Stack spec | P0 |
| `postcss.config.mjs` | Stack spec | P0 |
| `env.d.ts` (all env var types) | System 19 | P0 |
| `lib/prisma.ts` (Prisma client singleton) | Stack spec | P0 |
| `lib/supabase.ts` (Supabase client) | Stack spec | P0 |
| `lib/constants.ts` (all platform constants) | D2 + canonical | P0 |
| `proxy.ts` (active middleware, 350 lines) | Hard constraint | P0 |
| `vercel.json` (19 cron routes) | D8 + Rule 12 | P0 |
| `.github/workflows/ci.yml` (lint enforced) | D11 | P1 |
| `prisma/schema.prisma` (136 models, 70 enums) | Stack spec | P0 |
| `prisma/seed.ts` (verse library, market coverage) | System 25, System 15 | P1 |
| `components.json` (shadcn/ui config) | Stack spec | P0 |
| `pnpm-lock.yaml` | Stack spec | P0 |
| `app/layout.tsx` (root layout) | Stack spec | P0 |
| `app/error.tsx` (root error boundary) | Spec H | P1 |
| `app/loading.tsx` (root loading) | Spec H | P1 |
| `app/not-found.tsx` | Spec | P1 |
| `app/maintenance/page.tsx` (static) | Gap Group 9 note | P1 |

---

#### 2. PUBLIC WEBSITE — ALL MISSING (21 pages)

| Route | V4 Reference | Notes |
|---|---|---|
| `/` | Homepage | Hero, CTAs, testimonials, ChatWidget, QualificationEstimateStrip, live stats banner (F14A) |
| `/how-it-works` | Public website | Full illustrated buyer journey |
| `/buyers` or `/for-buyers` | Gap Group 1.1 | NEW — full buyer acquisition page |
| `/for-dealers` | Gap Group 1.5 | Rebuild required (was 367-byte stub) |
| `/for-affiliates` | Gap Group 1.2 | NEW — full affiliate acquisition page |
| `/pricing` | Public scope | Platform pricing page |
| `/about` | Public scope | About page |
| `/contact` | Public scope | Contact form |
| `/feedback` | Gap Group 1.4 | Functional feedback form with confirmation state |
| `/refinance` | Gap Group 1.7 + System 14 | Eligibility form, partner redirect, TCPA |
| `/inventory` | Gap Group 1.8 + System 15 | Premium public vehicle browsing |
| `/trust` | Gap Group 1.9 + Feature 14 | NEW — platform trust/credibility page |
| `/hope` | System 25 | Faith & Encouragement — 4 required sections |
| `/dealer-application` | Gap Group 1.6 | Verify form + submission + admin routing |
| `/legal/terms` | Legal | Full terms of service |
| `/legal/privacy` | Legal | Privacy policy |
| `/legal/prequal-consent` | Legal | FCRA consent |
| `/legal/dealer-terms` | Legal | Dealer-specific terms |
| `/legal/affiliate-terms` | Gap Group 6.1 | NEW |
| `/legal/cookie-policy` | Gap Group 6.2 | NEW |
| `/maintenance` | Gap Group 9 note | Static file — NOT a Next.js page |

**Redirects required:**
- `/terms` → `/legal/terms`
- `/privacy` → `/legal/privacy`

---

#### 3. AUTH PAGES — ALL MISSING (9 pages)

| Route | V4 Reference | Notes |
|---|---|---|
| `/auth/signin` | Auth system | "Incorrect email or password" only — no enumeration |
| `/auth/signup` | Auth system | Redirect authenticated users immediately |
| `/auth/forgot-password` | Auth system | Identical success message whether email exists or not |
| `/auth/reset-password` | Auth system | Token-gated reset |
| `/auth/accept-terms` | Auth system | Enforced by proxy.ts — not voluntary navigation |
| `/auth/verify-email` | Auth system | Email verification flow |
| `/admin/auth/signin` | Admin auth (separate system) | Separate from buyer/dealer JWT auth |
| `/admin/auth/setup-mfa` | Admin auth | RFC 6238 TOTP via `otpauth` library |
| `/admin/auth/verify-mfa` | Admin auth | OTP auto-advance + paste support; recovery codes gate |

---

#### 4. BUYER PORTAL — ALL MISSING (41 pages)

| Route | V4 Reference | Notes |
|---|---|---|
| `/buyer/dashboard` | Buyer portal | Live auction strip (F1), DealWallet (F16), nudge banners (F6), profile completeness (F21) |
| `/buyer/onboarding` | System 1 | Multi-step: profile, preferences, consent |
| `/buyer/prequal` | System 1 | iPredict soft pull with IBV; OFAC auto-escalate |
| `/buyer/prequal/result` | System 1 | Score tier display; raw scores ADMIN-ONLY; FCRA adverse action on DECLINED |
| `/buyer/prequal/pending` | System 1 | Polling state |
| `/buyer/prequal/declined` | System 1 | FCRA adverse action language + MicroBilt contact REQUIRED |
| `/buyer/prequal/external` | Gap Group 2.2 + System 4B | Full form: lender, amount, APR, term, expiry, OWASP upload |
| `/buyer/prequal/manual-preapproval/status` | System 4B | 60s polling, all states, rejection reason, CTAs |
| `/buyer/search` | System 2 | Budget-gated, natural language, 280px filter panel fixed, Matched for You (F S2-ENH) |
| `/buyer/inventory/[vehicleId]` | System 15 ENH | Full spec page: gallery, price history, deal rating, shortlist CTA |
| `/buyer/shortlist` | System 2 | Max 5, readiness badges, comparison drawer (F7), smart replacement modal |
| `/buyer/deposit` | System 3 | Stripe inline checkout (NOT redirect), pre-auction dealer preview |
| `/buyer/deposit/success` | System 3 | Post-payment confirmation |
| `/buyer/auctions` | System 3 + canonical | Buyer's auction list |
| `/buyer/auction/[auctionId]` | System 3 + F1 | Live countdown, offer count, engagement signals |
| `/buyer/auction/[auctionId]/offers` | System 4 + F2 | Side-by-side comparison cards, loan term toggle, selection confirmation |
| `/buyer/deal` | System 5 | Deal overview |
| `/buyer/deal/financing` | System 5 + F15 | Three paths, live calculator, term slider; maxOtdAmountCents READ-ONLY |
| `/buyer/deal/payment` | System 6 | Concierge fee payment confirmation |
| `/buyer/deal/wallet` | Feature 16 | Read-only DealWallet panel |
| `/buyer/deal/[dealId]/complete` | Feature 19 | Post-close: receipt, testimonial, referral CTA |
| `/buyer/insurance` | System 7 | Quote flow, bind, external proof; mock gated in production |
| `/buyer/contract-shield` | System 8 + F9 | Buyer plain-language Contract Shield summary |
| `/buyer/contracts` | System 8, 9 | Contract list |
| `/buyer/contracts/[contractId]` | Gap Group 2.3 | Contract detail — MISSING |
| `/buyer/esign` | System 9 | DocuSign envelope rendering |
| `/buyer/pickup` | System 10 | QR pickup scheduling and check-in |
| `/buyer/notifications` | Gap Group 2.1 + F13 | Unified notification inbox |
| `/buyer/messages` | System 20 | Buyer/dealer messaging with anti-circumvention |
| `/buyer/documents` | System 21 | Document management, OWASP upload |
| `/buyer/requests` | System 4C | Request a Car list; buyer-facing status labels |
| `/buyer/requests/new` | System 4C | Submission form; auth required, prequal NOT required |
| `/buyer/requests/[requestId]` | System 4C | Status tracker, buyer updates, cancel |
| `/buyer/requests/[requestId]/offer` | System 4C | Offer review and respond (MISSING) |
| `/buyer/activity` | Feature 24 | Plain-language event timeline |
| `/buyer/referral` | Feature 25 | Referral link, stats, milestone tracker, QR, share tools |
| `/buyer/searches` | Feature 20 | Saved searches management (max 3) |
| `/buyer/trade-in` | System 18 | Trade-in submission |
| `/buyer/profile` | Buyer portal | Profile management |
| `/buyer/settings` | Buyer portal | Account settings |
| `/buyer/demo` | Gap Group 9.2 | Environment-gated or removed |

**Journey Navigator (F3):** Injected into `app/buyer/layout.tsx` — SUPPRESSED on all `/buyer/requests/*` routes.

---

#### 5. DEALER PORTAL — ALL MISSING (27 pages)

| Route | V4 Reference | Notes |
|---|---|---|
| `/dealer/dashboard` | Dealer portal | Single DEALER role — full access to all sections |
| `/dealer/onboarding` | System 12 | Dealer account setup |
| `/dealer/onboarding/fast-track` | ENH-7 | Fast-track for buyer-shortlisted Lane 2 vehicles |
| `/dealer/inventory` | System 12, 15 | Inventory list with aging badges, quality scores |
| `/dealer/inventory/[id]` | System 15 ENH | Detail with analytics panel (views, shortlist rate, auction rate) |
| `/dealer/inventory/feed-setup` | ENH-1 | DMS feed setup: URL, format, refresh interval |
| `/dealer/auctions` | System 4 | Auction invitation list |
| `/dealer/auctions/[auctionId]` | System 4 | Auction detail, offer submission |
| `/dealer/auctions/[auctionId]/insights` | Feature 22 | Post-auction loss insights (anonymized, losing dealers only) |
| `/dealer/quick-offer/[token]` | Feature 10 | Guided OTD form with live math, junk fee warnings |
| `/dealer/offers` | System 4 | Offer list |
| `/dealer/offers/[offerId]` | System 4 | Offer detail, revision CTA within window |
| `/dealer/offers/new` | System 4 + F10 | Quick-offer builder |
| `/dealer/leads` | System 12 | Dealer leads |
| `/dealer/leads/[leadId]` | System 12 | Lead detail |
| `/dealer/contracts/upload` | System 8 ENH | Pre-upload checklist with rule thresholds |
| `/dealer/contracts` | System 8 | Contract list |
| `/dealer/documents` | System 21 | Documents management |
| `/dealer/financing` | Gap Group 3.5 | Finance manager tools |
| `/dealer/scorecard` | Gap Group 3.3 + F4 | Performance scorecard: tier, metrics, 90-day trend |
| `/dealer/analytics` | Gap Group 3.4 | Analytics dashboard (same scorecard service) |
| `/dealer/notifications` | Gap Group 3.2 + F13 | Notification center |
| `/dealer/messages` | System 20 | Dealer/buyer messaging |
| `/dealer/invite/claim` | Gap Group 3.6 | Token-based dealer invitation acceptance |
| `/dealer/profile` | Dealer portal | Profile management |
| `/dealer/settings` | Dealer portal | Account settings |

**CRITICAL RULE:** Dealer account = single DEALER role. No sub-roles. No permission filtering. All portal sections accessible to authenticated dealer.

---

#### 6. AFFILIATE PORTAL — ALL MISSING (12 pages)

| Route | V4 Reference | Notes |
|---|---|---|
| `/affiliate/portal/dashboard` | Affiliate portal | Canonical structure |
| `/affiliate/portal/referrals` | Affiliate portal | Referral list + network tree (F8) |
| `/affiliate/portal/earnings` | System 11 | Commission earnings |
| `/affiliate/portal/payouts` | System 11 | Payout history and requests |
| `/affiliate/portal/network` | Feature 8 | Referral network tree visualization |
| `/affiliate/portal/income-calculator` | Feature 8 | Income projection calculator + shareable card |
| `/affiliate/portal/notifications` | Gap Group 5.1 + F13 | Notification center |
| `/affiliate/portal/compliance` | Gap Group 5.2 | Compliance reminders, disclosure status |
| `/affiliate/portal/profile` | Affiliate portal | Profile management |
| `/affiliate/portal/settings` | Affiliate portal | Account settings |
| `/affiliate/portal/resources` | Affiliate portal | Marketing resources |
| `/affiliate/register` | Affiliate portal | Affiliate registration |

**Redirect rules required (all `/affiliate/*` top-level authenticated routes → `/affiliate/portal/*` canonical):**
- `/affiliate/dashboard` → `/affiliate/portal/dashboard`
- `/affiliate/referrals` → `/affiliate/portal/referrals`
- etc. (full list to be enumerated in Phase B)

---

#### 7. ADMIN CONSOLE — ALL MISSING (62 pages)

| Route | V4 Reference | Notes |
|---|---|---|
| `/admin/dashboard` | System 13 | Risk widget (F17), activity widget (F18), pipeline KPI (F23) |
| `/admin/buyers` | System 13 | Buyer list with risk tier |
| `/admin/buyers/[buyerId]` | System 13 | Buyer detail with impersonation |
| `/admin/dealers` | System 12, 13 | Dealer list with scorecard tier |
| `/admin/dealers/[dealerId]` | System 12, 13 | Dealer detail with scorecard |
| `/admin/affiliates` | System 11, 13 | Affiliate list |
| `/admin/affiliates/[affiliateId]` | System 11 | Affiliate detail |
| `/admin/auctions` | System 13 | Auction oversight |
| `/admin/auctions/[auctionId]` | System 13 | Auction detail + extend action |
| `/admin/deals` | System 13 | Deal list with risk badges |
| `/admin/deals/[dealId]` | System 13 | Deal detail with factor panel (F17) |
| `/admin/deals/[dealId]/esign` | Gap Group 4.6 | Per-deal signing oversight |
| `/admin/deals/[dealId]/pickup` | Gap Group 4.7 | Per-deal pickup management |
| `/admin/offers` | System 13 | Offer oversight |
| `/admin/pickups` | Gap Group 4.1 | Platform-wide pickup management |
| `/admin/esign` | Gap Group 4.2 | E-sign oversight — resend, void, exceptions |
| `/admin/queues` | Gap Group 4.3 + F11 | Unified exception queue — 8 tabs |
| `/admin/requests` | System 4C | Admin intake queue (tabs: New/Active/Offer Out/Closed) |
| `/admin/requests/[requestId]` | System 4C | Research log, due diligence checkpoints, offer creation (gated) |
| `/admin/requests/analytics` | System 4C (4C.13) | System 4C analytics |
| `/admin/external-preapprovals` | System 4B | External pre-approval review list |
| `/admin/external-preapprovals/[submissionId]` | System 4B | Submission detail + approve/reject |
| `/admin/inventory` | System 15 | Inventory list with lane badges |
| `/admin/inventory/[id]` | System 15 | Inventory item detail |
| `/admin/inventory/markets` | System 15 | Market Coverage CRUD |
| `/admin/inventory/search-tool` | System 15 | On-demand search (5 adapters + custom) |
| `/admin/inventory/dealer-discovery` | System 15 | Dealer Discovery workflow |
| `/admin/inventory/coverage-map` | ENH-12 | Coverage gap heat map (Leaflet.js — no Google Maps) |
| `/admin/inventory/demand-gap` | ENH-16 | Segment demand vs. supply report |
| `/admin/inventory/contributions` | ENH-19 | Dealer contribution analytics |
| `/admin/messages` | System 20 | Admin messaging oversight |
| `/admin/documents` | System 21 | Document management |
| `/admin/contracts` | System 8 | Contract list |
| `/admin/contract-shield` | System 8 | Contract Shield management |
| `/admin/contract-shield/rules` | System 8 ENH | ContractScanRule CRUD |
| `/admin/reports` | System 13 | Reports hub |
| `/admin/reports/funnel` | Feature 5 | Deep conversion funnel (rebuild from 51-line stub) |
| `/admin/reports/affiliate` | Gap Group 4.5 | Affiliate performance report |
| `/admin/reports/risk` | Feature 17 | Deal Risk Intelligence aggregated view |
| `/admin/reports/pipeline` | Feature 23 | Revenue Pipeline Forecasting |
| `/admin/activity` | Feature 18 | Platform Live Activity Feed + SSE stream |
| `/admin/testimonials` | Feature 19 | Testimonial review queue |
| `/admin/referral-milestones` | Feature 25 | Referral milestone reward management |
| `/admin/refinance` | System 14 | Refinance hub |
| `/admin/refinance/applications` | System 14 | Application list |
| `/admin/refinance/[applicationId]` | System 14 | Application detail |
| `/admin/refinance/partners` | System 14 | Partner management |
| `/admin/refinance/analytics` | System 14 | Refinance analytics |
| `/admin/refinance/settings` | System 14 | Refinance settings |
| `/admin/refinance/compliance` | System 14 | TCPA compliance |
| `/admin/seo` | System 22 | SEO hub |
| `/admin/seo/pages` | System 22 | Page metadata CMS |
| `/admin/seo/health` | System 22 | Health scores |
| `/admin/seo/keywords` | System 22 | Keyword management |
| `/admin/seo/schema` | System 22 | JSON-LD schema editor |
| `/admin/ai` | System 16 | AI management panel (was 659-byte stub) |
| `/admin/settings` | System 13 | Platform settings including nudge thresholds, Best Price weights |
| `/admin/support` | System 13 | Support with impersonation + notes |
| `/admin/faith-content` | System 25 | Faith content management hub |
| `/admin/faith-content/verses` | System 25 | Verse library and page assignments |
| `/admin/faith-content/messages` | System 25 | Encouragement messages |
| `/admin/faith-content/hope` | System 25 | Hope page CMS |

---

#### 8. API ROUTES — ALL MISSING (Target: 467)

API routes are organized by domain below. All must be: Zod-validated, RBAC-enforced (middleware + route handler level), response shape `{ success: true, data: ... }` / `{ error: { code, message }, correlationId }`.

**Public APIs (no auth required):**
| Route | Method | V4 Reference |
|---|---|---|
| `/api/public/platform-stats` | GET | Feature 14A |
| `/api/public/inventory/search` | GET | System 15 |
| `/api/faith/verse/[pageKey]` | GET | System 25 |
| `/api/faith/encouragement/[placement]` | GET | System 25 |
| `/api/inventory/confirm-availability/[token]` | GET | ENH-2 (single-use, 48h TTL) |

**Auth APIs:**
| Route | Method | V4 Reference |
|---|---|---|
| `/api/auth/signup` | POST | Auth system |
| `/api/auth/signin` | POST | Auth system |
| `/api/auth/signout` | POST | Auth system |
| `/api/auth/forgot-password` | POST | Auth system |
| `/api/auth/reset-password` | POST | Auth system |
| `/api/auth/verify-email` | POST | Auth system |
| `/api/auth/refresh` | POST | Auth system |
| `/api/admin/auth/signin` | POST | Admin auth (separate) |
| `/api/admin/auth/setup-mfa` | POST | Admin MFA |
| `/api/admin/auth/verify-mfa` | POST | Admin MFA |
| `/api/admin/auth/recovery` | POST | Admin recovery codes |

**Stripe Webhooks:**
| Route | Method | V4 Reference |
|---|---|---|
| `/api/webhooks/stripe` | POST | D3 — idempotency check FIRST |
| `/api/webhooks/docusign` | POST | System 9 |
| `/api/webhooks/microbilt` | POST | System 1 |

**Cron Routes (all 19 — CRON_SECRET Bearer + Vercel IP allowlist):**
| Route | Schedule | V4 Reference |
|---|---|---|
| `/api/cron/auction-close` | `*/5 * * * *` | System 3 |
| `/api/cron/holds` | `*/10 * * * *` | System 3 |
| `/api/cron/affiliates` | `0 * * * *` | System 11 |
| `/api/cron/contract-shield` | `0 * * * *` | System 8 |
| `/api/cron/sessions` | `0 */6 * * *` | Auth system |
| `/api/cron/prequal-ibv-reminders` | `0 8 * * *` | System 1 |
| `/api/cron/prequal-stale-cleanup` | `0 2 * * *` | System 1 |
| `/api/cron/prequal-sla-escalation` | `0 9 * * *` | System 1 |
| `/api/cron/prequal-message-delivery` | `0 */4 * * *` | System 1 |
| `/api/cron/prequal-purge` | `0 3 * * *` | System 1 |
| `/api/cron/inventory-sync-full` | `0 */6 * * *` | System 15 |
| `/api/cron/inventory-sync-priority` | `0 * * * *` | System 15 |
| `/api/cron/inventory-stale-sweep` | `*/30 * * * *` | System 15 |
| `/api/cron/analytics-snapshot` | `0 1 * * *` | System 13, F20 |
| `/api/cron/health-check` | `*/5 * * * *` | System 23 |
| `/api/cron/sla-check` | `*/30 * * * *` | System 13 |
| `/api/cron/trust-check` | `0 * * * *` | System 24 |
| `/api/cron/workflow-automation` | `*/5 * * * *` | F6, F17, System 4C |
| `/api/cron/faith-verse-rotation` | `1 6 * * 1` | System 25 (Mon 12:01 AM CST) |

**Buyer APIs (selected critical routes — full list in V4 Section E):**
- All buyer prequal, search, shortlist, auction, deal, financing, fee, insurance, contract, esign, pickup routes
- `/api/buyer/auctions/[auctionId]/live-status` (F1)
- `/api/buyer/auctions/[auctionId]/best-price/term-calc` (F2)
- `/api/buyer/journey-status` (F3)
- `/api/buyer/notifications`, mark-read, unread-count (F13)
- `/api/buyer/contract-shield/[dealId]` (F9)
- `/api/buyer/requests` GET/POST (System 4C)
- `/api/buyer/requests/[requestId]` GET, cancel, offer GET/respond (System 4C)
- `/api/buyer/searches` CRUD (F20)
- `/api/buyer/activity` GET (F24)
- `/api/buyer/referral` GET/POST (F25)
- `/api/buyer/profile/completeness` GET (F21)
- `/api/buyer/inventory/[vehicleId]` GET (System 15 ENH)
- `/api/buyer/inventory/matched` GET (System 15 ENH)
- `/api/buyer/shortlist/readiness` GET (System 2 ENH)
- `/api/buyer/inventory/preview-invitation-pool` GET (System 3 ENH)
- `/api/buyer/auctions/[auctionId]/retry` POST (System 3 ENH)
- `/api/buyer/deals/[dealId]/wallet` GET (F16)
- `/api/buyer/deals/[dealId]/receipt` GET (F19)
- `/api/buyer/testimonials` POST (F19)

**Dealer APIs (selected critical routes):**
- All dealer inventory, auction, offer, lead, contract, document routes
- `/api/dealer/scorecard` GET + history GET (F4)
- `/api/dealer/notifications`, mark-read, unread-count (F13)
- `/api/dealer/offers/competitiveness-check` GET (F10)
- `/api/dealer/offers/[offerId]/revise` PATCH (System 4 ENH)
- `/api/dealer/auctions/[auctionId]/insights` GET (F22)
- `/api/dealer/inventory/feed` CRUD + test + resync (ENH-1)
- `/api/dealer/inventory/[id]/analytics` GET (System 15 ENH)

**Affiliate APIs:**
- All affiliate referral, commission, payout, network routes
- `/api/affiliate/network` GET (F8)
- `/api/affiliate/notifications` GET (F13)

**Admin APIs (selected critical routes — see V4 Section E for full list):**
- All admin buyer, dealer, affiliate, auction, deal, offer, inventory, reports routes
- `/api/admin/requests` GET + `[requestId]` full CRUD (System 4C)
- All System 4C admin APIs (notes, research, due-diligence, offer lifecycle)
- `/api/admin/queues` + `[queueType]` + resolve/assign/escalate (F11)
- `/api/admin/pickups` full CRUD + regenerate-qr (Gap)
- `/api/admin/esign` + resend + void (Gap)
- `/api/admin/reports/funnel` GET (F5)
- `/api/admin/reports/affiliate` GET (Gap)
- `/api/admin/reports/risk` GET (F17)
- `/api/admin/reports/pipeline` GET (F23)
- `/api/admin/activity` GET + SSE stream (F18)
- `/api/admin/faith/verses` CRUD + bulk import (System 25)
- `/api/admin/faith/assignments` GET/POST (System 25)
- `/api/admin/faith/messages` CRUD (System 25)
- `/api/admin/faith/hope-content` GET/PATCH (System 25)
- `/api/admin/inventory/markets` CRUD (System 15)
- `/api/admin/inventory/search-tool/run` + ingest + history (System 15)
- `/api/admin/inventory/dealer-discovery` GET + invite/contact/decline (System 15)
- `/api/admin/inventory/bootstrap` POST (System 15 deploy hook)
- `/api/admin/inventory/coverage-map` GET (ENH-12)
- `/api/admin/inventory/demand-gap` GET (ENH-16)
- `/api/admin/inventory/contributions` GET (ENH-19)
- `/api/admin/best-price/weights` GET/POST + history + simulate (System 4 ENH)
- `/api/admin/contract-shield/rules` CRUD + history (System 8 ENH)
- `/api/admin/deals/[dealId]/risk` GET (F17)
- `/api/admin/testimonials` GET + `[id]` approve/reject (F19)
- `/api/admin/referral-milestones` GET + `[id]/pay` POST (F25)
- `/api/admin/ai/briefing` POST (System 16 ENH)
- `/api/admin/support/impersonate` POST + notes (System 22)

---

#### 9. SERVICE FILES — ALL MISSING (Target: 119)

All service files in `lib/services/` to be built:

**Core services:**
- `lib/services/auth/` — buyer/dealer auth, admin auth, session management
- `lib/services/prequal/` — MicroBilt iPredict integration, decision engine, IBV
- `lib/services/auction/` — auction lifecycle, dealer invitation scoring, live-status
- `lib/services/deal/` — deal state machine, deal-risk.service.ts (F17)
- `lib/services/offer/` — offer submission, validation, best-price, revision
- `lib/services/best-price/` — ranking algorithm, weight config, simulation
- `lib/services/deposit/` — Stripe deposit, webhook handler
- `lib/services/insurance/` — quote, bind, external proof, mock gated
- `lib/services/contract-shield/` — scan pipeline, rules engine, violation tracking
- `lib/services/esign/` — DocuSign JWT auth, envelope lifecycle
- `lib/services/pickup/` — QR generation (local `qrcode` lib), scheduling, check-in
- `lib/services/affiliate/` — referral attribution, commission walk (3 levels only), payout
- `lib/services/dealer/` — onboarding, scorecard, analytics
- `lib/services/inventory/` — orchestrator, lane assignment, search, market coverage
- `lib/services/inventory/adapters/` — IInventoryAdapter + 5 built-in adapters + custom
- `lib/services/nudge/` — nudge.service.ts (F6)
- `lib/services/vehicle-request/` — System 4C (6 service files)
- `lib/services/messaging/` — anti-circumvention, threads, monitoring
- `lib/services/notifications/` — all trigger points (15 buyer, 9 dealer, affiliate)
- `lib/services/seo/` — metadata management, health scoring
- `lib/services/refinance/` — System 14 eligibility, partner redirect, TCPA
- `lib/services/analytics/` — funnel, cohorts, pipeline forecasting
- `lib/services/admin/` — revenue-pipeline.service.ts (F23), briefing
- `lib/services/ai/` — Groq integration, 7 agents, context builder, memory
- `lib/services/faith/` — verse rotation, assignment, encouragement messages
- `lib/services/email/` — Resend integration, EmailSendLog idempotency, all templates
- `lib/services/activity/` — event ledger reads for F18, F24

**Constants and utilities:**
- `lib/constants.ts` — DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_CENTS, AUCTION_DURATION_HOURS, MAX_SHORTLIST_ITEMS, COMMISSION_RATES, Contract Shield thresholds, JWT TTL
- `lib/ai/kill-switch.ts` — AI kill switch
- `lib/ai/context-builder.ts` — proactive context injection

---

#### 10. COMPONENTS — ALL MISSING (Target: 173)

Critical component list (non-exhaustive):

**Layout components:**
- `components/public/PublicNav.tsx`
- `components/public/PublicFooter.tsx` (faith strip toggle)
- `components/buyer/BuyerNav.tsx`
- `components/dealer/DealerNav.tsx`
- `components/affiliate/AffiliateNav.tsx`
- `components/admin/AdminSidebar.tsx`
- `components/admin/AdminNav.tsx`

**Feature components:**
- `components/buyer/journey-navigator.tsx` — F3 (injected into buyer layout)
- `components/buyer/offer-comparison-panel.tsx` — F2
- `components/buyer/vehicle-comparison-panel.tsx` — F7 (Sheet overlay)
- `components/buyer/nudge-banner.tsx` — F6
- `components/buyer/DealWallet.tsx` — F16 (read-only)
- `components/buyer/ProfileCompletenessArc.tsx` — F21
- `components/shared/ChatWidget.tsx` — System 16 AI concierge
- `components/public/QualificationEstimateStrip.tsx`
- `components/public/FaithVerseModule.tsx` — System 25 (graceful fallback)
- `components/public/FaithFooterStrip.tsx` — System 25
- `components/inventory/VehicleCard.tsx` — Lane 1=green, Lane 2=blue, Lane 3=gray trust chips
- `components/inventory/VehicleGallery.tsx`
- `components/auction/CountdownTimer.tsx` — client-side from `endsAt` timestamp
- `components/auction/LiveOfferStrip.tsx`
- `components/admin/RiskBadge.tsx` — F17
- `components/admin/ActivityFeed.tsx` — F18
- `components/dealer/DealerInsightsPanel.tsx` — F22

---

#### 11. DATABASE — ALL MISSING (Target: 136 models, 70 enums, 4,725-line schema)

**All models to be created (selected critical list):**

| Model | V4 Reference |
|---|---|
| `User`, `Buyer`, `Dealer`, `Affiliate`, `Admin` | Auth, all portals |
| `PreQualification` | System 1 — no `.status` field; check `expiresAt > now()` |
| `Vehicle`, `InventoryItem`, `InventorySource`, `InventorySyncRun` | System 15 |
| `MarketCoverage`, `DealerDiscovery`, `AdminInventorySearchRun` | System 15 |
| `Shortlist`, `ShortlistItem` | System 2 |
| `Deposit`, `PaymentProviderEvent` | System 3, D3 |
| `Auction` | System 3 — with `originalAuctionId` FK for re-auction |
| `AuctionInvitation` | System 3 — with dealer scoring |
| `Offer` | System 4 — with `version`, `originalOfferId` |
| `BestPriceWeightConfig` | System 4 ENH |
| `Deal` | System 5 — with `riskScore`, `riskTier` |
| `Financing` | System 5 |
| `Insurance` | System 7 — `InsuranceStatus` enum normalized |
| `ContractScan`, `ContractScanRule` | System 8 ENH |
| `ViolationPatternRecord` | System 8 ENH |
| `ESignEnvelope` | System 9 |
| `Pickup` | System 10 |
| `Commission`, `AffiliateReferral` | System 11 |
| `Notification` | Feature 13 |
| `NudgeEvent` | Feature 6 |
| `DealerScorecardSnapshot` | Feature 4 |
| `PlatformStatSnapshot` | Feature 14 |
| `VehicleRequest`, `VehicleRequestResearchLog` | System 4C |
| `VehicleRequestDueDiligenceCheckpoint` | System 4C — gate enforcement |
| `VehicleRequestOffer` | System 4C |
| `VehicleRequestEvent` | System 4C — immutable audit trail |
| `VehicleRequestBuyerUpdate` | System 4C |
| `VerseLibrary` | System 25 — 468 NKJV verses |
| `VersePageAssignment` | System 25 — rotation history |
| `EncouragementMessage` | System 25 |
| `HopePageContent` | System 25 |
| `SavedSearch` | Feature 20 — max 3 per buyer |
| `Testimonial` | Feature 19 |
| `ReferralMilestone` | Feature 25 |
| `AiConversationContext` | System 16 ENH |
| `AdminBriefing` | System 16 ENH |
| `ExternalPreApproval` | System 4B |
| `RefinanceApplication` | System 14 |
| `SeoPageConfig` | System 22 |
| `AdminSupportNote` | System 13 |
| `EmailSendLog` | Email idempotency |

**Canonical enum: `InsuranceStatus`**
`NOT_STARTED, QUOTE_REQUESTED, QUOTE_RECEIVED, POLICY_SELECTED, POLICY_BOUND, EXTERNAL_UPLOADED, VERIFIED, FAILED`

**PreQualification note:** `rawResponse` field must be AES-256-GCM encrypted at rest. No `.status` field exists on this model. Gating uses `expiresAt > now()` only.

---

### STUBS — REBUILD REQUIRED

**None in this workspace.** The existing blank scaffold is not a stub — it is an incompatible project. There are no AutoLenis stubs to rebuild; all items above are new constructions.

---

### DEFECTS — STATUS FOR NEW BUILD (Build Correctly from Scratch)

Since this is a ground-up new build, defects D1–D11 are implementation requirements — not fixes to existing broken code. Each must be built correctly from the first commit.

| Defect | Description | Status | Required Implementation |
|---|---|---|---|
| D1 | Auction gating uses non-existent `.status` field | **BUILD CORRECTLY** | Use `PreQualification exists AND expiresAt > now()` — never check `.status` |
| D2 | Commission rate discrepancy | **BUILD CORRECTLY** | `lib/constants.ts` ONLY — `{ LEVEL_1: 0.15, LEVEL_2: 0.03, LEVEL_3: 0.02 }` — no inline rates anywhere |
| D3 | Stripe webhook no duplicate check | **BUILD CORRECTLY** | Check `PaymentProviderEvent.eventId` FIRST — return 200 immediately on duplicate |
| D4 | InsuranceStatus enum conflicts | **BUILD CORRECTLY** | Single canonical enum — `NOT_STARTED, QUOTE_REQUESTED, QUOTE_RECEIVED, POLICY_SELECTED, POLICY_BOUND, EXTERNAL_UPLOADED, VERIFIED, FAILED` |
| D5 | Insurance mock no production gate | **BUILD CORRECTLY** | Gate mock behind `NODE_ENV !== 'production'` — default to external proof upload path in production |
| D6 | Custom TOTP implementation | **BUILD WITH LIBRARY** | Use `otpauth` npm library for RFC 6238 TOTP — not a custom reimplementation |
| D7 | QR code external service dependency | **BUILD CORRECTLY** | Use `qrcode` npm package — no external API calls — ever |
| D8 | vercel.json cron configuration | **BUILD COMPLETE** | All 19 cron routes in vercel.json — none missing |
| D9 | Dual database access patterns | **DESIGN CORRECTLY** | Explicit pattern: Prisma for all standard models; typed Supabase queries for `PreQualification` raw columns — no `as any` casts |
| D10 | No explicit CORS policy | **BUILD CORRECTLY** | Explicit CORS in `next.config.mjs` — production policy stricter than development |
| D11 | Lint not enforced in CI | **BUILD CORRECTLY** | `.github/workflows/ci.yml` with `pnpm lint` — no `continue-on-error: true` |

---

### AGENT FILE REVIEW

**`app/api/admin/offers/route.ts`** — **ABSENT**

This file does not exist in the workspace. It has not been created yet. When built in Phase C (Admin Console), it must comply with:
- RBAC: Admin-role check at both middleware (proxy.ts) and route handler level
- Service layer: All offer business logic must go through `offer.service.ts` — no inline logic in the route
- Prisma schema: Use canonical field names from schema (e.g., `[offerId]` param, not `[id]`)
- Response shape: `{ success: true, data: ... }` on success, `{ error: { code, message }, correlationId }` on error
- Zod validation: Full request body validation

---

### VERCEL.JSON — CRON STATUS

**0 / 19 registered. `vercel.json` does not exist in workspace.**

All 19 required cron routes are missing:

| Cron Route | Schedule | Status |
|---|---|---|
| `/api/cron/auction-close` | `*/5 * * * *` | MISSING |
| `/api/cron/holds` | `*/10 * * * *` | MISSING |
| `/api/cron/affiliates` | `0 * * * *` | MISSING |
| `/api/cron/contract-shield` | `0 * * * *` | MISSING |
| `/api/cron/sessions` | `0 */6 * * *` | MISSING |
| `/api/cron/prequal-ibv-reminders` | `0 8 * * *` | MISSING |
| `/api/cron/prequal-stale-cleanup` | `0 2 * * *` | MISSING |
| `/api/cron/prequal-sla-escalation` | `0 9 * * *` | MISSING |
| `/api/cron/prequal-message-delivery` | `0 */4 * * *` | MISSING |
| `/api/cron/prequal-purge` | `0 3 * * *` | MISSING |
| `/api/cron/inventory-sync-full` | `0 */6 * * *` | MISSING |
| `/api/cron/inventory-sync-priority` | `0 * * * *` | MISSING |
| `/api/cron/inventory-stale-sweep` | `*/30 * * * *` | MISSING |
| `/api/cron/analytics-snapshot` | `0 1 * * *` | MISSING |
| `/api/cron/health-check` | `*/5 * * * *` | MISSING |
| `/api/cron/sla-check` | `*/30 * * * *` | MISSING |
| `/api/cron/trust-check` | `0 * * * *` | MISSING |
| `/api/cron/workflow-automation` | `*/5 * * * *` | MISSING |
| `/api/cron/faith-verse-rotation` | `1 6 * * 1` (Mon 12:01 AM CST) | MISSING |

---

## MISSING SYSTEMS LIST

All 27 platform systems are absent from this workspace. Build required for each.

| System | Name | Scope | Dependencies |
|---|---|---|---|
| System 1 | Buyer Onboarding and Pre-Qualification | MicroBilt iPredict, IBV, FCRA, OFAC auto-escalate, AES-256-GCM encryption | MicroBilt credentials |
| System 2 | Search and Shortlist | Budget-gated search, natural language (Groq), relevance scoring, shortlist readiness, max 5 | System 1, System 15 |
| System 3 | Deposit and Auction Creation | Stripe deposit, dealer invitation scoring engine, capacity throttling, auction extension, re-auction | Stripe, System 1, System 2 |
| System 4 | Dealer Bidding and Best Price | Offer submission, validation, APR flag, BestPriceWeightConfig, simulation, offer revision | System 3 |
| System 4B | External Pre-Qualification | Lender form, OWASP upload, admin review, approval flow | System 1 |
| System 4C | Request a Car (Standalone Module) | 6 service files, 7 models, 20+ API routes, due diligence gate, audit trail | None (standalone) |
| System 5 | Selected Deal and Financing | Deal creation, 3 financing paths, scenario tool | System 4 |
| System 6 | Concierge Fee | $499 flat fee, deposit credit, Stripe card path, loan inclusion | Stripe, System 5 |
| System 7 | Insurance | Quote/bind flow, external proof, mock gated in production | System 5, Insurer API (future) |
| System 8 | Contract Shield | ContractScanRule engine, fix list with actionable guidance, violation patterns, contract diff | System 5 |
| System 9 | E-Sign (DocuSign) | JWT auth, envelope creation, webhook, archive | DocuSign credentials |
| System 10 | Pickup and QR Delivery | `qrcode` npm lib, scheduling, check-in, completion | System 9 |
| System 11 | Affiliate Engine | Referral attribution, 3-level commission (15/3/2%), payout, no self-referral, reversal on refund | Stripe, System 6 |
| System 12 | Dealer Operations | Onboarding, inventory pipeline, single DEALER role | None |
| System 13 | Admin Operations | All oversight pages, queue command center, funnel analytics | All systems |
| System 14 | Refinance | Eligibility form, partner redirect, TCPA, 7 admin sub-pages | OpenRoad partner |
| System 15 | Inventory (3-Lane Auto-Sourcing) | 5 adapters, orchestrator, Lane 1/2/3, market coverage, 20 ENH items | None (public web fetch) |
| System 16 | AI Concierge | Groq only (llama-3.3-70b-versatile), 7 agents, kill switch, cross-session memory | Groq API key |
| System 17 | Vehicle Request Sourcing | No-inventory fallback triggered by search (NOT same as System 4C) | System 2 |
| System 18 | Trade-In | Buyer form, dealer visibility, admin overview | System 3 |
| System 19 | Environment Variables | `env.d.ts`, all vars typed, startup validation | All secrets |
| System 20 | Messaging | Buyer/dealer threads, anti-circumvention, admin monitoring | All portals |
| System 21 | Documents | OWASP upload, document requests, admin management | System 5 |
| System 22 | SEO Content Manager | Page metadata CMS, health scores, keywords, schema, public injection | None |
| System 23 | Admin Notifications and Health Monitoring | P0/P1/P2 alerts, SSE bell, health endpoint | All systems |
| System 24 | Deal Protection and Anti-Circumvention | Circumvention monitor, identity firewall, trust infrastructure, masked profiles | All portals |
| System 25 | Faith & Encouragement Brand Layer | 468 NKJV verses, weekly rotation, 9 page integrations, /hope, admin CMS | None |

**Feature List (24 features — F12 removed):**

| Feature | Name | Status |
|---|---|---|
| F1 | Real-Time Auction Live View | MISSING |
| F2 | Offer Comparison Engine (Interactive Side-By-Side) | MISSING |
| F3 | Buyer Progress Navigator (Persistent Journey Strip) | MISSING |
| F4 | Dealer Scorecard and Performance Intelligence | MISSING |
| F5 | Admin Funnel Analytics — Deep Conversion Reporting | MISSING |
| F6 | Smart Buyer Nudge Engine | MISSING |
| F7 | Vehicle Comparison Drawer on Shortlist | MISSING |
| F8 | Affiliate Income Planner | MISSING |
| F9 | Contract Shield Buyer Summary | MISSING |
| F10 | Quick-Offer Builder | MISSING |
| F11 | Admin Queue Command Center | MISSING |
| F13 | Notification Centers (Buyer + Dealer + Affiliate) | MISSING |
| F14 | Trust Infrastructure (live stats + /trust page) | MISSING |
| F15 | Financing Scenario Tool | MISSING |
| F16 | Deal Financial Wallet (read-only) | MISSING |
| F17 | Admin Deal Risk Intelligence | MISSING |
| F18 | Platform Live Activity Feed (SSE) | MISSING |
| F19 | Post-Close Experience | MISSING |
| F20 | Saved Searches + Inventory Match Alerts | MISSING |
| F21 | Profile Completeness Indicator | MISSING |
| F22 | Dealer Post-Auction Loss Insights (anonymized) | MISSING |
| F23 | Admin Revenue Pipeline Forecasting | MISSING |
| F24 | Buyer Account Activity Timeline | MISSING |
| F25 | Buyer Referral Hub | MISSING |

---

## ARCHITECTURE RISK LIST

### RISK-01 — Stack Replacement (CRITICAL / P0)
**Risk:** The workspace contains an incompatible React+FastAPI+MongoDB stack. Replacing it with Next.js 16 + TypeScript + Supabase + Prisma requires a clean bootstrap operation that must not corrupt the `/app` directory structure.
**Mitigation:** Initialize Next.js 16 project in `/app` with `create-next-app@16 --typescript --tailwind --app --src-dir=false`. Preserve `/app/memory/` and audit files. Delete `backend/`, `frontend/` directories after successful initialization. Execute as Phase B first action.

### RISK-02 — Prisma Schema Complexity (HIGH / P0)
**Risk:** The target schema is 4,725 lines with 136 models and 70 enums. This is one of the largest Prisma schemas in production use. Authoring it correctly in one pass is high-risk; referential integrity errors, circular dependencies, and missing indices are common failure modes at this scale.
**Mitigation:** Build schema incrementally by system, not all at once. Validate with `npx prisma validate` after each system's models are added. Create migrations per phase, not one mega-migration. Document the access pattern boundary (Prisma vs. typed Supabase) explicitly in `schema.prisma` comments.

### RISK-03 — System 4C Architectural Isolation (HIGH / P1)
**Risk:** System 4C must be completely isolated from the core deal pipeline. Previous codebases have contaminated this boundary by sharing models, status enums, or service logic between System 4C and core deal flow. Crossing this boundary creates hard-to-debug state machine conflicts.
**Mitigation:** All System 4C models (`VehicleRequest*`) are prefixed distinctly. Service files live exclusively in `lib/services/vehicle-request/`. Journey Navigator MUST check route prefix `/buyer/requests` and suppress. Deal creation on buyer OFFER_ACCEPTED is 100% admin-triggered — no automatic wiring.

### RISK-04 — iPredict Security Requirements (HIGH / P0)
**Risk:** MicroBilt iPredict returns sensitive financial and identity data. Three compliance requirements have zero tolerance for error:
1. `rawResponse` must be AES-256-GCM encrypted at rest — not plaintext storage
2. FCRA adverse action language is a legal requirement on every DECLINED result page
3. OFAC `checkOfacAlert = true` must auto-escalate to manual review immediately — no auto-approval path exists
**Mitigation:** Implement `PreQualificationEncryption` utility in Phase B before iPredict integration. Add OFAC escalation check as the very first conditional in the prequal result handler. FCRA language is a UI template constant, not optional copy.

### RISK-05 — maxOtdAmountCents Immutability (HIGH / P0)
**Risk:** The `maxOtdAmountCents` value from iPredict is immutable. No UI control, calculator, or configurator may modify or exceed this value. The Financing Configurator's reverse calculator must cap at `maxOtdAmountCents`. Previous implementations have exposed this as a mutable input.
**Mitigation:** Pass `maxOtdAmountCents` as a read-only prop with TypeScript `readonly`. The Financing Configurator component never emits or modifies this value. Reverse calculator caps output at this ceiling. All math is client-side.

### RISK-06 — Vercel Cron + Next.js on Non-Vercel Host (MEDIUM / P1)
**Risk:** The platform requires 19 Vercel cron routes. This environment is not Vercel. Crons will not execute in local/preview environments.
**Mitigation:** Build all 19 cron routes correctly for Vercel deployment. In local development, crons can be triggered manually via authenticated API calls. `vercel.json` is built complete from Phase B. All cron routes require `CRON_SECRET` Bearer token + Vercel IP allowlist validation.

### RISK-07 — Groq-Only AI Constraint (MEDIUM / P1)
**Risk:** The spec prohibits Anthropic Claude, OpenAI, Gemini, and Cohere for all orchestration and copilot flows. Only Groq API (`llama-3.3-70b-versatile` primary, `mixtral-8x7b-32768` fallback) is approved. The `emergentintegrations` library currently in the scaffold provides OpenAI/Anthropic/Gemini access — this must NOT be used for any AI agent or copilot endpoint.
**Mitigation:** All AI service files in `lib/services/ai/` and `lib/ai/` use Groq SDK only. AI kill switch (`lib/ai/kill-switch.ts`) is built before any agent. The `emergentintegrations` package is not added to `package.json`. GROQ_API_KEY must be present before AI features can function.

### RISK-08 — System 15 Inventory Adapter Architecture (MEDIUM / P1)
**Risk:** 5 built-in inventory adapters (AutoTrader, Cars.com, CarGurus, TrueCar, Edmunds) use public web fetch against search endpoints. These endpoints can change without notice, breaking sync pipelines silently. One adapter failure must not block others.
**Mitigation:** Each adapter implements `IInventoryAdapter` interface independently. Adapter failures are caught, logged, and the sync run continues with remaining adapters. `InventorySyncRun` records individual adapter outcomes. Health score monitoring (ENH-14) fires P1 alert when platform health drops below threshold.

### RISK-09 — DocuSign JWT Auth (MEDIUM / P1)
**Risk:** DocuSign uses JWT auth with private key. Key must be base64-encoded in env var. The sandbox-to-production credential promotion is a manual deployment gate.
**Mitigation:** DocuSign integration is built against sandbox credentials. `DOCUSIGN_PRIVATE_KEY_BASE64` env var holds the encoded key. Production promotion is documented as manual deployment gate 3.

### RISK-10 — Supabase RLS + Prisma Dual Access (MEDIUM / P1)
**Risk:** The `PreQualification` model has raw DB columns that must be accessed via typed Supabase queries, not Prisma. This dual-access pattern creates maintenance complexity and risk of type drift.
**Mitigation:** Document the exact access pattern in `schema.prisma` comments and in `lib/services/prequal/prequal.service.ts` header. Create typed Supabase query functions for `PreQualification` raw fields. Eliminate all `as any` casts on database writes.

### RISK-11 — System 25 Faith Layer Content Sensitivity (LOW / P2)
**Risk:** The Faith & Encouragement Brand Layer includes 468 NKJV verses, encouragement messages, and a born-again invitation on `/hope`. This content must be handled with theological accuracy (NKJV only — no other translations), legal awareness (no coercion), and brand professionalism (never interrupts conversion-critical flows).
**Mitigation:** Born-again invitation appears ONLY on `/hope` — confirmed absent from all other pages. Faith content never interrupts signup, checkout, prequal, deal, signing, or pickup flows. Admin toggle for footer faith strip. Graceful fallback on all verse modules — page renders correctly if verse fetch fails.

### RISK-12 — Single-Environment Preview Limitation (LOW / P2)
**Risk:** This build environment is a preview container, not Vercel production. Features that depend on Vercel-specific infrastructure (cron execution, edge middleware, Vercel IP allowlist for crons) cannot be fully validated in this environment.
**Mitigation:** Code is built to Vercel spec. Document all Vercel-dependent features explicitly. Cron routes are testable via direct authenticated HTTP calls in preview. Manual deployment gates are documented in the final report.

---

## PRODUCTION BLOCKERS LIST

### CATEGORY 1: MISSING CREDENTIALS (Blocks Implementation + Deployment)

| Variable | Description | Blocks | Obtain From |
|---|---|---|---|
| `GROQ_API_KEY` | Groq AI API key — only approved AI provider | System 16 (all AI features) | console.groq.com |
| `STRIPE_SECRET_KEY` | Stripe secret key | System 3 (deposit), System 6 (fee), System 11 (commissions) | Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | D3 — webhook idempotency, payment processing | Stripe Dashboard |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Entire database layer | Supabase Dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Auth, RLS, client-side queries | Supabase Dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Server-side admin operations | Supabase Dashboard |
| `DATABASE_URL` | PostgreSQL connection string | Prisma migrations, all DB operations | Supabase Dashboard → Database Settings |
| `DOCUSIGN_CLIENT_ID` | DocuSign integration key | System 9 (e-sign) | DocuSign Developer portal |
| `DOCUSIGN_CLIENT_SECRET` | DocuSign secret | System 9 (e-sign) | DocuSign Developer portal |
| `DOCUSIGN_PRIVATE_KEY_BASE64` | DocuSign RSA private key (base64) | System 9 JWT auth | DocuSign Developer portal |
| `MICROBILT_CLIENT_ID` | MicroBilt OAuth2 client ID | System 1 (prequal, iPredict) | MicroBilt portal |
| `MICROBILT_CLIENT_SECRET` | MicroBilt OAuth2 secret | System 1 (prequal, iPredict) | MicroBilt portal |
| `MICROBILT_IPREDICT_BASE_URL` | MicroBilt API base URL | System 1 | MicroBilt documentation |
| `RESEND_API_KEY` | Resend email API key | All transactional email | resend.com |

### CATEGORY 2: SECURITY SECRETS (Must Be Generated — Cannot Be Shared)

| Variable | Description | Requirement |
|---|---|---|
| `JWT_SECRET` | JWT signing secret | ≥32 chars, random, never reused |
| `CSRF_SECRET` | CSRF token secret (proxy.ts) | ≥32 chars, random |
| `EMAIL_UNSUBSCRIBE_SECRET` | HMAC-SHA256 unsubscribe token secret | ≥32 chars — tokens never stored in DB |
| `PREQUAL_ENCRYPTION_KEY` | AES-256-GCM key for rawResponse encryption | 32-byte hex, never exposed |
| `CRON_SECRET` | Bearer token for all 19 cron routes | ≥32 chars, random |

### CATEGORY 3: PLATFORM CONFIGURATION

| Variable | Description | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Production domain | `https://autolenis.com` in prod |
| `MAINTENANCE_MODE` | Site maintenance toggle | `false` in prod unless needed |
| `CURRENT_TERMS_VERSION` | Active ToS version string | e.g., `2025-01-01` |
| `OPENROAD_PARTNER_ID` | Refinance partner ID | System 14 |
| `REDIS_URL` | Redis connection for rate limiting | Distributed rate limiting in production |
| `DEV_EMAIL_TO` | Dev email override | Must NOT be set in production |
| `SENTRY_DSN` | Error tracking | Optional but recommended |

### CATEGORY 4: MANUAL DEPLOYMENT GATES (Not Resolvable by Build)

These three items require manual action by the operations team AFTER the build is code-complete. The build may be code-complete while deployment remains blocked by these gates.

| Gate | Description | Who Resolves |
|---|---|---|
| **GATE-1** | DNS cutover to autolenis.com + all env vars updated to production values | Operations team |
| **GATE-2** | Stripe webhook registration at production domain (autolenis.com/api/webhooks/stripe) | Operations team + Stripe Dashboard |
| **GATE-3** | DocuSign and MicroBilt credential promotion from sandbox to production | Operations team + vendor portals |

---

## RECOMMENDED BUILD ORDER

The build order follows Phase C of the Execution Prompt exactly. The following is a validated sequencing with rationale.

---

### PHASE B — RECONCILIATION FIRST (Before Any Portal Work)

**Must complete before Phase C:**

1. **Scaffold replacement** — Initialize Next.js 16 TypeScript project in `/app`. Delete incompatible scaffold files. Configure `tsconfig.json` (strict), `next.config.mjs` (CORS/headers, D10), `tailwind.config.ts` (v4), `env.d.ts` (all 20 variables typed).

2. **Constants and configuration** — Author `lib/constants.ts` with all canonical values: `DEPOSIT_AMOUNT_CENTS = 9900`, `PREMIUM_FEE_CENTS = 49900`, `AUCTION_DURATION_HOURS = 48`, `MAX_SHORTLIST_ITEMS = 5`, `COMMISSION_RATES = { LEVEL_1: 0.15, LEVEL_2: 0.03, LEVEL_3: 0.02 }`, Contract Shield thresholds, JWT TTLs.

3. **proxy.ts** — Author the 350-line active middleware with CSRF, Supabase refresh, and role routing. This is the active middleware — not `middleware.ts`.

4. **Prisma schema (Phase 1)** — Author the core models needed for the public website and auth: `User`, `Buyer`, `Dealer`, `Affiliate`, `Admin`, `Session`, `AcceptedTerms`. Validate and migrate.

5. **vercel.json** — Build complete with all 19 cron routes registered per the schedule table above.

6. **Placeholder env vars** — Create `.env.local` with all 20 required variables as clearly-labeled placeholder values (no real secrets yet).

---

### PHASE C — BUILD EXECUTION ORDER

#### C.1 — Public Website (Estimated: 21 pages, ~30 API routes)
**Rationale:** Public website establishes the design system, navigation components, and trust infrastructure. Faith layer integration on 9 pages begins here. No auth dependencies.

Build sequence within C.1:
1. Root layout, error boundary, not-found, loading
2. Homepage (`/`)
3. How It Works, Pricing, About, Contact
4. New pages: `/for-buyers`, `/for-affiliates`, `/trust`
5. Stub rebuilds: `/for-dealers`, `/feedback`
6. Legal pages: all 6 `/legal/*` routes
7. System 14 integration: `/refinance`
8. System 15 public integration: `/inventory`
9. System 25 public integration: `/hope`, verse modules on 9 pages
10. Auth integration: `/dealer-application`, redirects

#### C.2 — Buyer Portal (Estimated: 41 pages, ~80 API routes)
**Rationale:** Buyer journey is the core revenue path. Must be complete before dealer portal (dealers need buyers).

Build sequence within C.2:
1. Auth flow: signup, signin, verify-email, accept-terms, forgot/reset password
2. Buyer onboarding multi-step
3. System 1: PreQualification (MicroBilt integration — **OFAC auto-escalate built first**)
4. System 2: Search + Shortlist (with budget guard confirmed at search route line 55)
5. System 3: Deposit + Auction creation (Stripe inline, not redirect)
6. System 4: Auction detail + Offer comparison (F1, F2)
7. System 5: Deal + Financing (F15, maxOtdAmountCents read-only enforced)
8. System 6: Concierge fee
9. System 7: Insurance (mock gated)
10. System 8: Contract Shield (F9 buyer summary)
11. System 9: E-Sign (DocuSign)
12. System 10: Pickup + QR
13. Buyer portal features: F3 (journey navigator, suppress on 4C routes), F6 (nudge), F7 (comparison drawer), F13 (notifications), F16, F19, F20, F21, F24, F25

#### C.2B — System 4C: Request a Car (Standalone Module)
**Rationale:** Execute within buyer portal phase. Isolated from deal pipeline. Build service layer BEFORE UI.

Build sequence:
1. Data models (7 models): VehicleRequest, ResearchLog, DueDiligenceCheckpoint, VehicleRequestOffer, VehicleRequestEvent, VehicleRequestBuyerUpdate
2. Service layer (6 files): vehicle-request, research, due-diligence, offer, notifications, analytics
3. Buyer pages: /buyer/requests, /buyer/requests/new, /buyer/requests/[requestId], /buyer/requests/[requestId]/offer
4. Admin pages: /admin/requests, /admin/requests/[requestId], /admin/requests/analytics
5. All buyer + admin APIs (20 routes)
6. **Due diligence gate: enforce server-side FIRST** — offer send blocked unless all checkpoints complete
7. **Admin-only deal creation: confirm no automatic trigger on buyer accept**

#### C.3 — Dealer Portal (Estimated: 27 pages, ~40 API routes)
**Rationale:** Dealer portal depends on auctions existing (from buyer portal). Builds dealer-side auction response, offers, scorecard.

Build sequence:
1. Dealer auth + onboarding
2. Inventory management with lane badges, quality scores (ENH-3, ENH-4)
3. Auction response + offer submission (F10 quick-offer builder)
4. Offer revision within window (System 4 ENH)
5. Scorecard + analytics (F4)
6. Notifications (F13)
7. Post-auction loss insights (F22 — anonymized only)
8. DMS feed setup (ENH-1)

#### C.4 — Affiliate Portal (Estimated: 12 pages, ~15 API routes)
**Rationale:** Affiliate portal has minimal dependencies. Canonical structure under `/affiliate/portal/*` enforced from the start. Commission logic built against `lib/constants.ts` rates only.

Build sequence:
1. Redirect rules: all `/affiliate/*` → `/affiliate/portal/*`
2. Dashboard, referrals, earnings, payouts
3. Income planner + network tree (F8)
4. Notifications (F13)
5. Compliance (Gap 5.2)

#### C.5 — Admin Console (Estimated: 62 pages, ~100 API routes)
**Rationale:** Admin console provides oversight of all other portals. Depends on all data models being migrated.

Build sequence:
1. Admin auth (separate system — RFC 6238 TOTP via `otpauth` lib)
2. Dashboard with risk widget (F17), activity widget (F18), pipeline KPI (F23)
3. Buyer, dealer, affiliate, auction, deal management pages
4. System 4C admin pages (requests queue + case detail)
5. Pickup oversight (Gap 4.1), E-sign oversight (Gap 4.2)
6. Queue Command Center — F11 (8 tabs)
7. Funnel analytics — F5 (rebuild from stub)
8. Inventory management (System 15 admin: markets, search tool, discovery, ENH-12, ENH-16, ENH-19)
9. Contract Shield rules management (System 8 ENH)
10. Best Price weights management (System 4 ENH)
11. SEO content manager (System 22)
12. AI management panel (System 16)
13. Refinance admin 7 sub-pages (System 14)
14. Reports: affiliate, risk, pipeline, activity feed
15. Faith content management (System 25)
16. Settings: nudge thresholds, Best Price weights, SLA thresholds, referral milestones

#### C.6 — Cross-Cutting Systems
**Rationale:** These systems wire everything together. System 15 must complete before C.6B features.

Build sequence:
1. **C.6A — System 15 (Inventory Rebuild)**: 5 adapters, orchestrator, lane assignment, all 3 cron routes, all 20 ENH items, `/buyer/inventory/[vehicleId]`
2. Notification triggers: 15 buyer trigger points, 9 dealer trigger points, affiliate triggers
3. Nudge engine: `nudge.service.ts`, `NudgeEvent` model, wire into workflow-automation cron
4. Deal risk intelligence: `deal-risk.service.ts`, wire into workflow-automation cron
5. **C.6B — Features 16–25**: DealWallet, PostClose, SavedSearches, ActivityTimeline, ReferralHub, DealerInsights, AdminActivity, AdminRisk, AdminPipeline, Testimonials, ReferralMilestones
6. **C.6C — Core System Enhancements**: System 2 (relevance, natural language, readiness), System 3 (invitation scoring, capacity throttling, extension, re-auction, dealer preview), System 4 (weights, APR validation, revision), System 8 (rules engine, violation patterns, contract diff), System 15 enhancements, System 16 (cross-session memory, briefing, proactive context)

#### C.7 — System 25 (Faith & Encouragement Brand Layer)
**Rationale:** Built last because it touches all 9 public pages but does not block any business functionality. Graceful fallback means earlier phases are not blocked by this.

Build sequence:
1. `VerseLibrary` model + 468 NKJV verse seed data
2. `VersePageAssignment` model + rotation logic (no repeat within 52 weeks)
3. Weekly rotation cron route
4. Public APIs: `/api/faith/verse/[pageKey]`, `/api/faith/encouragement/[placement]`
5. `FaithVerseModule` component with graceful fallback
6. Integration on all 9 enabled pages
7. `PublicFooter` update with admin-toggled faith strip
8. `/hope` page — 4 required sections; born-again invitation ONLY here
9. Admin faith content management (CRUD for verses, assignments, messages, hope page CMS)

---

## ENVIRONMENT VARIABLE DOCUMENTATION

All 20 required environment variables to be defined in `env.d.ts`:

```typescript
// env.d.ts — All required variables for AutoLenis V4
declare namespace NodeJS {
  interface ProcessEnv {
    // Supabase
    NEXT_PUBLIC_SUPABASE_URL: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    DATABASE_URL: string;

    // Stripe
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;

    // DocuSign
    DOCUSIGN_CLIENT_ID: string;
    DOCUSIGN_CLIENT_SECRET: string;
    DOCUSIGN_PRIVATE_KEY_BASE64: string;

    // MicroBilt
    MICROBILT_CLIENT_ID: string;
    MICROBILT_CLIENT_SECRET: string;
    MICROBILT_IPREDICT_BASE_URL: string;

    // Communication
    RESEND_API_KEY: string;

    // AI (Groq ONLY — no OpenAI/Anthropic/Gemini)
    GROQ_API_KEY: string;

    // Security
    JWT_SECRET: string;
    CSRF_SECRET: string;
    EMAIL_UNSUBSCRIBE_SECRET: string;
    PREQUAL_ENCRYPTION_KEY: string;
    CRON_SECRET: string;

    // Platform config
    NEXT_PUBLIC_APP_URL: string;
    MAINTENANCE_MODE: string;
    CURRENT_TERMS_VERSION: string;
    OPENROAD_PARTNER_ID: string;
    REDIS_URL?: string;
    DEV_EMAIL_TO?: string;  // Must NOT be set in production
    SENTRY_DSN?: string;
  }
}
```

---

## PHASE A — QUANTIFIED SUMMARY

| Category | Target Count | Existing Count | Gap |
|---|---|---|---|
| Pages / Routes | 256 | 0 | **256 to build** |
| API Routes | 467 | 0 | **467 to build** |
| Service Files | 119 | 0 | **119 to build** |
| Components | 173 | 0 | **173 to build** |
| Test Files | 211 | 0 | **211 to build** |
| Prisma Schema Lines | 4,725 | 0 | **4,725 to author** |
| Prisma Models | 136 | 0 | **136 to design** |
| Prisma Enums | 70 | 0 | **70 to define** |
| Cron Routes in vercel.json | 19 | 0 | **19 to register** |
| Environment Variables | 20+ | 0 | **20 to configure** |
| Faith Verses (NKJV) | 468 | 0 | **468 to seed** |
| Platform Systems | 27 | 0 | **27 to build** |
| Feature Expansions | 24 (F12 removed) | 0 | **24 to build** |

---

## AGENT FILE REVIEW — FINAL

**`app/api/admin/offers/route.ts`** — STATUS: **ABSENT**
File does not exist. Must be created in Phase C.5 (Admin Console). Build requirements:
- Protect with admin role check at both proxy.ts and route handler
- All business logic in `offer.service.ts`
- Canonical field names per Prisma schema
- `[offerId]` parameter naming (not `[id]`)
- Zod validation on all request bodies
- Idempotency for any state-changing actions
- Full audit logging

---

## IMMUTABLE CONSTRAINTS SUMMARY (For Reference During All Future Phases)

1. `proxy.ts` is the ONLY active middleware — never reference `middleware.ts.bak` or `middleware.ts.txt`
2. Groq API ONLY for all AI orchestration — `llama-3.3-70b-versatile` primary, `mixtral-8x7b-32768` fallback
3. All business rules through service layer — never in UI components or copilot layer
4. `migrate deploy` ONLY — never `db push` in production
5. Commission: 3 levels ONLY — L1=15%, L2=3%, L3=2% — single source in `lib/constants.ts`
6. Auction gating: `PreQualification exists AND expiresAt > now()` — never `.status` check
7. Canonical terminology is law — all route params, enum values, admin tier names per V4 spec
8. System 4C is standalone — no shared lifecycle, models, or services with core deal pipeline
9. `maxOtdAmountCents` is immutable — no UI or calculator can modify or exceed it
10. OFAC `checkOfacAlert = true` → immediate manual admin review — no auto-approval path
11. All 19 cron routes in vercel.json — missing registration is a P0 post-deployment blocker
12. `qrcode` npm package for all QR generation — no external API calls
13. Dealer account = single DEALER role — no sub-roles, no permission filtering
14. Born-again invitation ONLY on `/hope` — confirmed absent from all other pages
15. Insurance MUST NOT block auction creation
16. iPredict `rawResponse` encrypted AES-256-GCM at rest
17. FCRA adverse action language REQUIRED on every DECLINED prequal result page

---

**PHASE A COMPLETE.**
**STOP. DO NOT WRITE ANY CODE UNTIL PHASE B IS AUTHORIZED.**

---

*AutoLenis V4 — Phase A Audit Report*
*Workspace: /app (blank scaffold — repository mismatch documented)*
*Target: Next.js 16 + TypeScript + Prisma + Supabase/PostgreSQL + Vercel*
*All metrics reflect TARGET state after complete build — not current workspace state*
