# Parity map — inventory area (Stage 4 vehicle definition + §22a inventory / qualified results / shortlist / candidates, co-buyer capture, trade packet capture, §32 rows, §33 steps 28/30/31)

Repo: /home/user/autolenisNewUpdatedfinal (HEAD 0cd399f, branch claude/autolenis-transaction-implementation-hzyg4l). All paths below are relative to `frontend/` unless prefixed. READ-ONLY inspection; no command other than rg/grep/sed/cat/find/git was run. Every claim is from running code or the Prisma schema; comments and docs are quoted only as context.

## Summary (10 lines)

1. The **catalogue side of §22a is largely landed** (commit ecb1ada): distance label + per-card action via `shortlistGate`, 7-day flag / 30-day withdrawal, server-side radius+freshness enforcement in `POST /api/buyer/shortlist`, "Find one like this near me" pre-fill, full dealer object persisted on ingest, rooftop MATCH (never mint) into `inventory_items.rooftop_id`, one budgeted daily sweep, 80%/exhausted Operations alerts, num_found-based short-run detection, configurable market. Two migrations (20261104, 20261105) are written but marked NOT APPLIED.
2. The **live post-approval qualified-results query does NOT exist**. `/api/buyer/search` (`app/api/buyer/search/route.ts`) queries `inventory_items` only; there is no provider call, no criteria hash, no cache. §33 step 31 and the §22a "Qualified results" surface are MISSING; the buyer's "search" is the swept catalogue with a 50-mile default radius that *filters* (drops) rows — the inverse of the catalogue rule.
3. The adapter does **not** pass `include_dealer_object` / `include_mc_dealership_object` / `mc_category` (`marketcheck.adapter.ts:346-383`); it reads `listing.dealer.*` and persists it, so rooftop capture works only if the provider returns the object by default — UNVERIFIED against the live API in this session. The admin search tool hits a different host, does not clamp radius and does not ingest the dealer object.
4. **Candidate model is MISSING**: `AuctionVehicle` has no distance and `Offer` has no `auctionVehicleId`; there is no code path that turns shortlist items into `AuctionVehicle` rows (the only automatic path builds one AuctionVehicle from the latest VehicleRequest make: `dealer-invitation.service.ts:117-147`). Candidate revalidation (price/VIN/location/freshness) before payment does not exist; only the admin attach route checks availability.
5. **Five-candidate cap and in-radius rule are application-only** (`route.ts:91-93`, `route.ts:62-79`); `shortlist_items` DDL has only PK + unique(shortlist_id, inventory_item_id) + FK (init migration:174-182, 759, 867). §32 "enforce at write time" (DB) is PARTIAL. A second, ungated `addToShortlist` still exists in `lib/services/shortlist/shortlist.service.ts:34-42` (no callers) → DUPLICATED.
6. **Approved-amount handling contradicts the spec**: the buyer search hard-filters `priceCents <= maxOtdAmountCents` (`search/route.ts:64-82`) and the public detail page disables the shortlist button when price exceeds budget (`[vehicleId]/page.tsx:379-386`) — "filter generously" and "browsing is not the place to enforce it" are BROKEN in the strict direction (recorded as a safeguard decision for the owner, not silently relaxed).
7. **Freshness clocks conflict**: `FRESHNESS_WINDOW_MS = 48h` drives both `executableSupplyWhere` and the stale sweep (`inventory-eligibility.ts:272`, `stale-sweep.service.ts:70`); once `INVENTORY_STALE_SWEEP_MODE=enforce`, a swept row is deactivated at 48-72h and hidden from the catalogue (`isActive: true` filters) long before the spec's 7-day note / 30-day view-but-no-shortlist windows can apply. Spec §32 `inventory_items` row is PARTIAL.
8. **Co-buyer: MISSING entirely** (no model, no table, no route). The only trace is a `coBuyer: boolean` on the public request-vehicle form that lands in `Notification.metadata` (`app/api/public/request-vehicle/route.ts:106, 603-609`).
9. **Trade packet: PARTIAL**. `TradeInSubmission` carries vin/year/make/model/trim/mileage/condition/loanStatus/loanBalanceCents/notes (`schema.prisma:2036-2056`); missing `vehicle_request_id`, `deal_id`, `lienholder_name`, `payoff_good_through_date`, `title_in_hand`, `title_state`, `has_second_key`, `photo_urls`, `bringing_to_pickup`. The buyer form posts to `/api/buyer/trade-in`; the public form stores a richer JSON blob on `BuyerOpportunity.tradeInDetails` (a second, unlinked trade capture). Buyer-facing copy says dealers see it but never states "the dealership performs the appraisal"; only the calculator widget says "not a dealer offer".
10. Copy prohibitions are mostly honoured on the public catalogue/detail pages, but `INVENTORY_LANES.LANE_1.label = "Verified"` (`lib/constants.ts:127`) is still rendered on the buyer shortlist card (`ShortlistClient.tsx:179, 204`), and the public empty state says "Browsing inventory from verified dealers" (`(public)/inventory/page.tsx:312`).

Status legend: ALREADY CORRECT | PARTIAL | BROKEN | MISSING | DUPLICATED | UNVERIFIED.

---

## Rows

### Stage 4 — Vehicle definition, co-buyer, and trade (spec lines 404-439)

**R1** · spec_ref: Stage 4 Entry (L406) · requirement: Entry = current approval.
- status: ALREADY CORRECT (journey) / PARTIAL (surfaces)
- current: `lib/services/buyer/journey.ts:101-109` moves to `search` only when `onboardingComplete && prequalValid`; `app/buyer/search/page.tsx:142-159` renders for any buyer with a prequal-state banner; `/api/buyer/search` does not require a valid prequal (only auth, `search/route.ts:20-23`); `/api/buyer/requests` explicitly does not gate on prequal (`requests/route.ts:122`).
- evidence: journey.ts:106-109 `const prereqForSearch = facts.onboardingComplete && facts.prequalValid;`; search/route.ts:58-67 budget only applied when `isPrequalValid`.
- stronger safeguard: none.
- required change: keep the request path open (spec Stage 5 allows custom request pre-approval elsewhere), but gate the *qualified results* surface (when built) on `isPrequalValid`.
- legacy path: `app/buyer/search` (catalogue search) remains reachable pre-approval as "general catalogue".
- notes: nav-gating comment says early funnel is always accessible (`nav-gating.ts:12-13`).

**R2** · spec_ref: §4a L410 · requirement: System presents qualified results automatically.
- status: MISSING
- current: No automatic post-approval results. `app/buyer/search` is a manual filter UI over `inventory_items`. `findMatchedVehicles` (`lib/services/inventory/inventory-match.service.ts:23-75`) ranks eligible supply by make/budget for the dashboard but has no ZIP/radius/criteria and is not a provider query.
- evidence: search/route.ts:127-137 `prisma.inventoryItem.findMany({ where, ...})`; no `fetch(` to a provider anywhere under `app/api/buyer/**` (rg negative for `marketcheck` in app/api/buyer).
- stronger safeguard: none.
- required change: build the qualified-results service (see R33-R36) and surface it automatically after APPROVED.
- legacy path: `/buyer/search`, `findMatchedVehicles` dashboard widget.

**R3** · spec_ref: §4a L410 · requirement: Buyer deliberately adds up to five to a shortlist; system never saves on the buyer's behalf.
- status: ALREADY CORRECT
- current: Only buyer-initiated `POST /api/buyer/shortlist` writes `shortlistItem` (`app/api/buyer/shortlist/route.ts:99-101`); cap 5 by AVAILABLE count (`route.ts:91-93`, `MAX_SHORTLIST_ITEMS` `lib/constants.ts:47`).
- evidence: rg `shortlistItem.create` → only route.ts:99 and shortlist.service.ts:41 (no callers). No cron/service writes shortlist rows.
- stronger safeguard: cap counts available candidates only so sold cars do not lock the buyer out (`shortlist.service.ts:14-28`).
- required change: none for the rule; see R38 for DB-level cap.
- legacy path: n/a.

**R4** · spec_ref: §4a L410 · requirement: Custom request where results thin/absent; both write the SAME Vehicle Request, only `entry_type` differs.
- status: PARTIAL
- current: Custom request → `POST /api/buyer/requests` → `intakeBuyerRequest` → `VehicleRequest` (`requests/route.ts:169-199`). Shortlist does NOT write a VehicleRequest at all; no `entry_type` column (rg `entry_type|entryType` negative in app/lib/prisma).
- evidence: schema.prisma:1022-1070 VehicleRequest has no entry type; shortlist route writes only `shortlist_items`.
- stronger safeguard: none.
- required change: add `entry_type` (INVENTORY | CUSTOM) to `vehicle_requests`; create/attach a VehicleRequest when the first candidate is shortlisted (or at deposit) so both paths converge on one request.
- legacy path: shortlist-only journey with no VehicleRequest (deposit create-intent gates on shortlist rows only, `deposit/create-intent/route.ts:76-84`).

**R5** · spec_ref: §4a L410 · requirement: Out-of-radius listing cannot be shortlisted; offers to seed a custom request.
- status: ALREADY CORRECT
- current: `shortlistGate` returns `REQUEST_SIMILAR/OUT_OF_RADIUS` beyond `SHORTLIST_RADIUS_MILES=100` (`lib/services/shortlist/shortlist-radius.ts:87, 186-188`); server refuses with the same code (`shortlist/route.ts:75-79`); detail page CTA = `buildSimilarRequestHref` (`(public)/inventory/[vehicleId]/page.tsx:122-125, 365-378`).
- evidence: test `app/api/buyer/shortlist/__tests__/shortlist-radius-gate.test.ts:102` "a listing beyond 100 miles is REFUSED even though the UI would have hidden the button".
- stronger safeguard: unplaceable listing (null coords) and unplaceable buyer both fail CLOSED (`shortlist-radius.ts:183-185`, route.ts:52-60).
- required change: none. Buyer-portal search cards (`BuyerSearchClient.tsx:603-618`) do not run the gate client-side (server does) — cosmetic only.
- legacy path: `/buyer/search` cards show a "Shortlist" button for out-of-radius rows; server refuses.

