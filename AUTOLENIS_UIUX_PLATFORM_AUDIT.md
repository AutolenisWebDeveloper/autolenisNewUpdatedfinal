# AutoLenis — Phase 0 Audit: UI/UX & Platform Optimization (Four Dashboards)

**Repo:** `AutolenisWebDeveloper/autolenisNewUpdatedfinal` · frontend root `frontend/` · branch `claude/fintech-platform-audit-redesign-razk04`
**Date:** 2026-07-05
**Lens:** UI/UX primary, platform optimization secondary. Bar: launch-ready, Fortune 500–grade fintech platform.
**Method:** Direct code inspection across all four dashboard surfaces, the shared UI foundation, and cross-cutting platform concerns. Every claim cites `file:line`. The three highest-severity "broken core flow" claims were independently re-verified before publication. Findings marked **[UNVERIFIED]** need a runtime check.
**Relationship to prior audits:** `AUTOLENIS_FORTUNE500_AUDIT.md` and `AUTOLENIS_FORTUNE500_TRANSFORMATION.md` covered backend reliability, money-out rails, and compliance; their remediations shipped in PRs #242–#253 and #276–#278. Both explicitly deprioritized visual/UX quality. This audit covers that gap and does **not** re-litigate their findings (payout rails, auction reconciler, consent capture, etc.) except where a UI surface actively contradicts the backend state.

**Verification baseline (2026-07-05, this branch):** `pnpm typecheck` ✅ clean · `pnpm lint` ✅ 0 errors / 82 warnings (all unused-vars → dead-code signals) · `pnpm test` ✅ 76/76 pass. This is the regression floor for every subsequent phase.

---

## 0. DASHBOARD INVENTORY (for confirmation)

| # | Dashboard | Route root | Scale | Auth mechanism |
|---|-----------|-----------|-------|----------------|
| 1 | **Admin** | `/admin` (52 sections, 137 pages) | 304 app files + 67 components | Dedicated `admin_token` JWT + mandatory MFA (TOTP, AES-256-GCM secrets, lockout) |
| 2 | **Buyer** | `/buyer` (~40 routes) | 59 app files + 37 components | Supabase session → `requireBuyer()` |
| 3 | **Dealer** | `/dealer` (~45 routes) | 56 app files + 12 components | Dedicated `dealer_token` JWT (`DEALER_JWT_SECRET`) |
| 4 | **Affiliate** | `/affiliate/portal` (~20 routes) | 23 app files + 11 components | Supabase session → `requireAffiliate()` |

Out of scope (assumed): the `(public)` marketing surface, SEO/content/AMIPS public pages. They share the foundation, so Phase 2 token work benefits them, but no redesign pass is planned for them.

---

## 1. EXECUTIVE SUMMARY

**The platform's authorization posture is genuinely strong — no cross-tenant data leakage or auth bypass was found on any of the four dashboards.** All 298 admin API routes, 38 dealer routes, 53 buyer routes, and every affiliate route resolve identity from the session and scope queries server-side; no endpoint trusts a client-supplied tenant ID. The recent JWT-isolation and MFA hardening is correctly implemented, with two edge-layer caveats (§5).

**The platform's weakness is the UI layer: there is no design system, and several core user flows are broken at the client/API seam.** Three systems coexist — an unimplemented dark spec (`design_guidelines.json`), 8 shadcn-derived primitives used by 23% of files, and an excellent token-driven CRM kit (`components/admin/crm/ui/`) used by ~10 files — while ~77% of 725 TSX files hand-roll UI with **~3,100 hardcoded hex occurrences**. Missing states, inaccessible modals, and four divergent dashboard shells follow directly from that gap.

### Top findings by severity × leverage

