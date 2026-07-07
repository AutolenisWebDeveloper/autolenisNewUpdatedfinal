# Admin Console — Autonomous Hardening PLAN

Companion to `admin-autonomous-LEDGER.md` (live state + evidence). Branch: `claude/admin-autonomous-hardening-fefvfe`.

## Governing constraints
- **Reuse-first.** The canonical kit exists: primitives via `@/components/ui/kit` (barrel → `components/admin/crm/ui`), patterns via `@/components/ui/patterns`, Radix modal via `components/ui/dialog.tsx`, sonner toasts (mounted in `app/layout.tsx`), typed client `lib/api/client.ts`, auth/audit via `lib/auth/admin-api.ts` + `lib/auth/permissions.ts`. Standing directive (docs/design-system/AUTOLENIS_UI_SPEC.md): **no net-new component system**. All foundation additions are extensions of the existing kit tiers.
- Do-not-modify perimeter, locked compliance language, human-in-the-loop for financial/irreversible actions — see mission ledger header.
- CI gate per unit: `pnpm tsc --noEmit && pnpm lint && pnpm build` (lint warnings ≤ 82, monotonic). Schema changes → prisma validate/generate + migration + idempotent SQL under `prisma/migrations/manual_supabase_sql/`.

## Unit breakdown & sequencing rationale

Foundation first (everything downstream consumes it). Then **correctness & safety** (silent failures, dead financial/moderation controls, authz gaps) before UX polish, because a control that lies is worse than one that's ugly. Then compliance surfaces (CRM suppression/consent). Then automation (needs the useAutoRefresh/foundation). Design elevation last — it's the widest, lowest-risk sweep and is naturally incremental.

| # | Unit | Contents (defects → fixes; see LEDGER for evidence) |
|---|---|---|
| 0 | **FOUNDATION** | Add to kit (primitives tier): `ConfirmDialog` (Radix dialog composition: title, consequence text, optional required-reason textarea, destructive variant, busy state) + `ErrorState` (inline alert + retry + correlation id) + `useAutoRefresh` hook (interval + document-visibility pause + manual refresh) + `exportCsv` util. Add `app/admin/*/error.tsx` segment boundaries via one shared `AdminSegmentError` component for the ~10 highest-risk segments. Export all through `@/components/ui/kit`. |
| 1 | **Core ops & authz quick wins** | queues: res.ok check + surface errors + delete placeholder button. system-health: stop swallowing errors, honest degraded state. activity: honest liveness (auto-refresh via hook). analytics: loading.tsx. ai: graceful chat fallback. messages/[threadId]: aria-label. affiliates/onboarding: requireAdmin + try/catch. faith-content children: SUPER/OPS gate to match parent. |
| 2 | **Dead controls** | testimonials: wire Approve/Reject → existing PATCH (client component + confirm + toast). referral-milestones: wire Pay → confirm + reason + audit + idempotent mark-paid route (or remove if no payout rail — decide against schema). esign hub: reuse AdminESignActions for Resend/Void. contract-shield/rules: functional Edit. |
| 3 | **Deals & auctions** | ConfirmDialog on Cancel Deal / Trigger Refund / Override Shield / Remove Dealer / auction Refund. router.refresh() after doAction in AdminDealTabs + AdminAuctionDetail. Real Refunds tab (reuse /payments/refunds query). offers: empty + error states. StartAuctionButton: honest label/flow. |
| 4 | **Requests & buyers** | AdminRequestActionButtons + CompleteCheckpointButton: res.ok + toast. requests: take + pagination. requests/[id]: render-or-drop buyerUpdates. buyer-sources: loading.tsx + toast instead of alert. vehicle-requests: unify detail/send-to-dealers/status on canonical VehicleRequest model; fix silent status no-op. |
| 5 | **Payments & reports** | Payments Refunds tab: real reason/stripeRef/refundedAt. Affiliate tab: error-vs-empty. deposits/refunds pages: error handling. reports index: link all 9; merge or cross-link affiliate/affiliates; funnel + pipeline: error/empty states. |
| 6 | **Dealers & inventory** | demand-gap: remove Math.random (real signal or explicit "unavailable"). markets: wire existing CRUD routes. coverage-map: call existing route. dealers/applications: client actions with reason + confirm (kill raw form→JSON). inventory/[id]: wire Deactivate/Resync or remove. RejectFormClient: confirm. contributions: empty state. |
| 7 | **CRM compliance** | Suppression manager: real page + `/api/admin/crm/suppression` route reusing `lib/services/suppression.service.ts`. Bulk-send: confirm step + pre-send consent preview; enforce consent_email server-side; SMS preview counts actual selection server-side. contacts/[id]: remove-or-wire 4 dead buttons; consentSms in disabled check. Campaign pause/cancel (PATCH + UI). Contrast bug fix (text-gray-900 on blue). |
| 8 | **Growth & settings** | settings: surface weights load error; remove/label inert links. seo/schema: fix filter + empty state. content: sanitize innerHTML (or verify upstream sanitizer). refinance/compliance: import EXCLUDED_STATES. documents/contracts: openable file links. |
| 9 | **Automation** | useAutoRefresh on queues/system-health/manual-reviews/operations. Reconciliation view (Stripe refs vs deposits/ledger) surfacing mismatches read-only. support: wire impersonation UI to existing guarded APIs. inbox conversation-list polling. |
| 10 | **Design elevation** | Adopt kit primitives/patterns on highest-traffic ad-hoc list pages (buyers, deals, payments, dealers) as time allows; consolidate hand-rolled toasts onto sonner where touched. |

## Per-unit workflow (A→F)
A. Refresh evidence (read the touched files). B. Fix functional defects. C. Elevate states/UX with kit primitives. D. Add automation where it fits. E. Verification gate: tsc + lint + build green; zero new `any`/console.*; behavioral checklist per fix; a11y spot-check. F. Commit `admin(<unit>): …`, update LEDGER row to DONE, advance.

## Resume protocol
Read LEDGER first (unit table + blockers), then this plan. Continue at the first non-DONE unit. CI baseline at start: tsc 0 errors, lint 0 errors/82 warnings.
