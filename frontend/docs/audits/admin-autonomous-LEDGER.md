# Admin Console — Autonomous Hardening LEDGER

**Mission:** Autonomous discovery, planning, remediation, elevation & automation of the AutoLenis admin console to Fortune-500 fintech grade.
**Branch:** `claude/admin-autonomous-hardening-fefvfe` (base: `main`)
**Started:** 2026-07-07T02:15:00Z · **Last updated:** 2026-07-07T02:37:42Z
**Resume protocol:** read this file first, then `admin-autonomous-PLAN.md`; continue from the first unit not marked DONE. Never redo DONE units.

---

## DISCOVERY (Phase 0)

**Surface:** 137 pages under `app/admin/**`, 298 API routes under `app/api/admin/**`.

### Reconciliation checklist — confirmed vs refuted

| Claim | Verdict | Evidence |
|---|---|---|
| ~94 pages across ~22 domains | UNDERCOUNT | 137 pages, 298 API routes (find … page.tsx / route.ts counts) |
| Operations report returns `{ summary: {}, lifecycle: [] }` stub in LIVE | **REFUTED** | grep `summary: \{\}` / `lifecycle: \[\]` → no matches; `/api/admin/reports/financial-summary` and all 9 report routes are real Prisma aggregates |
| ~1,109 `any` repo-wide | **REFUTED (already fixed)** | grep `: any\b|as any\b|any\[\]` over app/lib/components → 0 code matches (3 comment matches only). Prior PR #285 "typed-client migration" |
| ~113 console.* in lib/ | **REFUTED (already fixed)** | 4 total in lib/, 1 in lib/services |
| Sparse admin error boundaries | **CONFIRMED** | only `app/admin/error.tsx` + `app/admin/crm/analytics/error.tsx` exist for 137 pages |
| RBAC enforcement per route | **CONFIRMED SOLID** | all 298 routes guarded via `getAdminFromRequest`/`getAdminWithRole`/`requirePermission(Actor)`/`requireContentCapability` except the 5 pre-auth routes under `app/api/admin/auth/**` (correct) |

### Foundation already in place (REUSE, do not rebuild)