| # | Finding | Sev | Effort | Where |
|---|---------|-----|--------|-------|
| 1 | **Dealer quick-offer page cannot load auction context** — reads `data.auction` but API returns `{success, data:{auction}}`; the primary bid entry point renders "Auction not available" unconditionally. **Re-verified.** | **Critical** | S | `app/dealer/quick-offer/[auctionId]/page.tsx:65` vs `lib/auth/dealer-api.ts:4` |
| 2 | **Dealer messages thread is permanently empty and send silently no-ops** — same envelope mismatch (`data.messages`/`data.message` vs `data.data.*`). **Re-verified.** | **Critical** | S | `app/dealer/messages/[threadId]/page.tsx:35,65` |
| 3 | **Buyer insurance quote records a different vehicle than the page shows** — page resolves shortlist `addedAt: desc`, submit route `addedAt: asc`. Wrong car sent whenever >1 item shortlisted. **Re-verified.** | **High** | S | `app/buyer/insurance/page.tsx:46` vs `app/api/buyer/insurance/request-quote/route.ts:70` |
| 4 | **Buyer offer-selection dead-ends during a live auction** — panel never sends `forceEarly`, API 409s with `AUCTION_LIVE`, user sees only "Failed to select offer." The documented early-accept flow is unreachable from the UI. | **High** | M | `components/buyer/OfferComparisonPanel.tsx:81` vs `select-offer/route.ts:51` |
| 5 | **Affiliate payout CTA is enabled but wired to a permanently-disabled endpoint** — and the button is styled white-on-white (authored for a removed dark card), so its states are invisible anyway. | **High** | S | `finance/page.tsx:131`, `PayoutRequestButton.tsx:59`, `affiliate-payout.service.ts:25` |
| 6 | **Affiliate "Total Earned" includes REVERSED and PENDING commissions** — headline money figure overstates earnings and disagrees with the level rows below it and the leaderboard ranking basis. | **High** | S | `commission.service.ts:100` vs `earnings/page.tsx:24`, `affiliate-leaderboard.service.ts:29` |
| 7 | **Two divergent affiliate banking models break payout readiness** — Finance Hub writes `AffiliatePayoutMethod`; onboarding/profile read `AffiliatePaymentProfile`. Banking set up in one place shows incomplete in the other and blocks onboarding submission. | **High** | M | `finance/payout-method/route.ts` vs `onboarding.service.ts:65`, `onboarding/submit/route.ts:24` |
| 8 | **No design system** — 3 token layers + 1 dead spec; ~3,100 hardcoded hex; 30 local Button impls; 46 hand-built modals (9 accessible); 37 raw tables; 8 currency formatters; RHF+zod installed but 0 usages; sonner mounted but unused. | **High** | L | Foundation (§3) |
| 9 | **No error monitoring** — zero Sentry/equivalent; Stripe webhook side-effect failures vanish into console logs. | **High** | M | platform-wide |
| 10 | **Rate limiting effectively absent** — in-memory Map on serverless (resets per instance); nothing on sign-in, password reset, or payment-intent creation. Admin MFA lockout is the one strong spot. | **High** | M | `app/api/public/ai/chat/route.ts:15`; auth routes |
| 11 | **Search failure is silent on buyer search** — `try/finally` with no catch, `void fetchResults()`; network error = unhandled rejection + stale UI, no error state. | **High** | S | `components/buyer/BuyerSearchClient.tsx:170,187` |
| 12 | **Admin RBAC is coarse** — 224/298 routes accept any authenticated admin; only 25 role-gated. Sidebar `visibleTo` used on 1 of 72 items. A support admin can hit destructive finance/dealer endpoints. | **High** | M | `lib/auth/admin-api.ts` usage; `AdminSidebar.tsx:88` |

**Biggest structural insight:** the CRM kit (`components/admin/crm/ui/`: DataTable with `aria-sort`, KpiCard, PageHeader, EmptyState, Skeleton, SlideOver, Tabs, tokens.ts, working dark mode) is already a near-complete fintech design system. **Phase 2 should promote it, not build new.**

**Highest-ROI fixes:** items 1–3 and 5–6 are one-to-few-line changes that repair four broken/misleading core flows — together less than a day of work closing two Criticals and three Highs.

---

## 2. CONSOLIDATED FINDINGS REGISTER

Severity: **Critical** = broken core flow / data leakage / auth bypass · **High** = major correctness or UX defect · **Medium** = consistency, hardening, hygiene · **Low** = polish/cleanup. Effort: S <1d · M = days · L = 1–2+ wks.

### Critical (2)
| ID | Finding | Effort |
|----|---------|--------|
| C-1 | Dealer quick-offer envelope bug — bid entry point non-functional (`quick-offer/[auctionId]/page.tsx:65`) | S |
| C-2 | Dealer messages thread envelope bug — thread always empty, optimistic send no-ops (`messages/[threadId]/page.tsx:35,65`) | S |