**R6** · spec_ref: §4a L412 · requirement: Each shortlisted candidate revalidated for price, availability, VIN, location and listing freshness before the transaction continues; carries distance.
- status: MISSING (revalidation) / PARTIAL (availability only, admin path)
- current: `deposit/create-intent/route.ts:76-84` counts shortlist ROWS (not availability). Only `app/api/admin/buyers/[buyerId]/auction-vehicles/route.ts:76-97` checks `isShortlistItemAvailable` (isActive + price>0). No VIN, location, price-drift or freshness re-check anywhere. No distance stored on `ShortlistItem` or `AuctionVehicle` (schema.prisma:389-399, 500-515).
- evidence: create-intent:76 `prisma.shortlistItem.count({ where: { shortlist: { buyerId } } })`; AuctionVehicle columns: auctionId, inventoryItemId, year, make, model, trim, mileage, notes.
- stronger safeguard: admin attach refuses unavailable linked vehicles (auction-vehicles route:85-96).
- required change: add a `revalidateCandidate(inventoryItemId, buyer)` step (re-run `shortlistGate` + compare priceCents/VIN against the stored snapshot) invoked at deposit create-intent and at auction activation; persist `distance_miles` on the candidate row; on failure return buyer to search with reason and keep the request open.
- legacy path: create-intent shortlist gate (row count) — weaker than `journey.ts` which uses `countAvailableItems` (`app/buyer/layout.tsx:215`): the two disagree.

**R7** · spec_ref: §4a L412 · requirement: Vehicle failing revalidation returns buyer to search with explanation; request remains open.
- status: PARTIAL
- current: Unavailable shortlist items stay visible with "No longer available" + "Find one like this" (`app/buyer/shortlist/page.tsx:41-88`, `ShortlistClient.tsx:238-300`). No explanation path for price/VIN/location changes.
- evidence: shortlist-availability.ts:320-325 availability = isActive && priceCents>0 only.
- required change: extend with the revalidation reasons from R6.

**R8** · spec_ref: §4a L414 · requirement: Custom request records new/used, year range, make, model, trim, body type, drivetrain, exterior/interior colour, required features, preferred features, acceptable mileage, acceptable condition, purchase timeframe, approved budget, expected down payment, financing preference, pickup/delivery preference, buyer notes.
- status: PARTIAL
- current: Form state (`app/buyer/requests/new/page.tsx:60-100`): vehicleType, condition(New/Used/Either), makeModel, timeline, yearMin/Max, purchaseTimeframe, zip, budget, downPayment, monthlyTarget, trim, maxMileage, features (single list), financing. Persisted first-class on `VehicleRequest`: makePreference, modelPreference, yearMin, yearMax, maxBudgetCents, notes (schema.prisma:1022-1032). trim/maxMileage/downPayment/features/condition are packed into `notes` as text + `<!--META:{json}-->` (`page.tsx:310-331`); condition folded into notes again server-side (`requests/route.ts:44-53, 188`). Financing → `VehicleRequestFinancing` (`requests/route.ts:230`). NOT captured anywhere: drivetrain, exterior/interior colour, preferred-vs-required split, acceptable condition grade, pickup-or-delivery preference.
- evidence: route.ts:133-145 body type; page.tsx:311-320 meta keys.
- stronger safeguard: none.
- required change: add structured columns (or a `criteria` JSON with a schema) for the missing fields; split `required_features` / `preferred_features`; stop round-tripping criteria through a notes blob.
- legacy path: `notes` META parser (`lib/services/vehicle-request/notes-parser.ts` per skill); admin detail reads `meta.*`.

**R9** · spec_ref: §4a L416 · requirement: Criteria travel into dealer invitations, offer validation, buyer comparison.
- status: PARTIAL (out of this area for invitations/offers; recorded for the criteria origin)
- current: `ensureAuctionVehicleFromRequest` carries only make/model/yearMin into `AuctionVehicle` (`dealer-invitation.service.ts:117-147`). Features/mileage/colour never leave the notes blob.
- required change: depends on R8 structured criteria.

**R10** · spec_ref: §4a L416 · requirement: A vehicle missing a REQUIRED criterion is flagged as a mismatch, never ranked as equivalent.
- status: MISSING
- current: `computeMatchScore` (`lib/services/inventory/inventory-match-score.ts:240-302`) is a weighted blend (make .35, model .25, year .15, price .15, lane .10); a make mismatch scores 0 on that factor but the item is still ranked and persisted (`request-inventory-match.service.ts:116-129`). No required/preferred distinction, no mismatch flag on `VehicleRequestMatchResult` (schema.prisma:3241-3256).
- required change: add `required` vs `preferred` criteria, a hard-exclude/flag for required misses, and a `mismatch_reasons` field on the match result.
- legacy path: `inventory-match-refresh` cron consumer.

