# 09 — Admin CRM/Search Authorization + Refund Idempotency (PR #225)

**Date:** 2026-06-16 · **Branch:** `claude/jolly-lamport-pcw295` · **PR #225**
**Relationship to prior work:** Additive hardening pass layered on top of the closure work in `REPORT.md` / `03–08` (PR #223). The two defects below were **not** covered by that audit (its API-authz finding focused on the deal seam and on buyer/dealer/affiliate routes; the admin **CRM GET** surface was not enumerated per-handler). Merged `origin/main` into this branch; all of PR #223's hardening is retained.

---

## Defect 1 (P0) — Unauthenticated admin CRM/search GET endpoints
**18 admin GET handlers read sensitive data via the service-role Supabase client (`getServiceSupabase()`, RLS bypassed) with no authentication.** Per `00_baseline.md`/`02_gaps.md`, `proxy.ts` returns early for all `/api/*` after CSRF and delegates authz to handlers — so these were reachable **unauthenticated**, exposing contact PII, conversations, sent email/SMS, campaigns, segments, templates, tasks, and automations.

Detection: per-handler scan (file-level grep gave false negatives — several files guarded POST/PATCH but left GET open; e.g. `crm/tasks` GET unguarded while its POST was guarded).

Files fixed (GET handler in each):
`app/api/admin/search/route.ts`, and under `app/api/admin/crm/`: `conversations/route.ts`, `conversations/[id]/messages/route.ts`, `messages/sent/route.ts`, `contacts/route.ts`, `contacts/[id]/route.ts`, `tasks/route.ts`, `badges/route.ts`, `campaigns/route.ts`, `campaigns/[id]/route.ts`, `segments/route.ts`, `segments/[id]/route.ts`, `templates/route.ts`, `templates/[id]/route.ts`, `automations/route.ts`, `automations/[id]/route.ts`, `automations/[id]/enrollments/route.ts`, `automations/prebuilt/route.ts`.

Fix (matches the guard already present in the same files' mutation handlers):
```ts
const actor = await getAdminActor();
if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
```
**Proof:** per-handler scanner before = 18 unguarded / after = 0 (only `dealers/[dealerId]/status` remains, a verified false positive — guard is in its shared `handleStatusChange` helper).

## Defect 2 (P1) — Missing Stripe idempotency keys on admin refunds
`refunds.create()` in the admin action routes lacked idempotency keys (double-refund risk on retry), while the dedicated refund endpoints already use them.
- `app/api/admin/deals/[dealId]/action/route.ts` — 2 calls (DEAL cancel + REFUND_TRIGGERED)
- `app/api/admin/auctions/[auctionId]/action/route.ts` — 1 call (AUCTION_REFUND_TRIGGERED)

Fix: `{ idempotencyKey: \`refund-deposit-${deposit.id}\` }` on each call. These changes auto-merged cleanly with PR #223's edits to the same files (PR #223 added gate logic; the idempotency keys sit on the refund calls themselves) — verified present post-merge at deals lines 185/237 and auctions line 135.

## Not fixed (documented)
- **Affiliate payout request audit log** (`app/api/affiliate/payouts/request/route.ts`): no actor-agnostic audit model exists (`AdminAuditLog` requires admin identity; `AuditLog.action` is the admin-scoped `AdminActionType` enum). The `AffiliatePayout` row + admin Notification already form the durable record. Low risk; deferred to a post-launch actor-agnostic audit sink.

## Verification (post-merge)
- No conflict markers remain; merge of `origin/main` resolved (docs → main's canonical versions; code → both change sets retained).
- `tsc --noEmit`, `eslint`, unit tests, and `next build` re-run after the merge (results recorded in the PR / commit).
- Compliance language, insurance gating, and fee/price separation were independently re-audited this pass and remain clean (no new violations).