### High (14)
| ID | Finding | Effort |
|----|---------|--------|
| H-1 | Buyer insurance vehicle mismatch (`desc` vs `asc`) — wrong vehicle recorded | S |
| H-2 | Buyer offer-selection dead-end on live auction (no `forceEarly` path in UI) | M |
| H-3 | Buyer search: unhandled rejection + no error state on core search | S |
| H-4 | Affiliate payout CTA enabled → always-503 endpoint; button styled white-on-white | S (hide/fix) |
| H-5 | Affiliate "Total Earned" includes REVERSED+PENDING; inconsistent across 4 surfaces | S |
| H-6 | Affiliate dual banking models (`AffiliatePayoutMethod` vs `AffiliatePaymentProfile`) break readiness + onboarding submit | M |
| H-7 | No shared design system; ~3,100 hardcoded hex; 77% of files hand-roll UI | L |
| H-8 | 46 hand-built `fixed inset-0` modals, only 9 with `role="dialog"`; none with focus trap — WCAG failure at scale | L |
| H-9 | No error monitoring (Sentry or equivalent) | M |
| H-10 | Rate limiting absent/in-memory on serverless; none on auth or payment-intent endpoints | M |
| H-11 | Admin RBAC coarse: 224/298 routes any-admin; nav role-filtering on 1/72 items | M |
| H-12 | Affiliate leaderboard loads ALL active affiliates + full commission ledgers into JS per view — unbounded scan, biggest scale risk | M |
| H-13 | Admin: two parallel design systems; CRM kit used by 0 pages outside `/admin/crm`+`/admin/operations`; 2,195 hex occurrences in 147 admin files | L |
| H-14 | Giant client files: `SocialDashboardClient.tsx` 4,685 lines; 5 command-centers 1.1–1.9k lines each; `requests/new/page.tsx` 1,497 | L |

