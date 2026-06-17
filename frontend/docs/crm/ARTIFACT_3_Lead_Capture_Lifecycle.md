> Source: split verbatim from AUTOLENIS_CRM_PRODUCTION_PACKAGE.md. Statuses marked ❓/⚠ are superseded by AUTOLENIS_REPO_AUDIT.md where code was checked.

# ARTIFACT 3 — Lead Capture & Lifecycle Specification

## 3.1 Lead Sources

| Source | Captures | Emits (target) | Status |
|---|---|---|---|
| Landing pages | name, email, phone, vehicle interest, source, UTM | lead_captured/page event | ❓ |
| Blog articles | article, category, time, scroll | article_viewed | ❓ / deferred |
| Zura AI | name, email, phone, interests, history, intent | zura_conversation_started + CRM event | ❓ |
| Trade-in calculator | vehicle info, trade interest | trade_in_submitted | ❓ |
| Refinance calculator | loan info, refi interest | refinance_inquiry | ❓ |
| Financing calculator | payment goals, budget | financing_requested | ❓ (no templates) |
| Saved search | makes/models/budget/geo | saved_search_created | ✅ |
| Exit intent | email, vehicle interest | exit_intent_triggered | ❓ |
| Newsletter | email, interests | newsletter_signup | ❓ |
| Lead magnet | name, email, phone, category | lead_magnet_downloaded | ❓ |
| Dealer application | dealer profile/verification | dealer_registered | ❓ |
| Affiliate application | affiliate profile | affiliate_registered | ❓ |

## 3.2 Lifecycles (stages → trigger)

- **Visitor:** Visitor → Lead (email captured) → Buyer (signup)
- **Buyer:** Lead → Vehicle Request (`vehicle_request_created`) → Auction (`auction_started`) → Offer (`offer_received`) → Deal (`deal_completed`) → Post-close
- **Dealer:** Prospect → Registered (`dealer_registered`) → Verified (`dealer_verified`) → Active Dealer (first auction participation) → Reactivation (`dealer_inactive` ⚠)
- **Affiliate:** Applicant → Approved (`affiliate_approved`) → Active (`affiliate_link_created`/`lead_generated`) → Producer (`affiliate_conversion`) → Reactivation

Each transition must be driven by a verified-emitted event (Artifact 2). Transitions whose event is ⚠/❓ are not yet wired.