**R11** · spec_ref: §4b L418-426 · requirement: Co-buyer record (name, email, phone, address, role, primary buyer's request, consent to share, required-signer flag); no SSN/credit/lender app; reaches dealer at reaffirmation; required signer blocks signed status.
- status: MISSING
- current: No `CoBuyer` model/table (rg `model CoBuyer|co_buyers|coBuyer` in schema negative). Only `coBuyer: z.boolean().optional()` on the public form (`app/api/public/request-vehicle/route.ts:106`), stored in `Notification.metadata` (`:603-609`) and shown on admin detail (`app/admin/vehicle-requests/[id]/VehicleRequestDetailClient.tsx:270`).
- evidence: rg across app/lib/components/prisma/scripts for cobuyer|co_buyer|co-buyer|coapplicant|co-applicant|joint → 3 files, all boolean-only.
- stronger safeguard: none (nothing collects SSN/credit for a co-buyer — trivially true).
- required change: new `co_buyers` table (FK vehicle_request_id, later deal_id), buyer-portal capture in Stage 4, consent text stored verbatim, `is_required_signer`, handoff at reaffirmation; signing gate in deal lifecycle (other area).
- legacy path: public-form boolean should be migrated into the new record's "primary buyer's request to include" flag.

**R12** · spec_ref: §4c L428-433 · requirement: Trade packet attached to the Vehicle Request and carried onto the Deal: year, make, model, trim, VIN, mileage, condition, photos, notes, ownership/lien status, lienholder name, estimated payoff, payoff good-through date, title availability + state, second key, bring-to-pickup.
- status: PARTIAL
- current: `TradeInSubmission` (schema.prisma:2036-2056): buyerId, vin, year, make, model, trim, mileage, condition, loanStatus, loanBalanceCents, notes, status, valuationCents, valuedAt. Written by `submitTradeIn` (`lib/services/trade-in/trade-in.service.ts:7-26`) from `POST /api/buyer/trade-in` (`app/api/buyer/trade-in/route.ts:6-19`), form `app/buyer/trade-in/page.tsx:19-21, 52-70` (fields vin, year, make, model, trim, mileage, condition, loanStatus, loanBalance, notes). Missing: vehicle_request_id, deal_id, lienholder_name, payoff_good_through_date, title_in_hand, title_state, has_second_key, photo_urls, bringing_to_pickup. Public form captures a richer packet (tradeYear…tradeTitleStatus, tradeAccidentHistory, `request-vehicle/route.ts:112-125`) into `BuyerOpportunity.tradeInDetails` JSON (`unified-buyer-intake.service.ts:234-235`) — a second, unlinked capture.
- evidence: schema rows quoted above; `hasTradeIn` boolean on intake (`requests/route.ts:198`).
- stronger safeguard: none.
- required change: §32 `trade_in_submissions` column additions; link to VehicleRequest/Deal; migrate `BuyerOpportunity.tradeInDetails` into the canonical row (dedupe by buyer+VIN); add photo upload.
- legacy path: `BuyerOpportunity.tradeInDetails` (public form), `VehicleRequestFinancing.tradeIn` boolean (`schema.prisma` VehicleRequestFinancing "Universal fields").

**R13** · spec_ref: §4c L432 · requirement: AutoLenis does not appraise/guarantee/verify payoff/transfer title/take possession; every buyer-facing trade screen states the dealership performs the appraisal and any estimate is not an offer.
- status: PARTIAL
- current: Widget states "not market data, not a dealer offer, and not a lender valuation. Actual trade-in value is determined by the dealer" (`components/buyer/TradeInValuationWidget.tsx:109, 121`). The submission form says only "Dealers will see your trade-in details during the auction" (`app/buyer/trade-in/page.tsx:114, 146, 233`). `TradeInSubmission.valuationCents/valuedAt` + `TradeInValuation` model exist (schema.prisma:2050-2051, 3260+) — an AutoLenis-side valuation surface.
- required change: add the mandated sentence to the submission form and any deal-stage trade screen; ensure any displayed `valuationCents` is labelled "estimate, not an offer".
- legacy path: `TradeInValuation` model (admin valuation).

**R14** · spec_ref: Stage 4 Exit (L435) · requirement: Complete criteria, co-buyer election recorded, trade election recorded.
- status: MISSING
- current: No draft/complete state on VehicleRequest for Stage 4; no co-buyer election; `hasTradeIn` boolean only on BuyerOpportunity/financing.
- required change: add `cobuyer_election` and `trade_election` (or derive from linked rows) and a completeness check before payment.

**R15** · spec_ref: Stage 4 Fail (L437) · requirement: Request remains a draft; drafts do not enroll payment reminders, spend on enrichment, contact dealerships, or create auctions.
- status: BROKEN (as written today)
- current: `VehicleRequestStatus` has no DRAFT; `POST /api/buyer/requests` creates SUBMITTED and the intake pipeline ("Group 3 + 4A enrichment / dealer-discovery / scoring") runs from the persisted row (`requests/route.ts:165-206`, comment at 200-205). `createVehicleRequest` sets SUBMITTED (`vehicle-request.service.ts:28-38`).
- evidence: requests/route.ts:200-205 "Dealer outreach + the dealers-contacted buyer email run in the … intake pipeline … off the persisted row".
- required change: introduce DRAFT (or an `is_draft` flag) that the intake-reconcile cron, enrichment and outreach exclude; only Stage 5 payment promotes it. (Payment-reminder enrollment is owned by another area; noted as a consumer.)
- legacy path: intake-reconcile cron / `processBuyerOpportunityIntake`.

### §22a — Inventory, qualified results and the shortlist (spec lines 1048-1123)

**R16** · spec_ref: §22a intro + surface table (L1050-1057) · requirement: Two surfaces — Catalogue (small scheduled sweep, public) and Qualified results (live targeted query, prequalified buyers only).
- status: PARTIAL
- current: Catalogue = `(public)/inventory/page.tsx` over `inventory_items` filled by `inventory-sync-full` (vercel.json:96-97, `0 8 * * *`, ≤10 calls × 50 rows). Qualified results surface does not exist (R2).
- evidence: `app/api/cron/inventory-sync-full/route.ts:9-11`; `marketcheck.adapter.ts:196-263` pagination loop.
- required change: R33-R36.

**R17** · spec_ref: §22a "Why a live query…" (L1059-1061) · requirement: Live query is allowed pre-payment; results cached against a criteria hash so repeats cost nothing.
- status: MISSING
- current: rg `criteriaHash|criteria_hash|qualified` negative across app/lib/prisma. No cache table.
- required change: `qualified_result_queries` (criteria_hash, buyer_id, zip, approved_cents, fetched_at, provider_calls, results JSON/refs) with TTL; draw from the same call budget (R28).

**R18** · spec_ref: Rule "100-mile ceiling is AutoLenis policy" (L1067) · requirement: 100-mile max for qualified results and shortlist; policy is code, not provider.
- status: ALREADY CORRECT (shortlist) / N/A (qualified results not built)
- current: `SHORTLIST_RADIUS_MILES = 100` (`shortlist-radius.ts:87`) is deliberately decoupled from the provider constant (`shortlist-radius.ts:74-77` imports nothing from lib/services/inventory); provider clamp `MAX_RADIUS_MILES = 100` in `inventory-source-config.service.ts:30`, applied twice (`resolveMarketConfig` clampRadius :78-86 and `buildApiUrl` :354).
- stronger safeguard: two independent clamps; `clampRadius(null)` returns DEFAULT not 1 (:73-77).
- required change: none. Note the admin search tool passes the raw zip with NO radius parameter at all (`search-tool/run/route.ts:90-97`) — provider default radius applies; UNVERIFIED what that default is.

**R19** · spec_ref: Rule "Used and budget filtering are not optional" (L1068) · requirement: Qualified results filter to condition preference and around approved amount.
- status: PARTIAL (sweep) / MISSING (qualified results)
- current: Sweep hardcodes `car_type: "used"` (`marketcheck.adapter.ts:348`) and `price_min: "1"` (:375); optional `price_max` from `inventory_sources.filter_price_max_cents` (:381). Buyer search hard-caps at `maxOtdAmountCents` (R30). No condition preference from the buyer reaches any query.
- required change: qualified-results query must take `condition` from the request (New/Used/Either) and a generous budget band (R30).

**R20** · spec_ref: Rule "Distance on every listing" (L1069) · requirement: Each result and catalogue card states distance; buyer with no stored location is asked for a ZIP before distances/shortlist actions appear.
- status: PARTIAL
- current: Catalogue cards show `{distanceMiles} mi away` (`(public)/inventory/page.tsx:386-391`); detail page shows distance (`[vehicleId]/page.tsx:337-342`); buyer search shows `{v.distanceMiles} mi` (`BuyerSearchClient.tsx:594-597`). ZIP prompt `data-testid="zip-prompt"` when `!hasZip` (`page.tsx:262-275`). BUT: the public catalogue derives location from the URL `?zip=` via the STATIC table only (`page.tsx:129-130` `lookupZip`, 128 entries in `lib/utils/zip-coords.ts`), never from the signed-in buyer's stored ZIP, and never via `geocodeZip` (Google tier). A buyer whose ZIP is outside the static table sees the ZIP prompt even after entering one. Detail page and shortlist API use stored `buyer.zip` + `geocodeZip` (`[vehicleId]/page.tsx:59-75,108`; `shortlist/route.ts:56-60`). Shortlist page shows NO distance per candidate (`app/buyer/shortlist/page.tsx:48-88`).
- evidence: `lookupZip` `zip-coords.ts:310-313`; `geocodeZip` `lib/services/integrations/geocoding.service.ts:132-160`.
- stronger safeguard: shortlist API fails closed on an unplaceable buyer.
- required change: catalogue should prefer the signed-in buyer's stored ZIP and use `geocodeZip`; show distance on shortlist candidates; prompt only when no stored location.
- legacy path: `lookupZip` static table (173 ZIPs per BUYER-LOCATION-GAP.md, 128 counted by regex here — UNVERIFIED exact count).

**R21** · spec_ref: Rule "In radius, the action is Add to shortlist" (L1070) · requirement: within 100 miles → shortlist, up to five.
- status: ALREADY CORRECT (see R3, R5).

**R22** · spec_ref: Rule "Out of radius, the action is Find one like this" (L1071) · requirement: card states distance plainly; opens custom request pre-filled from year/make/model/trim/mileage band/price band/features; never labelled qualified/locally available/confirmed/held/auction-eligible.
- status: ALREADY CORRECT (public) / PARTIAL (buyer portal)
- current: `buildSimilarRequestHref` (`shortlist-availability.ts:401-419`) emits makePreference, modelPreference, trim, yearMin/Max (±1), maxMileage band, maxBudgetCents (+10% rounded up to $1k), features (≤6); keys pinned to `/buyer/requests/new` hydration (`REQUEST_PREFILL_KEYS` :387-390). Catalogue card label "Find one like this near me →" (`page.tsx:403-409`). Shortlist card shows "AUCTION READY" badge from `readinessState` default for any in-radius item (`ShortlistClient.tsx:181, 205-209`) — asserted at write, never revalidated.
- required change: buyer-portal search cards should render the gate action (currently always "Shortlist"); drop/derive the "AUCTION READY" badge from revalidation.

**R23** · spec_ref: Rule "Sourcing is limited by neither surface" (L1072) · requirement: auction searches the rooftop pool with no provider radius cap; full 100/150/250 ladder.
- status: ALREADY CORRECT (isolation) / out-of-scope finding (ladder)
- current: `shortlist-radius.ts:74-77` documents and enforces import isolation; `coverage.service.ts:38` `RADIUS_TIERS = [25, 50, 100, 150]` — ladder stops at 150, not 250 (sourcing area; recorded in Out-of-scope).
- evidence: rg `MAX_RADIUS_MILES` → only lib/services/inventory + admin search tool.

**R24** · spec_ref: Rule "Every listing carries its dealer" (L1073) · requirement: Provider returns holding rooftop (name, address, coordinates, type, phone, email); captured on ingest; listing resolves to a real rooftop; pool grows with every search.
- status: PARTIAL
- current: Adapter reads `listing.dealer.{id,name,phone,street,city,state,zip,latitude,longitude,seller_email,dealer_type,mc_rooftop_id,mc_dealer_id}` (`marketcheck.adapter.ts:74-88, 394-424`) and the orchestrator persists all of it on create AND update (`orchestrator.ts:353-369, 384-399, 423-438`). `resolveListingRooftops` MATCHES against `dealer_rooftops` on name/zip/city/state/phone via the shared `dealerIdentityKeys` and sets `inventory_items.rooftop_id`; it never creates a rooftop (`listing-rooftop-resolution.service.ts:9-15, 73-77, 125-158`; `created` always 0). Gaps: (a) `include_dealer_object` / `include_mc_dealership_object` are NOT sent (`buildApiUrl` :346-383) — whether the object arrives by default is UNVERIFIED; (b) `mc_rooftop_id`/`mc_dealer_id` are stored but NOT used as a dedupe/join key and `DealerRooftop` has no MC id column (schema.prisma:4007-4040); (c) `mc_category`/dealer-type filter to Dealer is not applied (only stored as `externalDealerType`); (d) "pool grows with every search" is false by design — MATCH never MINT, so an unmatched rooftop stays unlinked (`ambiguous`/`unmatched` counters). (e) `inventory_items.dealer_id` stays NULL for swept rows; the dealer reference is `rooftop_id` only; migration 20261105 is written but NOT applied (header "WRITTEN BUT NOT APPLIED").
- evidence: `orchestrator.ts:459 rooftopResolution = await resolveListingRooftops(ingested)`; test `lib/services/inventory/__tests__/listing-rooftop-resolution.test.ts`.
- stronger safeguard: MATCH-never-MINT and ambiguous-left-unlinked protect the prospecting entity graph (`autolenis-dealer-database-ingestion` is the only write path). Coordinates 0,0 / out-of-range rejected (`adapter:123-134`).
- required change: pass the include flags explicitly; add `mc_rooftop_id` to `dealer_rooftops` (through the ingestion layer) and dedupe on it; decide with the owner whether unmatched provider rooftops enter the prospect queue (review-queue path) so the pool actually grows; apply migrations 20261104/20261105 before deploy.
- legacy path: `externalDealerName/Phone/City/State` LANE_2 name-match (`orchestrator.ts:92-105`).

**R25** · spec_ref: Rule "A listing is a specification" (L1074) · requirement: no listing promises availability; price/availability confirmed only by dealer offer and at reaffirmation.
- status: ALREADY CORRECT (copy) / PARTIAL (data model)
- current: Detail page: "price and availability confirmed when a dealer bids" (`[vehicleId]/page.tsx:332`); buyer detail: `app/buyer/inventory/[vehicleId]/page.tsx:32-34, 252-253`. Reaffirmation is another area.
- required change: none here.

**R26** · spec_ref: Rule "The listed price is the benchmark" (L1075) · requirement: provider price is what cross-vehicle ranking measures OTD against.
- status: PARTIAL
- current: `priceCents` + append-only `priceHistory` persisted (`orchestrator.ts:332-334`); no cross-candidate ranking exists (R41). Detail page shows "% below/above market average" from the catalogue mean (`[vehicleId]/page.tsx:50-55, 149-152`) — a catalogue-sample statistic, not the provider benchmark.
- required change: snapshot `listed_price_cents` on the candidate row at shortlist time for ranking.

**R27** · spec_ref: Rule "Freshness gates the shortlist, not the display" (L1076) · requirement: not seen 7 days → freshness note; 30 days → viewable, not shortlistable.
- status: PARTIAL (conflict)
- current: `STALE_FLAG_WINDOW_MS = 7d`, `SHORTLIST_FRESHNESS_WINDOW_MS = 30d` (`shortlist-radius.ts:90-93, 150-156`); flag copy on cards/detail (`page.tsx:394-401`, `[vehicleId]/page.tsx:343-350`); server refuses `STALE_LISTING` (`shortlist/route.ts:22-23, 75-79`); tests `:134, :141`. CONFLICT: stale sweep deactivates any swept row unseen for 48h (`FRESHNESS_WINDOW_MS` `inventory-eligibility.ts:272`; `staleSweepWhere` `stale-sweep.service.ts:69-111`), and every catalogue/detail query filters `isActive: true` (`page.tsx:85`, `[vehicleId]/page.tsx:33`), so once `INVENTORY_STALE_SWEEP_MODE=enforce` (default `dry_run`, `.env.example:204`) a listing disappears at 48-72h — before the 7-day note can ever show and contrary to "30 days can still be viewed". Buyer-portal search cards show no freshness note (`BuyerSearchClient.tsx` rg stale|fresh negative).
- stronger safeguard: never-seen row is EXPIRED not FRESH (`freshnessOf` :151); dealer-managed/admin rows exempt from freshness but not radius (test :154).
- required change: owner decision — align `FRESHNESS_WINDOW_MS` (48h) with the 7/30-day policy (e.g. sweep deactivates at 30d, `executableSupplyWhere` uses 7d or 30d), or document that the 48h clock governs sourcing eligibility and the 7/30 clocks govern display. Add the freshness note to buyer-portal search cards.
- legacy path: 48h sweep cadence comment in `inventory-stale-sweep/route.ts:93-104`.

**R28** · spec_ref: Rule "No qualifying results is not a dead end" (L1077) · requirement: zero/thin results → offer custom request pre-filled from gathered criteria; sourcing independent.
- status: PARTIAL
- current: Catalogue `inRadiusCount === 0` panel → `/buyer/requests/new` (no pre-fill) (`page.tsx:276-297`); buyer search empty state → `/buyer/requests/new` (no pre-fill) (`BuyerSearchClient.tsx:855-936`); "thin" threshold not defined — request path offered only when count is zero, not alongside thin results (spec L1091 "Thin results offer the request alongside them").
- required change: define thin (e.g. `< N` in-radius), render the request CTA alongside results, and pre-fill from the buyer's current filters/criteria.

**R29** · spec_ref: Rule "Say what is actually verified" (L1078) · requirement: buyer-facing copy must not call a listing verified, confirmed, or held.
- status: PARTIAL
- current: Public catalogue/detail relabelled to "Dealer listed / Partner / Market listed" (`page.tsx:45-49`, `[vehicleId]/page.tsx:25-29`), buyer search (`BuyerSearchClient.tsx:47-51`). VIOLATIONS: `INVENTORY_LANES.LANE_1.label = "Verified"` (`lib/constants.ts:127`) rendered on shortlist cards (`ShortlistClient.tsx:179, 204`); public empty state "Browsing inventory from verified dealers." (`page.tsx:312`); "Contract Shield verifies all listed features are included in your deal." (`[vehicleId]/page.tsx:264`) implies feature verification of a listing.
- required change: change `INVENTORY_LANES.LANE_1.label`, fix the two copy strings; add a lint/test over buyer-facing inventory components for the prohibited words.
- legacy path: `INVENTORY_LANES` constant (also used by admin UI — check before renaming).

**R30** · spec_ref: Rule "Both paths run to one call budget" (L1079) + Appendix "second unmetered consumer" · requirement: sweep + query consumption recorded together against one monthly allowance; Operations alert before ceiling; provider failure never shown as an empty market.
- status: ALREADY CORRECT (sweep + admin tool) / MISSING (qualified query does not exist)
- current: Ledger on `inventory_sources` (`callsUsedThisCycle`, `budgetCycleKey`, `monthlyCallBudget`; schema.prisma:2435-2439); atomic draw `tryConsumeCall` (`inventory-call-budget.service.ts:275-304`), roll-forward-only cycle (:244-263), per-sweep grant `min(maxCallsPerRun, MAX_CALLS_PER_SWEEP=10)` (`orchestrator.ts:240`); admin search tool draws one call from the same ledger and labels fallback `db_budget_exhausted` / `db_provider_error` (`search-tool/run/route.ts:65-144`, `SearchToolClient.tsx:21-22`); bootstrap = one budgeted priority run (`orchestrator.ts:624-628`); 80% WARNING + EXHAUSTED alerts deduped per cycle (`inventory-budget-alert.service.ts:382, 407-414, 465-486`; raised `orchestrator.ts:549-583`); `api_calls_used` per run (schema.prisma:2461). Caveats: alert is raised only by the orchestrator after a sweep — admin-tool draws do not trigger it until the next sweep; when config is env-tier (migration unapplied) the admin tool is UNMETERED (`run/route.ts:80-85` `budgetAllowed = resolved.ok`) and the sweep uses a static in-process budget (`orchestrator.ts:247-251`).
- evidence: tests `inventory-call-budget.test.ts`, `inventory-budget-alert.test.ts`, `app/api/admin/__tests__/inventory-search-tool-budget.test.ts:83-115`.
- stronger safeguard: draw-before-dispatch, no refund surface; fail-closed on ledger error (:298-303); compiled ceilings min()-ed against DB row (`inventory-source-config.service.ts:224-231`).
- required change: qualified-results query must draw from this ledger; consider raising the alert from `tryConsumeCall` callers too.
- legacy path: env-tier fallback (`INVENTORY_SWEEP_ZIP`, `MARKETCHECK_MONTHLY_CALL_BUDGET`).

**R31** · spec_ref: L1079 "provider failure never shown to a buyer as an empty market" · requirement: buyer told search unavailable + offered request path.
- status: PARTIAL / N/A
- current: Buyer search is DB-only; a DB error shows `search-error` with retry (`BuyerSearchClient.tsx:546-556`) but no request CTA in that branch. Admin tool distinguishes provider error from empty (`run/route.ts:104-139`). Sweep outcomes DEFERRED/FAILED/PARTIAL/BUDGET_EXHAUSTED are distinct from ZERO_RESULTS (`IInventoryAdapter.ts:52-65`, `rollUpOutcome` `orchestrator.ts:190-213`).
- required change: when the live query is built, map provider failure to "search unavailable" + request CTA; add the request CTA to the existing `search-error` branch.

**R32** · spec_ref: "System finds — Qualified results" (L1085) · requirement: after approval, read verified ZIP, approved amount, criteria; query provider live from whole market; required criteria rank ahead of preferred; each result shows distance, freshness, vehicle detail, listing status.
- status: MISSING
- current: none (R2, R10, R17). Note the ZIP dependency: BUYER-LOCATION-GAP.md documents that prequal collects but does not persist `buyers.zip`; `shortlist/route.ts:56-60` and `[vehicleId]/page.tsx:59-75` read `buyer.zip`, which is NULL for the canonical journey unless intake/admin set it.
- required change: implement `lib/services/inventory/qualified-results.service.ts` reusing `MarketCheckAdapter.search` (pass zip/radius/priceMax/make/model/yearMin/yearMax; add `car_type`/condition; budget via `makeCallBudget`), cache on criteria hash, return gated rows via `gateCatalogue`; and persist buyer ZIP at prequal (Fix 1 in BUYER-LOCATION-GAP.md) — prerequisite.

**R33** · spec_ref: "Buyer chooses — Shortlist" (L1086) · requirement: system never auto-saves.
- status: ALREADY CORRECT (R3).

**R34** · spec_ref: "Buyer confirms — Vehicle Request" (L1087) · requirement: thin/absent → request pre-filled and confirmed; offered alongside thin results.
- status: PARTIAL (R28).

**R35** · spec_ref: "Buyer pays — Auction" (L1088) · requirement: sourcing only after $99 settles; ladder independent of catalogue.
- status: out of area (payments/sourcing). Recorded: no pre-payment sourcing is triggered by shortlist writes (rg negative); intake pipeline DOES run enrichment/outreach off a SUBMITTED VehicleRequest (R15) — flagged there.

**R36** · spec_ref: L1090 "Qualified results are a post-approval view; before prequal, general catalogue only; nothing presented as qualified."
- status: ALREADY CORRECT (by absence) / PARTIAL
- current: Nothing is labelled "qualified" anywhere (rg negative). Buyer search shows "pre-qualified budget" banners only for APPROVED (`app/buyer/search/page.tsx:142-159`; `BuyerSearchClient.tsx:320-400`).
- required change: keep when R32 lands.

**R37** · spec_ref: "How the approved amount is applied" (L1094-1098) · requirement: filter generously, never tightly; a listing near or a little over the ceiling is shown; enforce server-side at offer validation/selection/contract, not browsing.
- status: BROKEN (strict direction)
- current: `/api/buyer/search` hard-filters `priceCents <= maxOtdAmountCents` and caps user priceMax at the ceiling (`search/route.ts:64-82`, `budgetGuarded`); public detail page renders a disabled "Exceeds Your Pre-Qualified Budget" button instead of Add to Shortlist (`[vehicleId]/page.tsx:145, 379-386`); `findMatchedVehicles` uses `maxPriceCents` as hard exclude (`inventory-match-score.ts:277-278`); test `app/api/buyer/search/__tests__/budget-gating.test.ts` pins the strict behaviour.
- stronger safeguard: this IS the stricter safeguard — record for the owner; do not relax without a decision. Zero/undetermined ceiling is never treated as $0 (`search/route.ts:49-67`).
- required change (if spec wins): replace the hard cap with a headroom band (e.g. ≤ ceiling × 1.10) and an "over budget — OTD will be checked at offer" flag; keep the server-side checks at offer validation/selection/contract (other areas).
- legacy path: `budgetGuarded`/`maxBudgetCents` response fields; `budget-fit-indicator` on detail page.

**R38** · spec_ref: "Two radius ceilings" (L1102-1108) · requirement: shortlist/qualified = 100 (policy, provider must support); sourcing = 100→150→250 then buyer authorisation, own rooftop records.
- status: ALREADY CORRECT (shortlist) / out-of-scope finding (sourcing ladder ends at 150, `coverage.service.ts:38`).

**R39** · spec_ref: "The candidate model" intro (L1110-1112) · requirement: shortlisted vehicle = candidate; one request carries up to five; auction covers all; offers bind to candidate; selection collapses to one VIN; nothing after selection knows it was multi-vehicle.
- status: MISSING
- current: `AuctionVehicle` (schema.prisma:500-515) has no distance, no candidate ordinal, no link to ShortlistItem; `Offer` has no `auctionVehicleId` (rg `auctionVehicleId|auction_vehicle_id|candidateId` in schema negative). No code copies shortlist items into `auction_vehicles` (rg `shortlist` in lib/services/auction, app/api/webhooks/stripe negative); the automatic path creates ONE AuctionVehicle from the latest VehicleRequest make/model/yearMin (`dealer-invitation.service.ts:117-147`); admin routes attach vehicles manually (`launch-auction/route.ts:215-228`, `auction-vehicles/route.ts:100-111`).
- required change: at deposit settlement (payments area) copy up to five AVAILABLE shortlist items into `auction_vehicles` with `inventory_item_id`, `distance_miles`, `listed_price_cents`, VIN snapshot; add `offers.auction_vehicle_id` (offers area); selection collapse (auction area).
- legacy path: `ensureAuctionVehicleFromRequest` make-signal path must remain as fallback for custom requests.

**R40** · spec_ref: Candidate model — Sourcing row (L1116) · requirement: each candidate resolves to holding rooftop (in radius) + comparable-unit rooftops; union + dedupe by rooftop recording which candidates each rooftop can serve.
- status: MISSING (data available: `inventory_items.rooftop_id` after migration 20261105)
- current: nothing consumes `rooftop_id` for sourcing (rg `rooftopId` in lib/services/auction negative; consumers are dealer-recruitment only).
- required change: §33 step 29 (sourcing area) — consume `rooftop_id`.

**R41** · spec_ref: Candidate model — Invitations/Offers/Ranking/Zero-offer/Selection rows (L1117-1121)
- status: MISSING (other areas; recorded because they depend on R39's candidate binding). No per-candidate offer cap, no per-candidate ranking, no cross-candidate discount-to-listed-price ranking.

### §32 schema rows (spec lines 1517-1520)

**R42** · spec_ref: §32 `auction_vehicles` (L1517) · requirement: carry up to five candidates per request with distance; offers bind to a candidate. P0.
- status: MISSING — see R39. `AuctionVehicle` lacks `distance_miles`, `vehicle_request_id`, `listed_price_cents`, `vin` snapshot; `Offer` lacks `auction_vehicle_id`.

**R43** · spec_ref: §32 `shortlist_items` (L1518) · requirement: enforce five-candidate cap and in-radius rule AT WRITE TIME. P0.
- status: PARTIAL (application-level only) + DUPLICATED
- current: App-level: `shortlist/route.ts:62-79` (gate) and `:91-93` (cap by available count). DB: `shortlist_items` has PK, unique (shortlist_id, inventory_item_id), FK to shortlists only (init migration:174-182, 759, 867); no trigger/constraint; `inventory_item_id` has NO FK (schema comment `shortlist-availability.ts:302-303`). Second ungated writer `addToShortlist` (`shortlist.service.ts:34-42`) has no callers but exists.
- stronger safeguard: cap counts available candidates.
- required change: add FK `shortlist_items.inventory_item_id → inventory_items(id) ON DELETE SET NULL/RESTRICT` (decision), a `distance_miles` column stamped at write, and a trigger or `SELECT … FOR UPDATE` count check for the cap; delete or gate `addToShortlist`.

**R44** · spec_ref: §32 `inventory_items` (L1519) · requirement: use `last_seen_at` to gate shortlist eligibility at seven and thirty days. P1.
- status: PARTIAL — implemented in `shortlistGate` but undermined by the 48h stale sweep once enforced (R27).

**R45** · spec_ref: §32 `vehicle_offers` (L1520) · requirement: keep `VehicleRequestOffer` as staff intake; require it to write a canonical `offers` row. P1.
- status: PARTIAL
- current: `Offer.vehicleRequestOfferId String? @unique` exists (schema.prisma:578) so a link column is present; no `prisma.offer.create` inside `lib/services/vehicle-request/*` (rg negative) — the canonical row is not written by the staff-intake path.
- required change: offers area — `createAndSendOffer` must create the canonical `Offer` in the same transaction.

### §33 build order (spec lines 1556-1559)

**R46** · spec_ref: §33 step 28 (L1556) · requirement: radius-filter the shortlist ACTION, add the specification path, carry up to five candidates on the request.
- status: PARTIAL — first two landed (ecb1ada: R5, R22); "carry up to five candidates on the request" MISSING (R4, R39).

**R47** · spec_ref: §33 step 29 (L1557) · out of area; depends on R24/R40 (`rooftop_id`).

**R48** · spec_ref: §33 step 30 (L1558) · requirement: target the browsing sweep at served markets; size it as a shop window; run rate to match.
- status: ALREADY CORRECT (pending migration apply)
- current: market from `inventory_sources.center_zip/radius_miles/filter_*` → env → NOT_CONFIGURED, no default (`inventory-source-config.service.ts:148-238`, `marketcheck.adapter.ts:160-174`); one daily sweep ≤10 calls (vercel.json:96-97; `inventory-sync-priority` unscheduled, budget-gated to 1 call `orchestrator.ts:240`); DFW repoint `UPDATE … WHERE center_zip IS NULL` in migration 20261104 (NOT APPLIED); `maxDistMiles` recorded as radius proof (`adapter:246, 292`). Single-market only — one `inventory_sources` row per (type,name) (`@@unique([type, name])` schema.prisma:2447), so "served markets" plural needs a per-market row model.
- stronger safeguard: no silent default ZIP; `is_active` kill switch honoured in both schema states (:190-193).
- required change: apply migrations; if more than one market is served, extend to multiple MARKETCHECK source rows (name-distinct) or a markets table (`app/api/admin/inventory/markets` exists — UNVERIFIED whether it feeds the sweep; `resolveMarketConfig` reads only the single (MARKETCHECK,"MarketCheck") row).
- legacy path: `INVENTORY_SWEEP_ZIP` env tier.

**R49** · spec_ref: §33 step 31 (L1559) · requirement: live qualified-results query on ZIP + approved amount + criteria, cached on a criteria hash; capture holding rooftop from every listing.
- status: MISSING (query/cache, R17/R32) / PARTIAL (rooftop capture on sweep only, R24).

### Appendix — Verified implementation findings (spec lines 1590-1607; dated evidence, not rules) — remediation status in code

**R50** · Appendix "Market size" → informs sweep sizing: sweep capped at 500 rows/10 calls (`inventory-source-config.service.ts:32-36`). ALREADY CORRECT (design honoured).
**R51** · Appendix "Dealer data arrives free / null dealer reference": dealer object now persisted + `rooftop_id` (R24). PARTIAL until migration applied and include flags verified.
**R52** · Appendix "Catalogue geography NY literal": removed (`adapter:24-27, 350`; test `marketcheck-market-config.test.ts`). ALREADY CORRECT.
**R53** · Appendix "Provider quota exceeded 28/day": one daily sweep + ledger (R30, R48). ALREADY CORRECT.
**R54** · Appendix "Week of silent 429s recorded as DEFERRED": DEFERRED still non-alerting per run, BUT `healthScore < 70` alert fires on DEFERRED (`orchestrator.ts:487, 587-595`: DEFERRED → healthScore 0 → alert) and budget alerts fire before the cap. ALREADY CORRECT (verify `withCronRun` alerting is a separate area).
**R55** · Appendix "Stale rows structurally protected": predicate rewritten with NULL branches, LANE_1-without-dealer sweepable, dry_run default + 150-row breaker (`stale-sweep.service.ts:43, 52-55, 69-111, 206-220`). ALREADY CORRECT. Stronger safeguard: dry_run default and blast-radius breaker — preserve.
**R56** · Appendix "Run size is a range": no fixed count; `classifyYield` uses provider `num_found` with 80% ratio + 25-row absolute floor and a 0.25 normalize floor (`sync-yield.ts:263-282, 317-360`). ALREADY CORRECT.
**R57** · Appendix "Second unmetered consumer": admin search tool now draws from the ledger (`search-tool/run/route.ts:65-86`). ALREADY CORRECT with the env-tier caveat (R30). Note it still calls host `marketcheck-prod.apigee.net` (:99) vs adapter `api.marketcheck.com` (:383) — two provider hosts on one key; no radius clamp; no dealer-object capture; `add` writes LANE_3 with no dealer (`add/route.ts:252-278`).

### HTML S[3] system items not otherwise covered (AutoLenis-Transaction-Flow.html L525-535)

**R58** · "Filter on listing price with headroom … and flag any result whose realistic OTD would breach the ceiling" — MISSING flag; hard filter instead (R37).
**R59** · "Show every listing in the general catalogue, kept clearly separate from qualified results" — catalogue never filtered by ZIP (`gateCatalogue` no-filter, `shortlist-radius.ts:257-297`; test `catalogue-no-filter.test.ts`). ALREADY CORRECT for the catalogue half.
**R60** · "Attach each shortlisted vehicle to the one Vehicle Request as a candidate, capped at five, each with its distance" — MISSING (R4, R39, R43).
**R61** · tables list includes `co_buyers`, `shortlists`, `auction_vehicles` — `co_buyers` MISSING (R11).

---

## Duplicates

1. **Shortlist add path**: `POST /api/buyer/shortlist` (`app/api/buyer/shortlist/route.ts:30-104`, gated) vs `addToShortlist` (`lib/services/shortlist/shortlist.service.ts:34-42`, ungated, no callers). Also `removeFromShortlist`/`getShortlistReadiness` (:44-61) duplicate route logic and layout logic with no callers.
2. **Shortlist-count gate**: `deposit/create-intent/route.ts:76-84` counts rows; `app/buyer/layout.tsx:215` and `app/buyer/shortlist/page.tsx:92-93` count AVAILABLE items via `countAvailableItems`. Two definitions of "has a shortlist".
3. **Trade capture**: `TradeInSubmission` (buyer portal) vs `BuyerOpportunity.tradeInDetails` JSON (public form, `unified-buyer-intake.service.ts:234-235`) vs `VehicleRequestFinancing.tradeIn` boolean.
4. **Provider clients**: `MarketCheckAdapter` (`api.marketcheck.com`, paginated, clamped, dealer object) vs admin `search-tool/run` inline fetch (`marketcheck-prod.apigee.net`, one page, unclamped, no dealer object). Two MarketCheck call sites; only the adapter should remain (§22a "one call budget" is satisfied, but the second client should be routed through the adapter).
5. **ZIP → coordinates**: `lookupZip` static (public catalogue, buyer search) vs `geocodeZip` static+cache+Google (shortlist API, detail page, invitations).
6. **Lane labels**: `INVENTORY_LANES` (`lib/constants.ts:126-130`, "Verified") vs per-page `LANE_CONFIG`/`LANE_INFO` copies in three components.
7. **Freshness windows**: `FRESHNESS_WINDOW_MS` 48h (`inventory-eligibility.ts:272`) vs `STALE_FLAG_WINDOW_MS` 7d / `SHORTLIST_FRESHNESS_WINDOW_MS` 30d (`shortlist-radius.ts:90-93`).
8. **Match scoring criteria**: `criteriaWhere` exists in both `request-inventory-match.service.ts:64-73` and `inventory-match.service.ts` (imported from score module per header) — same function twice.

## Stronger safeguards to preserve

- Server-side radius + freshness + availability gate in `POST /api/buyer/shortlist` with fail-CLOSED on unplaceable buyer/listing (`route.ts:48-79`; `shortlist-radius.ts:181-188`).
- `GateResult.visible: true` asserted by test so the catalogue can never be emptied by a filter (`shortlist-radius.ts:124-134`, `catalogue-no-filter.test.ts`).
- Shortlist cap counts AVAILABLE candidates (`shortlist.service.ts:14-28`).
- MATCH-never-MINT rooftop resolution; ambiguous matches left unlinked (`listing-rooftop-resolution.service.ts:9-15, 145-158`).
- Draw-before-dispatch call budget, no refund surface, fail-closed ledger, roll-forward-only cycle key, compiled ceilings min()-ed against DB values (`inventory-call-budget.service.ts`, `inventory-source-config.service.ts:25-41, 224-231`).
- No default sweep geography — NOT_CONFIGURED makes zero calls (`adapter:160-174`).
- Stale sweep `dry_run` default, 150-row blast-radius breaker, deactivated ids recorded for undo (`stale-sweep.service.ts:43-60, 206-230`).
- `classifyYield` only downgrades, never upgrades; provider `num_found` is the only denominator (`sync-yield.ts:317-323`).
- Null-Island / out-of-range coordinates rejected as a pair (`adapter:114-134`).
- Approved-amount hard cap at browse time (`search/route.ts:64-82`) — STRICTER than spec; owner decision required before relaxing (R37).
- Zero/undetermined prequal ceiling never treated as $0 (`search/route.ts:49-67`; `app/buyer/search/page.tsx:142-159`).
- Admin attach refuses unavailable linked vehicles (`auction-vehicles/route.ts:76-97`).
- Buyer identity from JWT on every buyer route (`getRequestBuyer`).

## Legacy paths affected

- `/buyer/search` + `/api/buyer/search` (catalogue search with 50-mile default filter and budget cap) — becomes the "general catalogue" or is replaced by qualified results.
- `findMatchedVehicles` / `VehicleMatchScore` dashboard widget (`inventory-match.service.ts`).
- `inventory-match-refresh` cron → `VehicleRequestMatchResult` (no consumer beyond its own service; rg negative).
- `saved-search-match` cron (`lib/services/crm/saved-search-matcher.service.ts`) reads `inventory_items` only.
- `ensureAuctionVehicleFromRequest` (make-signal AuctionVehicle) — keep as fallback for custom requests.
- `deposit/create-intent` shortlist row-count gate.
- `INVENTORY_LANES` constant and admin lane UI.
- `BuyerOpportunity.tradeInDetails` and public `coBuyer` boolean.
- `inventory-sync-priority` route (manual re-run lever, unscheduled).
- Env-tier config (`INVENTORY_SWEEP_ZIP`, `INVENTORY_SWEEP_RADIUS_MILES`, `MARKETCHECK_MONTHLY_CALL_BUDGET`) until migrations 20261104/20261105 are applied.
- `scripts/fix-inventory-images-and-coords.ts`, `scripts/backfill-missing-coords-and-features.ts` (coordinate backfills predating adapter coordinates — UNVERIFIED whether still used).

## Out-of-scope findings (for other areas)

- Sourcing ladder `RADIUS_TIERS = [25, 50, 100, 150]` (`lib/services/auction/coverage.service.ts:38`) — spec says 100→150→250 then buyer authorisation.
- `Offer` has no candidate binding; `VehicleRequestOffer` does not write a canonical `Offer` (R45) — offers area.
- Intake pipeline runs enrichment/outreach from a SUBMITTED VehicleRequest before payment (`requests/route.ts:200-205`) — Stage 5 / payments no-spend rule.
- `buyers.zip` not persisted at prequal (BUYER-LOCATION-GAP.md) — blocks distance/shortlist for canonical-journey buyers; identity/intake area.
- `GOOGLE_GEOCODING_API_KEY` undeclared in env.d.ts/.env.example (per BUYER-LOCATION-GAP.md) — observability/config.
- RLS: inventory tables have RLS enabled with zero policies in production per migration header; no migration enables RLS on chain-built DBs (`20261104` header) — supabase area.
- `app/api/admin/inventory/markets/**` exists; relationship to `resolveMarketConfig` (single row) UNVERIFIED — admin/inventory ops.

## UNVERIFIED items

- Whether MarketCheck returns the `dealer` object on `/v2/search/car/active` WITHOUT `include_dealer_object`/`include_mc_dealership_object` (the adapter relies on it; test `marketcheck-dealer-provenance.test.ts` uses fixtures, not the live API). Needs a live call outside this session.
- Whether `price_min=1` is honoured by the provider (adapter comment :370-374 says it could not be re-verified through the sandbox proxy).
- The provider's default radius when the admin search tool omits `radius`.
- Whether migrations 20261104/20261105 have been applied to production (headers say NOT APPLIED; DB not queried).
- Production value of `INVENTORY_STALE_SWEEP_MODE` (default dry_run) and `GOOGLE_GEOCODING_API_KEY`.
- Exact static ZIP table size (regex count 128 vs doc claim 173).
- Whether `admin/inventory/markets` feeds any sweep.
- Whether `scripts/fix-inventory-images-and-coords.ts` / `backfill-missing-coords-and-features.ts` are still invoked anywhere.

## Open questions for the owner

1. Approved amount at browse time: keep the current hard cap (stricter) or adopt the spec's generous band? (R37)
2. Freshness clocks: reconcile the 48h sweep/eligibility window with the 7/30-day shortlist windows — which governs display, which governs sourcing eligibility? (R27)
3. Should unmatched provider rooftops be pushed into the dealer-prospect review queue so "the pool grows with every search", given MATCH-never-MINT? (R24)
4. Should the shortlist create/attach a VehicleRequest at first candidate or at deposit (to satisfy "both write the same Vehicle Request")? (R4)
5. Is the admin search tool to be retired or routed through `MarketCheckAdapter` (single host, clamped radius, dealer capture)? (R57)
6. Multi-market sweeps: one `inventory_sources` row per market, or a markets table? (R48)
7. Candidate revalidation timing: at deposit create-intent, at webhook settlement, or both? (R6)

---

## Verification corrections (adversarial pass)

Re-checked at HEAD 0cd399f by opening every cited file. Paths relative to `frontend/`. Format: spec_ref | original status → corrected status | reason | evidence.

**Method note.** Several rows cite line numbers that cannot exist (files are shorter than the cited line): `inventory-call-budget.service.ts` is 184 lines (cited :244-304), `inventory-budget-alert.service.ts` 121 (cited :382-486), `sync-yield.ts` 122 (cited :263-360), `shortlist-availability.ts` 122 (cited :302-419), `inventory-match-score.ts` 97 (cited :240-302), `inventory-eligibility.ts` 90 (cited :272), `inventory-source-config.service.ts` 238 (cited :354). Two component paths were wrong (`app/buyer/shortlist/ShortlistClient.tsx` → `components/buyer/ShortlistClient.tsx`; `app/buyer/search/BuyerSearchClient.tsx` → `components/buyer/BuyerSearchClient.tsx`). The *conclusions* of those rows mostly survive; the evidence is corrected below.

### Status corrections

1. **§4a L410 (R3) "system never saves a vehicle into the shortlist on the buyer's behalf"** | ALREADY CORRECT → PARTIAL | A second, non-buyer writer exists: the admin route upserts a `shortlist_items` row onto a buyer's shortlist on the buyer's behalf. It is audited and human-initiated, but it is not the buyer choosing, and the prior row's "rg `shortlistItem.create` → only route.ts:99 and shortlist.service.ts:41" missed it because it uses `upsert`. | `app/api/admin/buyers/[buyerId]/shortlist/route.ts:89-93` `prisma.shortlistItem.upsert({ … create: { shortlistId, inventoryItemId, readinessState: "AUCTION_READY" }, update: { readinessState: "AUCTION_READY" } })`; audit `:96-106` `action: "SHORTLIST_ITEM_ADDED"`.

2. **§4a L410 + §22a L1070-1071 (R5, R21) "out-of-radius listing cannot be shortlisted; server refuses"** | ALREADY CORRECT → PARTIAL | The admin shortlist writer bypasses `shortlistGate` entirely — no radius, no freshness, no availability, no distance; it enforces only the five-cap. An out-of-radius, 30-day-stale, or `isActive=false` listing can therefore enter a buyer's shortlist and satisfy the deposit gate. No test covers this route (`app/api/admin/__tests__` has only `auction-vehicle-availability.test.ts`; `shortlist-radius-gate.test.ts` exercises the buyer route only). | admin route `:1-11` imports only `MAX_SHORTLIST_ITEMS` + `countAvailableItems` (no `shortlist-radius`, no `geocodeZip`); `:80-86` cap check; `:89` upsert with no gate. Buyer route gate for contrast: `app/api/buyer/shortlist/route.ts:62-79`.

3. **§32 `shortlist_items` (R43)** | PARTIAL + DUPLICATED (2 writers listed) → PARTIAL + DUPLICATED (3 writers + 2 deleters) | Writers: (a) `app/api/buyer/shortlist/route.ts:99` (gated), (b) `app/api/admin/buyers/[buyerId]/shortlist/route.ts:89` (cap only), (c) `lib/services/shortlist/shortlist.service.ts:41` `addToShortlist` (cap only; rg for `addToShortlist|removeFromShortlist|getShortlistReadiness|getOrCreateShortlist` outside the service → zero callers). Deleters duplicated: `app/api/buyer/shortlist/[itemId]/route.ts:13` and `app/api/buyer/shortlist/route.ts:131` and `shortlist.service.ts:47`. Required change unchanged plus: route the admin writer through the same gate (or record an explicit admin-override reason) before any DB-level constraint is designed. | as cited.

4. **§4a L412 (R6) "revalidated for price, availability, VIN, location, freshness"** | MISSING / PARTIAL ("only the admin attach route checks availability") → MISSING / PARTIAL with corrected current | There are TWO admin attach paths and only one checks availability. The launch-time path — the one the admin Launch panel's "shortlist" mode uses — attaches shortlist items to `auction_vehicles` with no availability/price/VIN/location/freshness check at all. | `components/admin/LaunchAuctionPanel.tsx:44` `type VehicleMode = "shortlist" | "manual" | "skip"`, `:249` `vehiclesPayload = Array.from(selectedShortlistIds).map(id => ({ inventoryItemId: id }))`, `:276` sent as `vehicles`; `app/api/admin/buyers/[buyerId]/launch-auction/route.ts:216-228` `prisma.auctionVehicle.createMany({ data: vehicles.map(v => ({ auctionId, inventoryItemId: v.inventoryItemId ?? null, … })) })` — rg `isShortlistItemAvailable` in that file → none. The guarded path is only `app/api/admin/buyers/[buyerId]/auction-vehicles/route.ts:76-97`.

5. **§22a "The candidate model" (R39) / §32 `auction_vehicles` (R42) / §33 step 28 (R46)** | MISSING ("no code path turns shortlist items into AuctionVehicle rows") → PARTIAL (manual admin copy exists; automatic candidate binding, distance, price/VIN snapshot, and offer→candidate link MISSING) | The admin Launch panel does copy selected shortlist items into `auction_vehicles` (see 4). It is manual, admin-only, unrevalidated, carries no distance, and is not triggered by deposit settlement — the Stripe webhook creates the auction with no vehicles and `inviteDealersToAuction` synthesises ONE make-signal row from the latest VehicleRequest. Schema gaps confirmed: `AuctionVehicle` has no distance/listed-price/VIN/request link; `Offer` has no `auctionVehicleId`. | `LaunchAuctionPanel.tsx:249`; `launch-auction/route.ts:216-228`; `app/api/webhooks/stripe/route.ts:206-214` `tx.auction.create({ data: { buyerId, depositId, status: "PENDING" } })` (no vehicles), `:262` `inviteDealersToAuction`; `lib/services/auction/dealer-invitation.service.ts:117-147`; `prisma/schema.prisma:500-515` (AuctionVehicle columns: auctionId, inventoryItemId, year, make, model, trim, mileage, notes); `:533-565` Offer (no candidate column; rg `auctionVehicleId|auction_vehicle_id|candidateId` in schema → none).

6. **§32 `vehicle_offers` (R45)** | PARTIAL → MISSING (evidence was wrong) | The row claimed "`Offer.vehicleRequestOfferId String? @unique` exists (schema.prisma:578) so a link column is present". Line 578 is inside `model Deal` (starts at :574), not `Offer`: it is `Deal.vehicleRequestOfferId`. `Offer` (`:533-565`) has no link to `VehicleRequestOffer`, `VehicleRequestOffer` relates only to `Deal`, and nothing under `lib/services/vehicle-request` writes `prisma.offer` (rg → none). The staff-intake path bypasses `offers` and lands directly on `Deal`. The "keep as staff intake" half is the legacy, not the requirement. | `schema.prisma:574` `model Deal {`, `:577` `offerId String? @unique`, `:578` `vehicleRequestOfferId String? @unique @map("vehicle_request_offer_id")`; VehicleRequestOffer model relation `deal Deal?` only.

7. **§22a L1085 (R32) prerequisite note + "Out-of-scope: `buyers.zip` not persisted at prequal (BUYER-LOCATION-GAP.md)"** | UNVERIFIED/stated as open defect → ALREADY CORRECT (fixed since the doc) | Prequal now backfills `buyers.city/state/zip` fill-if-null on every submission, before the valid-prequal early return. BUYER-LOCATION-GAP.md ("Nothing implemented", baseline 8a56167) is superseded on this point. R32 stays MISSING for the query itself; the ZIP prerequisite is no longer a blocker. | `lib/services/prequal/prequal.service.ts:300-309` `backfillBuyerLocation` — `zip ? prisma.buyer.updateMany({ where: { id: buyerId, zip: null }, data: { zip } }) : null`; `:312-315` "Location backfill runs BEFORE the valid-prequal early return".

8. **§22a L1071 (R22, buyer portal) "never labelled … auction-eligible"** | PARTIAL → BROKEN (buyer-portal detail) | The buyer-portal detail panel renders "Eligible for private 48-hour auction" for every LANE_1 listing regardless of distance or freshness, and the buyer detail page never runs `shortlistGate` (rg `shortlistGate|geocode|distance` in `app/buyer/inventory/[vehicleId]/page.tsx` → none), so an out-of-radius or 30-day-stale LANE_1 car is labelled auction-eligible with a live "Add to Shortlist" button (server refuses afterwards). | `components/buyer/VehicleDetailPanel.tsx:82-86` `data-testid="auction-eligible-chip"` … "Eligible for private 48-hour auction"; `:100-108` `Add to Shortlist` CTA; used from `app/buyer/inventory/[vehicleId]/page.tsx:262`.

9. **§4c L432 (R13) "every buyer-facing trade screen states the dealership performs the appraisal"** | PARTIAL → BROKEN | The form not only omits the mandated sentence, it promises something the code does not do: "Dealers will see your trade-in details during the auction" — but no dealer, auction, deal, or e-sign path reads `TradeInSubmission` anywhere. The only reads are the buyer's own GET and account-deletion purge. | `app/buyer/trade-in/page.tsx:114` "Dealers will see this when reviewing your auction…", `:146` "Dealers will see your trade-in details during the auction."; rg `tradeInSubmission\.|getBuyerTradeIns|trade_in_submissions` across app/lib excluding the trade-in service/route → only `app/api/buyer/account/route.ts:66` `deleteMany`; rg `tradeIn` in `app/api/dealer`, `lib/services/auction`, `lib/services/deal`, `lib/services/esign`, `app/buyer/deals` → none. Only the calculator widget carries the disclaimer (`components/buyer/TradeInValuationWidget.tsx:121`).

10. **§4c L430 (R12) "carried onto the Deal"** | PARTIAL → PARTIAL (capture) / MISSING (carry-on) | `Deal` has no trade columns and no deal-stage trade screen exists; `TradeInSubmission` is buyer-scoped only (`buyerId`), never linked to a VehicleRequest or Deal. | `schema.prisma:574-654` Deal model: rg `trade|cobuyer|signer` inside → none; `TradeInSubmission` `:2036-2056` has `buyerId` only.

11. **§22a L1094-1098 (R37) approved-amount hard cap** | BROKEN (stands) — evidence extended | A third enforcement point exists in the buyer portal: the detail panel disables the shortlist button when `budgetFit === "over"`. Preserve as the stricter safeguard pending owner decision. | `components/buyer/VehicleDetailPanel.tsx:106` `disabled={adding || budgetFit === "over"}`, `:112-114` "This vehicle exceeds your approved budget"; `app/buyer/inventory/[vehicleId]/page.tsx:45-50` budgetFit from prequal.

12. **§22a L1069 (R20) "buyer with no stored location is asked for a ZIP before … shortlist actions appear"** | PARTIAL (stands) — gap widened | (a) `/api/buyer/search` resolves the stored ZIP through the 128-entry static table only, so a stored ZIP outside the table yields `center = null`: no distance, no radius, no prompt — silently. (b) Buyer-portal search cards render "Shortlist" for every row with no ZIP prompt and no gate action (server refuses). (c) `radiusMiles` and `zip` are client-controlled and unclamped on that route (harmless for browsing; note only). | `app/api/buyer/search/route.ts:43-46` `zip = paramZip || (buyer.zip ?? "")`, `radiusMiles = paramRadius ?? (zip ? 50 : null)`; `:114` `center = lookupZip(zip)`; `lib/utils/zip-coords.ts:310-313` static table (128 entries by `^\s*"?\d{5}"?\s*:` count; doc claim of 173 remains UNVERIFIED); `components/buyer/BuyerSearchClient.tsx:603-618` shortlist button, no gate.

13. **§22a L1070-1072 "distance is a label, never a filter" — uncovered legacy endpoint** | (not in file) → BROKEN + DUPLICATED (dead) | A second public inventory API filters by ZIP radius and DROPS rows with null coordinates — the exact defect the catalogue page was rewritten to remove. No consumer found (rg `/api/public/inventory` in app/components/lib → none), so it is dead-but-live surface. | `app/api/public/inventory/route.ts:75-78` `center = lookupZip(zip)` + bounding box WHERE; `:135-136` `computed = computed.filter(it => it.distanceMiles !== null && it.distanceMiles <= radiusMiles)`. Required change: delete or route through `gateCatalogue`.

14. **§4a L416 (R10) mismatch flag** | MISSING (stands) — evidence corrected | Cited `inventory-match-score.ts:240-302, 277-278` do not exist (97-line file). Actual: weights `:35` `W = { make: 0.35, model: 0.25, year: 0.15, price: 0.15, lane: 0.1 }`; `priceScore` `:70-77` returns 0 above budget but the item is still ranked; `computeMatchScore` `:87-96`. The hard price EXCLUDE lives in the WHERE, not the score: `lib/services/inventory/inventory-match.service.ts:19` and `request-inventory-match.service.ts:71` `priceCents: { lte: c.maxPriceCents }`. | as cited.

15. **Duplicates #8 `criteriaWhere`** | DUPLICATED (stands) — description corrected | Not "the same function twice": two local definitions with DIFFERENT semantics — the dashboard matcher ignores model and year. | `inventory-match.service.ts:16-21` (make + price only) vs `request-inventory-match.service.ts:64-73` (make + model + year + price).

16. **§22a L1079 (R30) / Appendix (R57) call budget** | ALREADY CORRECT (stands) — evidence corrected | `tryConsumeCall` `inventory-call-budget.service.ts:94-124`: atomic conditional `updateMany` `:108-116` (`callsUsedThisCycle: { lte: budget - 1 }`, `increment: 1`, `res.count === 1`), fail-closed `:117-122`; `rollCycleForward` `:63`; `makeCallBudget` `:151-161`; `makeStaticBudget` `:174-180`. Alerts: `inventory-budget-alert.service.ts:17` `BUDGET_WARNING_RATIO = 0.8`, `:42-47` level, `:100-121` `raiseBudgetAlert` deduped on title `:113-114`. Orchestrator raises `:549-583`; per-adapter DEFERRED → healthScore 0 `:487`; run-level `computeHealthScore` `:128-138` counts DEFERRED unhealthy and excludes BUDGET_EXHAUSTED from the denominator; `<70` alert `:587-595`. Admin tool unmetered on env-tier: `search-tool/run/route.ts:80-85` `budgetAllowed = resolved.ok`. | as cited.

17. **Appendix "Run size is a range" (R56)** | ALREADY CORRECT (stands) — evidence corrected | `sync-yield.ts:25` `COVERAGE_MIN_RATIO = 0.8`, `:33` `MIN_ABSOLUTE_SHORTFALL = 25`, `:41` `NORMALIZE_MIN_RATIO = 0.25`, `:44` `NORMALIZE_MIN_RAW = 25`, `:68-69` expected = `min(numFound, pages×rows, 500)`, `:79` `classifyYield`. | as cited.

18. **§22a L1076 / §32 `inventory_items` (R27, R44) freshness clocks** | PARTIAL (stands) — evidence corrected | `FRESHNESS_WINDOW_MS = 48h` is at `lib/services/inventory/inventory-eligibility.ts:23` (not :272); `staleSweepWhere` reuses it `stale-sweep.service.ts:70`; `sweepMode()` default `dry_run` `:52-55`; `.env.example:204` `INVENTORY_STALE_SWEEP_MODE=dry_run`. | as cited.

19. **§22a L1067 (R18) two radius clamps** | ALREADY CORRECT (stands) — evidence corrected | Second clamp is in the adapter, not the config service: `marketcheck.adapter.ts:353` `radius: String(Math.min(radiusMiles, MAX_RADIUS_MILES))`; first clamp `inventory-source-config.service.ts:78-86` `clampRadius` (null → DEFAULT `:79-81`), applied `:206`. Admin tool sends no radius `search-tool/run/route.ts:90-97`. | as cited.

20. **§33 step 30 (R48) — UNVERIFIED "whether `admin/inventory/markets` feeds the sweep"** | UNVERIFIED → RESOLVED: it does not | The markets admin route manages the `MarketCoverage` table; `resolveMarketConfig` reads only the single `(MARKETCHECK, "MarketCheck")` `inventory_sources` row. Single-market limitation confirmed by `@@unique([type, name])`. | `app/api/admin/inventory/markets/route.ts:11` `prisma.marketCoverage.findMany`, `:21` `prisma.marketCoverage.upsert`; `inventory-source-config.service.ts:160-163` `db.inventorySource.findFirst({ where: { type, name } })`; `schema.prisma` InventorySource `@@unique([type, name])`.

21. **§22a L1061 / §33 step 31 (R17) criteria-hash cache** | MISSING (stands) — reuse note added | A generic keyed cache table already exists and is the reuse-before-create target: `SearchCache` (`cache_key` unique, `expires_at`), used by compound-search and geocoding. Do not add a parallel `qualified_result_queries` table without first evaluating `searchType = "qualified_results"` on `SearchCache`. | `schema.prisma:4447-4467` `model SearchCache … @@map("search_cache")`; `lib/services/acquisition/compound-search.service.ts:39,70`; `lib/services/integrations/geocoding.service.ts:58,76`.

22. **§4b L418-426 (R11) co-buyer** | MISSING (confirmed) | Re-searched under cobuyer / co_buyer / co-buyer / coapplicant / co_applicant / joint_applicant / secondary_buyer / additional_buyer / cosigner / co_signer / coborrower / guarantor across app, lib, components, prisma (schema + migrations + manual_supabase_sql), scripts: only the public-form boolean. | `components/public/RequestVehicleFormClient.tsx:309,465`; `app/api/public/request-vehicle/route.ts:106` `coBuyer: z.boolean().optional()`, stored via `metadata: { ...data, … }` `:603-609`; `app/admin/vehicle-requests/[id]/VehicleRequestDetailClient.tsx:270`; `app/(public)/refinance/page.tsx:184` copy only.

23. **Stage 4 Fail L437 (R15) / Exit L435 (R14)** | BROKEN / MISSING (confirmed) | `VehicleRequestStatus` has no DRAFT (`schema.prisma:1654-1666`: SUBMITTED, INTAKE, ACTIVE_SOURCING, OFFER_READY, OFFER_SENT, OFFER_ACCEPTED, OFFER_DECLINED, DEAL_CREATED, CLOSED_NO_MATCH, CANCELLED, EXPIRED); `createVehicleRequest` writes SUBMITTED (`vehicle-request.service.ts:35-37`); intake pipeline runs off the persisted row (`app/api/buyer/requests/route.ts:200-205`). rg `entryType|entry_type|isDraft|is_draft` in schema/vehicle-request/buyer routes → none. | as cited.

24. **§22a L1078 (R29) prohibited copy** | PARTIAL (stands) — one more violation | Add `components/buyer/VehicleDetailPanel.tsx:83-85` "Eligible for private 48-hour auction" (see 8). Confirmed the three originals: `lib/constants.ts:127` `LANE_1: { label: "Verified" … }` rendered at `components/buyer/ShortlistClient.tsx:179` (`INVENTORY_LANES[item.lane]`) and `:204` (`<Badge>{laneInfo.label}</Badge>`); `app/(public)/inventory/page.tsx:312` "Browsing inventory from verified dealers."; `app/(public)/inventory/[vehicleId]/page.tsx:264` "Contract Shield verifies all listed features are included in your deal.". | as cited.

25. **§22a L1071 (R22) pre-fill path** | ALREADY CORRECT (public) (stands) — evidence corrected | `lib/services/shortlist/shortlist-availability.ts:90-93` `REQUEST_PREFILL_KEYS`, `:104-121` `buildSimilarRequestHref` (year ±1 `:108-109`, mileage band `:110`, +10% price band rounded up to $1k `:66-71`, ≤6 features `:96`); hydrated by `app/buyer/requests/new/page.tsx:164-199` (`sp.get("makePreference")` `:189`, `maxBudgetCents` `:194-196`, `features` `:198-199`). `isShortlistItemAvailable` is `:23-28` (not :320-325); the "no FK" note is `:5`. | as cited.

### Requirements in the assigned sections the file did not cover

- **§22a L1070-1072 applied to `/api/public/inventory`** — see correction 13 (BROKEN, dead endpoint).
- **§4a L410 / §22a L1086 admin override of the buyer's choice** — the admin shortlist writer (corrections 1-3). No row existed for the admin path.
- **§22a L1071 buyer-portal "auction eligible" labelling** — correction 8.
- **§4c L432 the "dealers will see it" promise vs. no dealer read path** — correction 9.
- **§22a L1069 buyer-portal ZIP prompt before shortlist actions** — correction 12(b): `BuyerSearchClient.tsx` has no ZIP prompt gating the Shortlist button.
- **§22a L1061 "spent once, for a buyer who has already completed prequalification"** — the (unbuilt) live query must be gated on `isPrequalValid`; noted in R1 but no explicit row. Status MISSING (depends on R32).
- **Appendix "Dealer data arrives free … all 148 rows null dealer reference" — durability of the fix** — `inventory_items.dealer_id` remains NULL for swept rows by design; the dealer reference is `rooftop_id` only, and `dealer_rooftops` carries no MarketCheck identifier (`schema.prisma:4007-4040` — rg `mc_|marketcheck|placeId` inside → none), so `mcRooftopId/mcDealerId` (`:986-987`) are stored but unusable as a join key. R24(b) stands; recorded here because the Appendix row (R51) understated it.

### Rows re-checked and confirmed as written (no correction)

R2, R16, R32, R49 (no live query: rg `marketcheck` file list = adapter, config, budget, alert, orchestrator, sync-yield, two crons, admin search tool, and two comment-only mentions in `app/api/buyer/search/route.ts:16` and `app/api/public/inventory/route.ts:142`); R4 (no `entry_type`; `BuyerOpportunity.source` is a channel tag, not INVENTORY/CUSTOM); R8 (form state `app/buyer/requests/new/page.tsx:55-100`, META blob `:309-331`); R23 (`RADIUS_TIERS = [25, 50, 100, 150]` `coverage.service.ts:38`); R24 (include flags absent — rg `include_dealer|include_mc_dealership|mc_category` → none; `resolveListingRooftops` never creates — `listing-rooftop-resolution.service.ts:14, 59, 96`); R25; R28 (`inRadiusCount === 0` panel `(public)/inventory/page.tsx:276-297`, no pre-fill); R31; R33; R36 (rg `qualified` → only "qualified dealers" copy in `LiveAuctionView.tsx:144`); R38; R40; R41; R47; R50; R52; R53; R54; R55; R59 (`catalogue-no-filter.test.ts` present); R60; R61; Duplicates #2 (`create-intent/route.ts:76-78` row count vs `app/api/buyer/journey-status/route.ts:50` and `app/buyer/layout.tsx:215` `countAvailableItems`); Duplicates #4 (`marketcheck-prod.apigee.net` `run/route.ts:99` vs `api.marketcheck.com` `adapter:383`).