### Medium (selected, 24)
| ID | Finding | Effort |
|----|---------|--------|
| M-1 | Buyer API auth helper skips email-verified & suspended checks (UI blocks, API doesn't) — `lib/auth/api.ts:59` | M |
| M-2 | Buyer can self-mark Contract Shield PASS via empty POST (`contract-shield/[dealId]/route.ts:650`) — fabricates green compliance UI (esign still independently gated) | M |
| M-3 | Buyer journey-stage logic duplicated & drifted (layout vs journey-status API) | M |
| M-4 | Buyer sidebar shows all 24 links regardless of journey stage | M |
| M-5 | VehicleGallery lightbox not keyboard-accessible; no dialog semantics/focus trap/ESC | M |
| M-6 | Dealer: two divergent bid forms (`quick-offer` rich vs `offers/new` manual); `offers/new` has a fake hardcoded-60% competitiveness gauge and free-text auction-ID entry; sends fields the API silently drops | M |
| M-7 | Dealer: three different API-envelope reading conventions across clients (`[object Object]` errors in `offers/new:52`) | S–M |
| M-8 | `proxy.ts` admin/dealer API guards are unreachable dead code (early `return response` at :386-397) — zero middleware backstop for future unguarded routes | S |
| M-9 | `x-{admin,dealer}-auth-route` header set on response not forwarded request — layout may never see it (redirect-loop risk) **[UNVERIFIED at runtime]** | S |
| M-10 | Stripe webhook side-effects not transactional — partial-failure states possible between retries (atomic event-claim itself is solid) | M |
| M-11 | 28 admin route files run unbounded `findMany` (no `take`) | M |
| M-12 | 19 API files with sequential-await N+1 loops (e.g. `crm/campaigns/bulk-send/route.ts:73-110` per-contact suppression checks) | M |
| M-13 | Zero `next/dynamic` usage — recharts eagerly imported in 3 client components, leaflet in coverage-map (markers from external CDN) | S–M |
| M-14 | 365 files `force-dynamic` (215 pages) — cache opt-out as copy-paste default; public/SEO tree should be ISR | M |
| M-15 | No boot-time env validation; `STRIPE_WEBHOOK_SECRET` defaults to `""` silently | M |
| M-16 | Admin error states: only 2 `error.tsx` for 137 pages; 0 `not-found.tsx` (loading coverage is good: 121/137) | M |
| M-17 | Affiliate: zero `loading.tsx` on any server page (all `force-dynamic`, blank until DB resolves) | M |
| M-18 | Affiliate: DB errors silently rendered as empty states (docs/profile/onboarding) | M |
| M-19 | Affiliate: compliance acknowledgment doesn't record which disclosures were shown/checked — weak FTC evidence | M |
| M-20 | Affiliate: uploaded documents listed but not viewable (signed-URL route exists, unused); nested button-in-button in MarketingKit/ReferralHub; hardcoded wrong "2%" L3 rate copy (actual 3%) | S–M |
| M-21 | Admin a11y: 570 buttons / 44 aria-labels; 9-10px text in sidebar & dense screens; 72-link flat nav with duplicate entries (`reports/affiliate` vs `reports/affiliates`, Affiliates ×3) | M |
| M-22 | Responsive gaps: only 7 of 31 admin table files have mobile alternatives; rest horizontal-scroll only | M |
| M-23 | Focus styles: 567 `focus:ring` vs 61 `focus-visible`; 2 reduced-motion guards vs 373 animations | M |
| M-24 | Test coverage thin at route/UI level: ~527/529 API routes untested; Stripe webhook untested; test script runs hand-picked subset | L |

### Low (selected, 18)
Duplicate route trees (`/buyer/auction` vs `/buyer/auctions`; `/dealer/signin` vs `/dealer/sign-in`) · native `alert()` in BuyerSearchClient · raw `<img>` throughout (0 `next/image` in admin) · dealer debug logging in bid path (`quick-offer:62-64`) · dealer password toggle `tabIndex={-1}` · dealer "segment median" is platform-wide median · affiliate email-masking reimplemented 4× · affiliate greeting parses email local-part · `WeeklyDigestToggle` sends ignored `affiliateId`, missing `role="switch"` · empty `DOWNLOADABLE_ASSETS` renders placeholder section · dead CRA scaffold (`src/` 46 jsx files, `craco.config.js`, conflicting `jsconfig.json`, `plugins/health-check/`) · dead `.eslintrc.json` · vestigial `backend/server.py` (Emergent-preview-only proxy; zero references from frontend/config) · `components.json` wrong on every field · non-constant-time cron secret compare · `images.remotePatterns` `"**"` dev fallback active in all envs · Space Grotesk ships 5 weights · buyer Premium self-upgrade with no charge **[business decision to confirm]** · 4 font families for one product.

---

## 3. FOUNDATION / DESIGN SYSTEM (full analysis)

**Verdict: no single design system exists.** Three token layers + one aspirational spec:

1. **shadcn HSL vars** (`app/globals.css:3-83`) — global, light mode active; the `.dark` block is dead (applied 0 times, no toggle).
2. **CRM hex tokens** (`globals.css:121-209`, `.crm-root[data-theme]`) — well-built, real dark mode, scoped to `/admin/crm` + `/admin/operations` only.
3. **Brand literals** (`tailwind.config.ts:10-16`) — rarely referenced; code hardcodes `#0B5FD1` directly instead.
4. **`design_guidelines.json`** (repo root) — describes a dark emerald/purple product that was never built. Actively misleading; reconcile or delete.

**Tailwind v3/v4 hybrid:** `globals.css` is v4 (`@import "tailwindcss"` + `@theme`) while a v3-style `tailwind.config.ts` coexists — its `brand`/`keyframes` extensions may be dead. `components.json` is stale on every field.

**Quantified divergence** (725 TSX files in app/ + components/):
- Only 166 files (23%) import from `@/components/ui`.
- Hardcoded hex: admin 1,862+329 · buyer 540+316 · dealer 476+54 · affiliate 229+40 (app+components).
- 30 local `Button` implementations; 29 local `*Card`s; 2 full Button/Badge systems (ui vs CRM kit).
- **~8 named currency formatters** with conflicting signatures (cents vs dollars vs string-mask) + 139 files with inline `toLocaleString` + 189 ad-hoc date-format sites.
- **Forms:** react-hook-form + @hookform/resolvers installed, **0 usages**; 75 raw `<form>`s with hand-rolled validation.
- **Toasts:** sonner `<Toaster>` mounted globally, ~0 feature usage; admin pages hand-roll `useState` toasts.
- **Modals:** 46 `fixed inset-0` overlays, 9 with `role="dialog"`, none verified with focus trap.
- **Tables:** 37 raw `<table>` files; the one proper DataTable (sorting, `aria-sort`) is CRM-only.
- **Shells:** 4 divergent sidebars (Admin/Buyer/Dealer/Affiliate), no shared layout primitives; `app/affiliate/layout.tsx` doesn't exist (portal-level only); no `<nav>`/`<header>` landmarks or skip links anywhere.
- Button primitive has a stranded purple `hover:bg-[#3A0061]` on the blue default variant (`components/ui/button.tsx:14`); three different greens in circulation (`#50D14E`, `#4CAF50`, `#15803d`).

**Existing asset to build on:** `components/admin/crm/ui/` — DataTable, KpiCard, PageHeader, EmptyState, Skeleton, SlideOver, Tabs, Badge/StatusPill, Button, Toolbar, tokens.ts, functioning dark mode, correct `focus-visible` usage. Imported by zero pages outside CRM/operations.

**Consolidation order (feeds Phase 1 plan):**
1. One token layer (elevate CRM model or commit to HSL; delete the loser + reconcile `design_guidelines.json`).
2. Shared `lib/format.ts` (currency/number/date) — safest first PR, kills 8 formatters + 328 call sites of drift risk.
3. Promote CRM kit → `components/ui`; add Dialog, DropdownMenu, Tooltip, Checkbox, Radio, Switch, Pagination (Radix-based for a11y).
4. Fix 8 existing primitives (purple hover bug, greens, tokens, real `asChild`).
5. Form stack (RHF + zodResolver + Field/FormError), migrate 75 forms per-dashboard.
6. Standardize on sonner; delete ad-hoc toasts.
7. One `DashboardShell` (nav/header/skip-link landmarks, config-driven sidebar) replacing 4 shells; add affiliate layout.

---

## 4. PER-DASHBOARD SUMMARIES

### 4.1 Admin (largest surface; 52 sections, 137 pages, 72-link flat nav)
- **Architecture:** server-component list pages (Prisma direct) + large client command-centers fetching `/api/admin/**`. Auth solid: edge check + `requireAdmin()` + per-route guards; MFA enforced with no skip path; 298/298 routes guarded (2 intentionally-public auth endpoints).
- **Primary defects:** two parallel design systems (H-13); 2,195 hex across 147 files (top: SocialDashboardClient 416, ExecutiveIntelligenceDashboard 126, dashboard/page.tsx 59); 31 bespoke tables vs 1 DataTable consumer; three card radii for one concept; arbitrary `text-[9px]`/`text-[10px]` in nav and dense screens; error boundaries 2/137, not-found 0; RBAC coarse (H-11); nav duplicates (Affiliates ×3, two funnel entries, `/admin/operations` orphaned from nav).
- **Perf:** zero code-splitting; recharts eager in finance page; 4,685-line social client; leaflet markers from cdnjs (CSP/offline risk); some unbounded findMany (M-11).
- **Positives:** loading states 121/137; capability-based RBAC exists for content engine (`requireContentCapability`); audit-logged destructive ops; clean TODO hygiene (1 in whole surface).

### 4.2 Buyer
- **Architecture:** best-practice server-first; standardized envelope; journey-stage-aware layout. Authorization verified route-by-route — exemplary scoping, anonymization preserved pre-selection (counts only, no dealer identity/amounts).
- **Primary defects:** H-1, H-2, H-3 above; M-1 (API helper skips suspended/verified checks); M-2 (self-served Contract Shield PASS); M-3 (journey logic duplicated layout vs API, already drifted); M-4 (journey-blind sidebar); M-5 (inaccessible lightbox); duplicate `auction/` vs `auctions/` trees; `alert()` amid toast system; 1,497-line request form.
- **Positives:** best state coverage of all four dashboards (fee page has 5 sub-states; deal/esign/pickup/contracts all branch no-deal/pending/complete); parallelized dashboard fan-out with per-query fallbacks; no heavy client libs.

### 4.3 Dealer
- **Architecture:** server-first lists (good N+1 avoidance via batched `findMany` + Map joins) + client forms. Dedicated JWT correct; every route session-scoped; buyer anonymization enforced (budget bucketed, buyerId stripped); pickup QR flow gated by expiry+insurance+state machine.
- **Primary defects:** C-1, C-2 (envelope bugs — the dealer core loop is broken in two places); M-6 (dual bid forms, fake competitiveness gauge hardcoded to 60%, hand-typed auction IDs); M-7 (three envelope-reading conventions; `[object Object]` errors); M-8/M-9 (proxy dead code + header-forwarding risk); duplicate signin routes; password toggle keyboard-inaccessible; status conveyed by color dot alone; messages not live despite "real-time" marketing copy; 233 hardcoded `#0B5FD1`.
- **Positives:** solid error boundary (digest + retry); clean empty states on server pages; no TODO debt.

### 4.4 Affiliate (smallest; strongest recent build, weakest ops polish)
- **Architecture:** server-first, `force-dynamic` money pages; commission math server-side, constant-driven, unit-tested, idempotent per qualifying event; IDOR checks pass everywhere.
- **Primary defects:** H-4 (dead payout CTA, invisible button), H-5 (Total Earned math), H-6 (dual banking models), H-12 (leaderboard full-table scan); M-17 (zero loading.tsx), M-18 (DB errors as empty states), M-19 (weak compliance evidence), M-20 (docs not viewable; nested buttons; wrong 2%/3% copy); network tree double-fetched + L2 N+1 (`commission.service.ts:119-135`); session helper over-fetches commissions/children on every nav.
- **Positives:** cleanest authorization surface; salted-hashed IPs on referral tracking; masked leaderboard output.

---

## 5. CROSS-CUTTING PLATFORM

**Auth:** two parallel systems (Supabase for buyer/affiliate; dedicated JWTs for admin/dealer), correctly isolated; secret precedence consistent between signer and edge. Caveats: proxy API guards unreachable (M-8); CSRF intentionally disabled for role APIs (cookie-SameSite reliant, documented); cron auth non-constant-time compare; `ADMIN_JWT_SECRET`/`DEALER_JWT_SECRET`/`MFA_ENCRYPTION_KEY` fall back to shared secrets — **verify the dedicated values are actually set in production**.

**Data:** 204 models; money settlements transactional (30 files use `$transaction`); Stripe webhook atomic event-claim is textbook but side-effects non-atomic (M-10); 28 unbounded admin findMany (M-11); 19 sequential-await loops (M-12).

**Perf:** zero `dynamic()`; 365 `force-dynamic` files; fonts self-hosted correctly but 4 families/extra weights; SWR installed, used once; `images.remotePatterns "**"` fallback live in prod.

**Ops:** no error monitoring (H-9); no rate limiting on auth/payment (H-10); no boot-time env validation (M-15); all 7 webhooks signature-verified (positive); payment idempotency strong (positive).

**Code health:** `strict: true`, 3 `any`s total in app+lib (excellent); dead CRA scaffold + dead `.eslintrc.json` + vestigial `backend/server.py`; 82 lint warnings = dead-code map; route/UI test coverage thin (M-24).

---

## 6. PROPOSED PHASE SEQUENCING (preview — full plan is the Phase 1 deliverable, pending approval)

- **Phase 1 (plan):** design-system spec (tokens, type scale, spacing, color roles, component inventory based on promoting the CRM kit) + sequenced backlog. **Includes a "hotfix wave" proposal:** C-1, C-2, H-1, H-3, H-4 (hide/fix CTA), H-5 — six small, behavior-restoring fixes that arguably shouldn't wait for the redesign. Each alters behavior only in the direction of "works as documented," but per the guardrails they are flagged for approval.
- **Phase 2 (foundation):** token unification → `lib/format.ts` → promote CRM kit → missing primitives (Dialog first) → form stack → sonner → DashboardShell.
- **Phase 3 (per-dashboard):** Dealer (smallest core-flow debt after hotfixes, proves the shell) → Affiliate (smallest surface) → Buyer → Admin (largest; command-center consolidation).
- **Phase 4 (optimization):** code-splitting, cache strategy (`force-dynamic` audit), unbounded-query sweep, N+1 batch fixes, dead-code removal (CRA scaffold, duplicate routes, dead deps), RBAC extension, env validation, rate limiting, error monitoring.
- **Phase 5 (launch readiness):** full verification loop, WCAG spot-audit, cross-role access re-check, sign-off.

### Decisions needed from you (business, not technical)
1. **Dashboard inventory** — confirm the four above; confirm `(public)` marketing surface is out of scope.
2. **Buyer Premium self-upgrade with no charge** (`plan/upgrade/route.ts:16`) — intentional (fee collected at deal) or gap?
3. **Affiliate payouts** — hide the CTA until the settlement rail ships (recommended), or prioritize building the processor?
4. **`design_guidelines.json`** — the dark emerald/purple spec was never built. Delete it and canonize the current light-blue system, or is a rebrand toward that spec planned?
5. **Dealer sub-brand** — Inter/Jakarta fonts were added for a "For Dealers redesign." Deliberate sub-brand to keep, or consolidate to one type system?
6. **`backend/server.py` / Emergent preview** — still used? If not, remove in Phase 4.
7. **Admin RBAC** — is tightening 224 any-admin routes to role/capability gates in scope? (Recommended; it changes who can do what.)
