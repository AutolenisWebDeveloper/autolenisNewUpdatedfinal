# Phase 2 — Gap & Defect Analysis

Concrete defects only, each with file path + evidence. Areas verified-good are listed at the end so the report is not just a defect list.

## P0 — Broken access control (FIXED in Phase 4)
**18 admin CRM/search GET handlers read sensitive data via the service-role Supabase client (`getServiceSupabase()`, which bypasses RLS) with NO authentication.** Because `proxy.ts` returns early for all `/api/*` requests after CSRF (lines 379–390) and does **not** enforce session/role auth for API routes, these endpoints were reachable **unauthenticated**, leaking contact PII (names, emails, phones), CRM conversations, sent email/SMS, campaigns, segments, templates, and tasks.

Detection: per-handler scan (file-level grep produced false negatives — many files guard POST/PATCH but left GET open).

| Handler | File | Data exposed |
|---|---|---|
| GET | `app/api/admin/search/route.ts` | contact PII search (name/email/phone/stage) |
| GET | `app/api/admin/crm/conversations/route.ts` | all conversations + message previews + contact PII |
| GET | `app/api/admin/crm/conversations/[id]/messages/route.ts` | full message bodies |
| GET | `app/api/admin/crm/messages/sent/route.ts` | sent email/SMS timeline + contact PII |
| GET | `app/api/admin/crm/contacts/route.ts` | contact list (paginated PII) |
| GET | `app/api/admin/crm/contacts/[id]/route.ts` | full contact detail |
| GET | `app/api/admin/crm/tasks/route.ts` | CRM tasks |
| GET | `app/api/admin/crm/badges/route.ts` | unread/overdue counts |
| GET | `app/api/admin/crm/campaigns/route.ts` + `[id]` | campaigns + recipient funnel |
| GET | `app/api/admin/crm/segments/route.ts` + `[id]` | segments |
| GET | `app/api/admin/crm/templates/route.ts` + `[id]` | email templates |
| GET | `app/api/admin/crm/automations/route.ts`, `[id]`, `[id]/enrollments`, `prebuilt` | workflows + enrollments |

**Fix:** added the canonical admin guard to each GET handler:
```ts
const actor = await getAdminActor();
if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
```
(matches the existing guard already present in the POST/PATCH/DELETE handlers of the same files).

## P1 — Missing Stripe idempotency keys on refunds (FIXED in Phase 4)
Refund `refunds.create()` calls in the admin action routes lacked idempotency keys, while the dedicated refund endpoints (`payments/deposit/[id]/refund`, `payments/concierge-fee/[id]/refund`) correctly use them. On retry (timeout/network), a duplicate refund request could be issued.
- `app/api/admin/deals/[dealId]/action/route.ts` — lines 158 (DEAL cancel) and 207 (REFUND_TRIGGERED)
- `app/api/admin/auctions/[auctionId]/action/route.ts` — line 132 (AUCTION_REFUND_TRIGGERED)

**Fix:** added `{ idempotencyKey: \`refund-deposit-${deposit.id}\` }` to each call (deduplicates retries that refund the same deposit).

## P2 — Affiliate payout request has no append-only audit-log entry (NOT fixed — see reason)
`app/api/affiliate/payouts/request/route.ts` creates an `AffiliatePayout` row + an admin `Notification`, but writes no entry to `AdminAuditLog`/`AuditLog`.
- **Reason not fixed:** `AdminAuditLog` requires `adminId`/`adminEmail` and `AuditLog.action` is the admin-scoped `AdminActionType` enum — neither models an affiliate self-service actor. The `AffiliatePayout` row (affiliateId, amountCents, status, requestedAt) is itself the durable, timestamped system-of-record for the request, and an admin Notification is also emitted. Forcing a write into an admin-scoped table would be a wrong-schema change. Recommended owner: backend — add a generic actor-agnostic audit sink (or extend the enum) post-launch if a tamper-proof affiliate trail is required.
- **Risk:** Low. The request is already durably recorded; only a unified cross-actor audit stream is missing.

## P2 — Fee wording nuance (NOT a violation; noted)
User-facing copy says the $99 is "fully refundable (if no deal is reached)"; internal compliance notes describe it as access fee / "not a deposit". The compliance audit concluded the user-facing phrasing is transparent and matches business logic (returned when the auction yields no acceptable offer). No change required; flagged for product/legal awareness.

## Verified-good (no defect)
- **Stripe webhook** (`app/api/webhooks/stripe/route.ts`): signature verified via `constructEvent`; idempotent via `PaymentProviderEvent.eventId` unique constraint + race-safe P2002 handling.
- **Dedicated payment/payout/refund endpoints**: auth-enforced, idempotency keys present, audit logged.
- **Insurance gating**: COMPLIANT — does not block shortlist/search/auction; gates only contract/pickup; proof-upload path exists (`api/buyer/insurance/upload-proof`).
- **Fee/price separation**: COMPLIANT — offers validated on dealer OTD only; AutoLenis fee/deposit are separate Stripe PIs and separate tables.
- **Compliance language**: no misleading lender/approval language, no guarantees, fees disclosed (prequal/approval terms correctly disclaimed with FCRA notices).
- **Buyer/Dealer/Affiliate API authz**: per-handler scan found no unguarded handlers.
- **`dealers/[dealerId]/status`**: initially flagged by file scan but VERIFIED guarded (auth in shared `handleStatusChange` helper, with role checks for SUSPEND/TERMINATE) — false positive, no change.
