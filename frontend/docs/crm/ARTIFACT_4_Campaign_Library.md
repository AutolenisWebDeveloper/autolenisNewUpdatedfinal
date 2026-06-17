> Source: split verbatim from AUTOLENIS_CRM_PRODUCTION_PACKAGE.md. Statuses marked ❓/⚠ are superseded by AUTOLENIS_REPO_AUDIT.md where code was checked.

# ARTIFACT 4 — Campaign Library

Format per campaign: Trigger · Audience · Emails · SMS · Timing · Goal · Status. **45 templates / 19 campaigns seeded in prod.**

## 4.1 Buyer Campaigns

| Campaign | Trigger | Emails (keys) | SMS | Timing | Goal | Status |
|---|---|---|---|---|---|---|
| Welcome | buyer_signup | welcome_d0, _d1_how_it_works, _d3_dealer_competition, _d5_what_to_expect, _d7_request | opt | d0/+24h/+48h/+48h/+48h (delta cadence live) | Activate → vehicle request | ✅ built (cadence in Make) |
| Vehicle Request | vehicle_request_created | vr_received | confirm SMS | on event | Confirm + set expectations | ✅ template; cadence ❓ |
| Auction | auction_started | auction_live | auction alert | on event | Drive engagement | ✅ template |
| Offer | offer_received/offer_* | offer_in, offer_multiple, deal_formed, deposit_confirmed, contract_signed | offer alerts | on event | Move to best-price/accept | ✅ templates |
| Financing | financing_requested | — | — | — | Coordinate financing | ⚠ no templates |
| Trade-In | trade_in_submitted | trade_in_value/_equity/_upgrade | opt | multi-touch | Convert trade interest | ✅ |
| Refinance | refinance_inquiry | refi_review/_savings/_options | opt | multi-touch | Convert refi interest | ✅ |
| Post-Purchase | deal_completed | postclose_d7_survey/_d30_review/_d60_referral/_d180_upgrade/_d365_replacement | opt | d7/d30/d60/d180/d365 | Retain + referral + repurchase | ✅ |
| Referral | post-close / referral | postclose_d60_referral (+ referral series ❓) | opt | day 60+ | Generate referrals | ◑ partial |
| Win-Back | buyer_inactive ⚠ | winback_1, winback_2 | win-back SMS (no live trigger) | on inactivity | Reactivate | ◑ content built, trigger missing |

**Supporting single-shots also seeded:** saved_search_confirm, calc_followup, magnet_deliver/_nurture, zura_followup, prequal_finish/_education, abandonment_touch_1/2/3, exit_intent_recovery.

## 4.2 Dealer Campaigns

| Campaign | Trigger | Emails | Timing | Goal | Status |
|---|---|---|---|---|---|
| Recruitment | cold list / outreach | — | — | Acquire first dealer | ⚠ none (Tier-1 outreach track) |
| Verification | dealer_registered | — | — | Complete verification | ⚠ none |
| Activation/Onboarding | dealer_verified | dealer_welcome, _profile, _auctions, _wins | onboarding sequence | First auction participation | ✅ |
| Reactivation | dealer_inactive ⚠ | — | — | Re-engage dormant | ⚠ none + trigger missing |

## 4.3 Affiliate Campaigns

| Campaign | Trigger | Emails | Goal | Status |
|---|---|---|---|---|
| Welcome | affiliate_approved | aff_welcome | Orient | ✅ |
| Activation | first link/lead | aff_first_lead, aff_traffic | Drive first conversions | ✅ |
| Milestones/Growth | thresholds | aff_commissions, aff_scale | Scale producers | ✅ |
| Reactivation | inactivity | — | Re-engage | ⚠ none |
