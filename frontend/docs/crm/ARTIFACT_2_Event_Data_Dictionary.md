> Source: split verbatim from AUTOLENIS_CRM_PRODUCTION_PACKAGE.md. Statuses marked ❓/⚠ are superseded by AUTOLENIS_REPO_AUDIT.md where code was checked.

# ARTIFACT 2 — Event & Data Dictionary

The source of truth. Bind every automation to entries marked ✅; never route on ⚠ or unconfirmed ❓ without repo confirmation.

## 2.1 Event Registry

**Status:** ✅ confirmed-emitted · ⚠ defect (phantom/declared-unemitted) · ❓ confirm in repo audit.

| Event | Actor | Status | Notes |
|---|---|---|---|
| `buyer_signup` | Buyer | ✅ | Router live on this; triggers Welcome |
| `saved_search_created` | Buyer | ✅ | Fires on save; → saved_search_confirm |
| `prequal_started` | Buyer | ✅ | FCRA-safe, payload data-free (`{}`) |
| `vehicle_request_created` / `..._submitted` | Buyer | ❓ | Doc uses both names — reconcile to the emitted one; → vr_received |
| `vehicle_request_updated` | Buyer | ❓ | |
| `trade_in_submitted` | Buyer | ❓ | → trade_in series |
| `refinance_inquiry` | Buyer | ❓ | → refi series |
| `financing_requested` | Buyer | ❓ | No templates yet |
| `saved_vehicle` | Buyer | ❓ | |
| `auction_started` | Buyer/System | ❓ | → auction_live |
| `offer_received` / `offer_reviewed` / `offer_favorited` / `offer_accepted` | Buyer | ❓ | Confirm exact names; → offer_in / offer_multiple / deal_formed |
| `deal_completed` | Buyer/System | ❓ | → post-close series |
| `saved_search_match` | Buyer | ⚠ phantom | No emitter; only saved_search_created exists |
| `buyer_inactive` | Buyer | ⚠ declared, never emitted | Inactivity blocked until scheduled emitter built |
| `deposit_pending` | Buyer | ⚠ declared, never emitted | |
| `dealer_registered` / `dealer_verified` | Dealer | ❓ | → dealer series |
| `auction_invitation_received/accepted`, `offer_submitted/updated/withdrawn/won/lost` | Dealer | ❓ | |
| `dealer_inactive` | Dealer | ⚠ unemitted | Build emitter |
| `affiliate_registered/approved/link_created/lead_generated/conversion` | Affiliate | ❓ | → affiliate series |
| Visitor events (`page_viewed`, `article_viewed`, `calculator_completed`, `exit_intent_triggered`, `lead_magnet_downloaded`, `zura_conversation_started`, …) | Visitor | ❓ / DEFERRED | Behavioral tracking depth deferred until traffic |

**Standard event payload (target):** `{ event, contact_id, email, phone, occurred_at, attribution{...}, data{...} }`, HMAC-signed per `make-webhook.ts` (scheme ❓ confirm).

## 2.2 CRM Fields

| Field | Type | Purpose |
|---|---|---|
| `lead_score` (`contact_lead_score`, migration 06) | int | Cumulative behavioral score — verify migration applied to prod |
| `lifecycle_stage` | enum | Visitor/Lead/Buyer/… per §1.5 |
| `nurture_status` (recommended) | enum | Mirror of Make enrollment state (active/suppressed/reengagement) for app-side reconciliation |
| `consent_email` | bool | CAN-SPAM gate |
| `consent_sms` | bool | TCPA gate; read at dispatch |
| `source` | string | Capture source (§3) |
| `campaign` | string | Originating campaign |
| `contact_type` | enum | buyer/dealer/affiliate/visitor |
| Suppression: `sms_suppression`, `SmsOptOut`, email suppression | — | Read at every dispatch |

## 2.3 Database Relationships

*(model-level; confirm exact FKs in `schema.prisma`)*

```
Contact 1─* Buyer | Dealer | Affiliate         (role records hang off Contact)
Buyer   1─* VehicleRequest
VehicleRequest 1─1 Auction
Auction 1─* Offer            *─1 Dealer         (offers submitted by dealers)
Offer   1─0..1 Deal
Affiliate 1─* Referral ─* Contact (attribution)
Contact 1─* Event, Communication, Consent, Suppression, Enrollment-mirror
```

## 2.4 Attribution Fields

`utm_source` · `utm_campaign` · `utm_medium` · `utm_term` · `utm_content` · `referrer` · `affiliate_id` · `landing_page` · `first_touch_at` · `last_touch_at`.

**Target attribution chain:** Visitor → Lead → Vehicle Request → Auction → Offer → Deal → Revenue (reporting DEFERRED until traffic).
