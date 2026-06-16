# AutoLenis — Nurture SMS Copy Reference

SMS has no template table. These bodies are pasted into the `body` field of the
`/api/crm/dispatch/sms` call inside each Make scenario.

**Do NOT include an opt-out line in the body.** Verified in
`frontend/lib/services/sms/crm-sms.ts:109`: the dispatch layer automatically
appends `"\n\nReply STOP to opt out."` to every message. Adding it here would
double it and waste ~24 characters. Authored bodies below are opt-out-free; the
platform adds it at send time.

## Enforcement verified in code (`frontend/lib/services/sms/crm-sms.ts`)
- **Consent** — send blocked unless `consent_sms = true` and `do_not_contact = false` (`:76`).
- **Suppression** — checks `sms_suppression` AND the Prisma `SmsOptOut` table; **fails closed** on lookup error (`:80–89`).
- **Quiet hours** — recipient-local 08:00–21:00 via `isRecipientInQuietHours`; CONUS-safe ET∩PT fallback when location is unknown (`:92–94`).
- **Idempotency** — enforced by the dispatch-auth duplicate check on the route.
- **STOP** — handled by the inbound Twilio webhook (`SuppressionService.suppressSms` → upserts `sms_suppression`); not duplicated in the send path.

| Campaign / trigger | Body (opt-out auto-appended by platform) |
|---|---|
| **Vehicle request** `vehicle_request_submitted` | `AutoLenis: {{firstName}}, your request is in. We're inviting dealers to compete. We'll text you when your auction opens.` |
| **Auction live** `auction_started` | `AutoLenis: {{firstName}}, your auction is live — dealers are competing now. See offers: {{auctionUrl}}` |
| **Offer received** `offer_received` | `AutoLenis: New out-the-door offer in your auction, {{firstName}}. Compare it now: {{offerUrl}}` |
| **Multiple offers** `offer_received` (2+) | `AutoLenis: {{firstName}}, multiple dealers have made offers. Compare side by side: {{offerUrl}}` |
| **Deposit confirmed** `deposit_paid` | `AutoLenis: Deposit confirmed, {{firstName}}. Your auction can proceed. Dashboard: {{dashboardUrl}}` |
| **Deal formed** `offer_selected` | `AutoLenis: {{firstName}}, you picked an offer. Next: financing, contract, pickup. Continue: {{dashboardUrl}}` |
| **Contract signed** `docusign_signed` | `AutoLenis: Contract signed, {{firstName}}. Last step is pickup — details: {{dashboardUrl}}` |
| **Saved search confirm** `saved_search_created` | `AutoLenis: {{firstName}}, your search is saved. We'll text you when matching vehicles appear. View searches: {{dashboardUrl}}` |
| **Win-back** `buyer_inactive` | `AutoLenis: {{firstName}}, your dealers are still ready to compete. Pick up where you left off: {{dashboardUrl}}` |
| **Post-close D7** `purchase_completed` +7d | `AutoLenis: Congrats on your vehicle, {{firstName}}! How did it go? Quick feedback: {{dashboardUrl}}` |

## Trigger verification (checked against `emitDomainEvent` call sites + `lib/inngest/functions.ts`)
- **8 triggers are emitted via `emitDomainEvent` and forwarded to the Make router today.** Confirmed call sites:

  | Trigger | Emit site |
  |---|---|
  | `vehicle_request_submitted` | `frontend/app/api/public/request-vehicle/route.ts:589` |
  | `auction_started` | `frontend/lib/services/auction/auction.service.ts:43` |
  | `offer_received` (single + "multiple offers" rows) | `frontend/lib/services/offer/offer.service.ts:237` |
  | `deposit_paid` | `frontend/app/api/webhooks/stripe/route.ts:181` |
  | `offer_selected` | `frontend/app/api/buyer/auctions/[auctionId]/select-offer/route.ts:109` |
  | `docusign_signed` | `frontend/lib/services/esign/esign.service.ts:151` |
  | `saved_search_created` | `frontend/app/api/buyer/searches/route.ts:50` |
  | `purchase_completed` | `frontend/app/api/dealer/pickup/scan/route.ts:91` + `frontend/app/api/admin/deals/[dealId]/pickup/complete/route.ts:138` |

  All reach Make via `emitDomainEvent` → `after(() => forwardToMake(envelope))`
  (`frontend/lib/events/emit.ts:142–151`), gated only on `MAKE_WEBHOOK_URL`.

- **`saved_search_created` is a confirmation, not a match alert.** It fires when a
  buyer *saves* a search (`buyer/searches/route.ts:50`). There is **no**
  match-alert event in the codebase (no `saved_search_match`), so a "a matching
  vehicle is now available" SMS cannot be wired until such an event is emitted.

- **`buyer_inactive` IS emitted — but never reaches Make.** It is fired hourly by
  `inactivityScannerFn` (`frontend/lib/inngest/functions.ts:640`, cron
  `'0 * * * *'`), which finds early-stage contacts stale >72h and triggers
  `buyer_inactive` per contact (`:669`). Critically, the scanner calls
  `WorkflowEngine.triggerForEvent(...)` directly — **not** `emitDomainEvent` — so
  it drives only the legacy in-app engine (unconditionally, ignoring the
  `CRM_INAPP_ENGINE_ENABLED` flag) and **never calls `forwardToMake`.** The
  Make-driven win-back SMS therefore has no live trigger today. The fix is to
  route the scanner through `emitDomainEvent` (or add a Make forward) — do **not**
  build a new inactivity job; one already exists.

## Length note
Authored bodies sit ~95–125 chars. After `{{firstName}}`/URL expansion **and** the
auto-appended `"\n\nReply STOP to opt out."` (~24 chars), several land just over
160 and bill as 2 segments. That's a cost detail, not a compliance issue — keep
bodies tight to stay single-segment where it matters.

## Channel rules (verified)
- **Transactional vs. promotional.** The active-transaction rows (auction, offer,
  deposit, contract) are legitimately transactional. Saved-search confirm, win-back,
  and post-close survey lean promotional — they still pass through the same
  `consent_sms` gate, so they only reach opted-in contacts.
- **Quiet hours / suppression / idempotency** — all enforced by the dispatch layer;
  the Make scenario does not handle them.
- **Inbound STOP — reconcile the two handlers.** `app/api/webhooks/twilio/inbound`
  writes `sms_suppression` (and does inbox routing / conversations / timeline);
  `app/api/twilio/sms/inbound` writes the Prisma `SmsOptOut` table **and
  `buyer.optedOutSms`** (plus AI opt-out-intent classification). The two also
  validate against different signing URLs (`NEXT_PUBLIC_APP_URL` vs
  `TWILIO_WEBHOOK_URL`). Only one is wired to the Twilio number; the other plane
  goes stale. Dispatch reads BOTH planes so sends stay safe, but the unwired
  handler's behavior (inbox threading, or AI classification) is silently lost.
  Confirm which URL is configured and consolidate.
- **A2P 10DLC.** None of these deliver at scale until 10DLC brand + campaign
  registration is approved — the long pole; start it now.