- Token layer: `--al-*` in `app/globals.css` `@theme` (#0B5FD1 = `--color-al-primary`); CRM kit tokens `--crm-*` under `.crm-root`.
- Primitives tier: `components/ui/kit.ts` barrel → `components/admin/crm/ui` (Badge/StatusPill, Button, DataTable [sort/density/empty/error/loading], EmptyState, KpiCard, PageHeader, Skeleton+SkeletonRows, SlideOver, Tabs, Toolbar+SearchField+SelectField).
- Patterns tier: `components/ui/patterns` (PageContainer, PageHeader, Panel, StatCard, EmptyState).
- Radix Dialog reference impl: `components/ui/dialog.tsx` (center + sheet variants, full a11y contract).
- Toast: `sonner` mounted globally in `app/layout.tsx:98`.
- Typed API client: `lib/api/client.ts` — unwraps `{success,data}` envelope; eliminates the historic envelope-depth bug class.
- Admin auth: `lib/admin-auth.ts` + `lib/auth/admin-api.ts` (getAdminFromRequest, getAdminWithRole, OPERATIONAL_ROLES, createAuditLog, adminSuccess/adminError) + `lib/auth/permissions.ts` (requirePermission/requirePermissionActor).
- Governing docs: `docs/design-system/AUTOLENIS_UI_SPEC.md` (standing directive: promote CRM kit; NO net-new component system), `docs/execution/PHASE_BACKLOG.md`, `docs/rbac/*`.

**CI baseline (branch head, 2026-07-07):** `pnpm tsc --noEmit` → 0 errors · `pnpm lint` → 0 errors / 82 warnings (floor: monotonically decreasing) · build not yet run.

### Domain findings (file:line evidence)

#### Core Ops (dashboard, ops-dashboard, operations, system-health, queues, activity, audit-log, notifications, analytics, journey, ai, support, comms, messages)
- `app/admin/queues/page.tsx:65-79` — resolve() never checks `res.ok`; optimistic success on failure. `:148-158` — "Resolve empty queue" placeholder button POSTs synthetic `placeholder-<id>`. **BROKEN**
- `app/admin/system-health/page.tsx:85,96` — fetch errors swallowed (`catch {}`); `:122` defaults status to "healthy" on failure. **PARTIAL (lies on failure)**
- `app/admin/support/page.tsx:12-29` — "Coming Soon" stub, yet impersonation APIs exist (`app/api/admin/support/impersonate`, `…/[id]/end`, requirePermission-guarded). **STUBBED + orphaned service**
- `app/admin/activity/page.tsx:25-26` — pulsing "Live" dot on a static one-shot render. **Misleading liveness**
- `app/admin/analytics/` — no loading.tsx (heaviest aggregation page).
- `app/admin/ai/page.tsx:43` — "Chat with Zura" DOM-pokes `querySelector`, silent no-op if widget absent.
- `app/admin/messages/[threadId]/page.tsx:36` — icon-only back link without aria-label.
- queues escalate/assign API routes exist but unused by UI.
- Rest VERIFIED. No envelope mismatches (api client unwraps).

#### Buyers / Prequal / Compliance / Requests
- `components/admin/AdminRequestActionButtons.tsx:19` + `components/admin/CompleteCheckpointButton.tsx:22` — raw fetch, NO res.ok check → silent no-op on failure. **Highest-severity functional bug in domain**
- `app/admin/requests/page.tsx:41` — unbounded findMany (no take).
- `app/admin/requests/[requestId]/page.tsx:43` — dead `buyerUpdates` fetch, never rendered.
- `app/admin/buyer-sources/` — missing loading.tsx; `BackfillSourceButton.tsx:28,37` uses window.alert.
- `AdminBuyersClient.tsx:302,319` — bulk ops fire N sequential requests.
- buyers/[buyerId] VERIFIED but 1907-line monolith. Rest VERIFIED; compliance language correct.

#### Payments / Finance / Affiliates / Reports
- `app/admin/referral-milestones/page.tsx:3` — "Pay" button has NO onClick/route/confirm/audit. **BROKEN dead financial control**
- `components/admin/AdminPaymentsClient.tsx:1082-1092` — Refunds tab hardcodes reason/stripeId/refundedAt = null (real impl exists at /payments/refunds). **STUBBED tab**
- `app/admin/affiliates/onboarding/page.tsx:14` — missing requireAdmin() (only admin page without it); no try/catch.
- `AdminPaymentsClient.tsx:864-871` — affiliate tab swallows fetch errors → false-empty.
- `app/admin/reports/page.tsx` — links only 4 of 9 reports (affiliates/buyers/dealers/revenue = URL-only dead-ends).
- reports/affiliate vs reports/affiliates near-duplicates; funnel/pipeline lack error/empty states.
- **No Stripe-vs-ledger reconciliation view exists anywhere.** Financial-action hygiene otherwise good (confirm+reason, Stripe idempotency keys, audit logs).

#### Deals / Auctions / Offers / Vehicle-requests / Contracts / Documents / E-sign / Pickups / Contract-shield
- `components/admin/AdminDealTabs.tsx:266` — Refunds tab hardcoded "No refunds issued" placeholder in live mode. `:419-432` — Cancel Deal / Trigger Refund / Override Contract Shield fire single-click, NO confirm dialog. `:64-76` — no router.refresh after doAction → stale UI.
- `components/admin/AdminAuctionDetail.tsx:199-203,261` — Remove Dealer / Trigger Refund no confirm; `:55-66` no refresh after action.
- `app/admin/esign/page.tsx:50-51` — **Resend & Void buttons inert (no onClick)**; working impls exist in AdminESignActions. **STUBBED actions**
- `app/admin/vehicle-requests/[id]/page.tsx:15-16` — detail + send-to-dealers gate on legacy `prisma.notification` "Vehicle Request:" model; canonical list links to `/admin/requests/[id]` instead (`VehicleRequestsListClient.tsx:133`) → **orphaned legacy island**; `VehicleRequestDetailClient.tsx:143` silent no-op on failed status update.
- `app/admin/offers/page.tsx` — no empty state, no error handling. `app/admin/contracts/page.tsx` — no error handling, contract not viewable. `app/admin/documents/page.tsx` — files listed but not openable; errors swallowed to [].
- `app/admin/contract-shield/rules/page.tsx:262` — Edit pencil inert. StartAuctionButton misleading (never starts an auction).
- Server side solid: Stripe idempotencyKey, double-refund guards, audit logs on all financial routes. No envelope bugs.

#### Dealers / Dealer-outreach / Inventory / AMIPS
- `app/admin/dealers/applications/page.tsx:152-169` — approve/reject via raw `<form method="POST">` to a JSON API → **admin lands on raw JSON page**; reject sends no reason. **BROKEN**
- `app/admin/inventory/[id]/page.tsx:64-69` — Deactivate/Activate + Force Resync buttons NO onClick. **BROKEN**
- `app/admin/inventory/demand-gap/page.tsx:29` — `demand = Math.round(supply*(0.8+Math.random()*0.8))` — **random numbers in live mode, actively misleading**. **STUBBED**
- `app/admin/inventory/markets/page.tsx:13-19` — hardcoded DEFAULT_MARKETS; add/remove local-state only; existing `/api/admin/inventory/markets` CRUD routes unused. **STUBBED**
- `app/admin/inventory/coverage-map/page.tsx:10-19` — hardcoded `count: 0`; existing coverage-map route never called. **STUBBED**
- `app/admin/inventory/dealer-discovery/page.tsx:12-15` — static placeholder dead-end. **STUBBED**
- `RejectFormClient.tsx:16` — irreversible reject, no confirm. dealer-outreach RunFollowups/Backfill bulk sends no confirm, window.alert feedback. `inventory/contributions` no empty state.
- amips (all 4 pages) VERIFIED — real intelligence engine, no stubs.

#### CRM (own shell; plain-JSON envelopes, all matched)
- `app/admin/crm/suppression/page.tsx:12-25` — **STUBBED "Coming in Phase 3"**; no `/api/admin/crm/suppression` route. A live CAN-SPAM/TCPA surface is non-functional. `lib/services/suppression.service.ts` exists for reuse.
- Bulk-send: no confirm step; email path does NOT enforce `consent_email` (route :79-100) while single-send does; `BulkComposeSmsModal.tsx:38-51` consent preview counts only first 100 contacts. **Compliance holes**
- `app/admin/crm/contacts/[id]/page.tsx:108,201,246,249` — 4 dead buttons (Edit contact, Add, Add Note, Add Task). `ContactActions:31` SMS check ignores consentSms.
- campaigns/[id] — NO pause/cancel/resume anywhere (route GET-only).
- Off-kit cluster: contacts/[id], SegmentBuilder, TemplateEditor, compose/bulk modals (hardcoded bg-white/gray/blue-600); contrast bug `bg-blue-600 text-gray-900` on Save/toggle buttons (SegmentBuilder :343,:396,:405; TemplateEditor :222).
- inbox: errors via alert() (:281,:307); conversation list does not poll (selected thread polls 5s). tasks AddTaskModal requires raw UUID paste (:355).

#### SEO / Content / Social / Faith / Settings / Security / Insurance / Refinance / Testimonials
- `app/admin/testimonials/page.tsx:3` — **Approve/Reject buttons with NO onClick in a server component**; `PATCH /api/admin/testimonials/[id]` exists, never called. **BROKEN**
- `app/admin/settings/page.tsx:55` — weights load error swallowed; `:138-144` — 6 inert placeholder SETTINGS_LINKS divs. **STUBBED dead-ends**
- `app/admin/faith-content/{hope,messages,verses}` — **authz gap**: only requireAdmin() vs parent SUPER/OPS gate (`faith-content/page.tsx:17`).
- `app/admin/seo/schema/page.tsx:6` — `where:{NOT:{schema:undefined}}` Prisma no-op filter bug; read-only "Editor" dead-end. seo/health computes no health scores (:52-54).
- `content/[id]/page.tsx:133` + `ArticleManagerClient.tsx:1114` — dangerouslySetInnerHTML on AI-generated body (XSS if unsanitized).
- `refinance/compliance/page.tsx:72` — hardcoded excluded-states vs service EXCLUDED_STATES (divergence risk). All refinance compliance language correct.
- auth pages VERIFIED. security/mfa VERIFIED. settings/admins VERIFIED.

### Derived taxonomy (12 domains)
1. Core Ops & Health (dashboard, ops-dashboard, operations, system-health, queues, activity, audit-log, notifications, analytics, journey, ai, support, comms, messages)
2. Buyers & Prequal (buyers, prequal, external-preapprovals, manual-reviews, compliance, buyer-sources, requests)
3. Deals & Auctions (deals, auctions, offers, pickups, esign, contracts, documents, contract-shield, vehicle-offers, vehicle-requests)
4. Payments & Finance (payments, finance, referral-milestones)
5. Affiliates (affiliates, onboarding)
6. Reports (9 report pages + index)
7. Dealers (dealers, dealer-outreach)
8. Inventory & Market Intel (inventory ×11, amips ×4)
9. CRM (22 pages, own shell)
10. Growth & Content (seo, content, social, faith-content, testimonials)
11. Insurance & Refinance (insurance-requests, refinance ×5)
12. System (settings, security, auth)

---

## UNIT TABLE

| # | Unit | Status | Defects Fixed (file:line) | Improvements | Automation | CI | Commit | Notes |
|---|---|---|---|---|---|---|---|---|
| 0 | FOUNDATION — kit extras (ConfirmDialog, ErrorState, useAutoRefresh, CSV util) + admin segment error boundaries | PENDING | | | | | | |
| 1 | Core ops — queues/system-health/activity/analytics/ai/aria + authz quick wins (onboarding requireAdmin, faith-content gates) | PENDING | | | | | | |
| 2 | Dead controls — testimonials, referral-milestones Pay, esign hub, contract-shield rules Edit | PENDING | | | | | | |
| 3 | Deals & auctions — confirm dialogs, post-action refresh, real Refunds tab, offers states, StartAuctionButton | PENDING | | | | | | |
| 4 | Requests & buyers — silent-failure buttons, unbounded query, vehicle-requests unification, buyer-sources | PENDING | | | | | | |
| 5 | Payments & reports — Refunds tab data, error-vs-empty, reports index, funnel/pipeline states, dedupe | PENDING | | | | | | |
| 6 | Dealers & inventory — stubbed analytics (demand-gap/markets/coverage-map), applications forms, dead buttons | PENDING | | | | | | |
| 7 | CRM compliance — suppression manager, bulk-send consent, dead buttons, contrast, campaign lifecycle | PENDING | | | | | | |
| 8 | Growth & settings — settings stubs, seo/schema, innerHTML sanitize, refinance dedupe, documents/contracts links | PENDING | | | | | | |
| 9 | Automation — polling on ops surfaces, reconciliation view, support impersonation UI, inbox polling | PENDING | | | | | | |
| 10 | Design elevation — kit adoption on high-traffic list pages | PENDING | | | | | | |

## BLOCKERS

(none yet)

## SETUP (human actions required)

- (carried from PHASE_BACKLOG) SENTRY_DSN + Upstash/KV env vars still owed by ops for Phase 0.5 sign-off.
