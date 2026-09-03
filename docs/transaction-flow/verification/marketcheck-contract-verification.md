# MarketCheck inventory-provider contract verification (master prompt §9B)

Date: 2026-09-03 · Repository: /home/user/autolenisNewUpdatedfinal (app root `frontend/`) · Read-only.

## Method and evidence limits

- Code read in full: `frontend/lib/services/inventory/adapters/marketcheck.adapter.ts`, `adapters/IInventoryAdapter.ts`, `orchestrator.ts`, `inventory-source-config.service.ts`, `inventory-call-budget.service.ts`, `inventory-budget-alert.service.ts`, `sync-yield.ts`, `listing-rooftop-resolution.service.ts`, `frontend/app/api/admin/inventory/search-tool/run/route.ts`, `frontend/app/api/cron/inventory-sync-full/route.ts`, `frontend/app/api/cron/inventory-sync-priority/route.ts`, migrations `20261104000000_inventory_market_config_and_call_budget` and `20261105000000_inventory_dealer_provenance_and_call_accounting`, the `InventorySource` / `InventoryItem` / `InventorySyncRun` / `DealerRooftop` / `AdminInventorySearchRun` Prisma models, spec §22a (`docs/transaction-flow/AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md` lines 1048-1123) and the Appendix (lines 1590-1607).
- Provider probes: 8 MarketCheck MCP calls (`get_server_info` ×1, `search_active_cars` ×7), all `rows<=5`, all listing probes with `include_dealer_object=true` and `include_mc_dealership_object=true`. The MCP server reports `"authentication":"api_key (enforced by the gateway via ?api_key= query parameter)"` and version 1.9.3. **The MCP uses its own key/package; it is NOT proven to be the same package as the production `MARKETCHECK_API_KEY`.** Package-specific limits observed here are therefore evidence for "a MarketCheck package of this shape", not proof of the production key's plan.
- Official docs: `apidocs.marketcheck.com`, `docs.marketcheck.com`, `www.marketcheck.com` are all **blocked by the sandbox egress proxy** (EGRESS_BLOCKED on every WebFetch). Doc evidence below is limited to search-engine excerpts of those pages (URLs cited). Where a claim rests only on an excerpt it is marked *(excerpt, not fetched verbatim)*.
- Carfax-related fields were excluded from scope by instruction; nothing was requested, filtered, or inferred from them.

### Raw probe log

| # | Call | Result |
|---|---|---|
| 1 | `get_server_info` | endpoint `/v2/search/car/active`; recents service restriction list includes `"Radius cannot be greater than 100 for geo spatial queries"`; `"A single VIN can have multiple listings with unique listing IDs. Listing ID changes when price or miles change."` |
| 2 | `zip=75078 radius=100 car_type=used rows=5 +dealer +mc_dealership +build` | `num_found: 90179`, 5 listings, all `dist: 1.85` (Longo Toyota of Prosper) |
| 3 | same + `facets=mc_category\|0\|10 rows=1` | `facets.mc_category = Dealer 75393 · Retailer 14622 · Dealership Group 135 · Aggregator 29` (sums to 90,179 = num_found) |
| 4 | `zip=00000 radius=100 car_type=used rows=5` | `{"success":false,"status_code":422,"code":422,"message":"Zipcode 00000 not found"}` |
| 5 | `zip=75078 … make=Zzzznomake` | `{"success":true, "num_found":0, "listings":[]}` — HTTP 200, empty array |
| 6 | `zip=75078 … start=490 rows=5` | `num_found: 90179`, `start:"490"`, 5 listings (Auto Haven Frisco, `dist: 6.18`) — page 490-494 served |
| 7 | `zip=75078 … start=1000 rows=5` | `{"success":false,"status_code":422,"code":422,"message":"Subscribed package pagination limit of 500 rows exceeded"}` |
| 8 | `zip=75078 … rows=5 sort_by=dist sort_order=desc` | `num_found: 90179`, 5 listings (Pine Top Motors, Antlers OK), **`dist: 99.46`** on all five — the farthest listings inside the 100-mile query |

---

## Item-by-item findings

### 1. ZIP + configurable-radius search support — **VERIFIED**

**Finding.** The `/v2/search/car/active` endpoint accepts `zip` and `radius` (miles) and the adapter already sends both.

**Evidence.**
- MCP schema: `radius` = "Radius around the search location (Unit - Miles)"; `zip` = "Filter listing on ZIP around which they are listed"; also `latitude`/`longitude` as an alternative centre.
- Probe 2/6/8: `zip=75078 radius=100` returned `num_found 90179` with `dist` values 1.85, 6.18, 99.46.
- Code: `marketcheck.adapter.ts:346-356` builds `zip`, `radius`, `rows`, `start`, `car_type=used`; radius is resolved from config (`inventory-source-config.service.ts:201-204`, `clampRadius` at :78-86) with an env fallback (`INVENTORY_SWEEP_RADIUS_MILES`, :109-112).
- Docs *(excerpt, not fetched verbatim)*: free and basic plans carry a "100 mile radius restriction" — https://www.marketcheck.com/apis/pricing/ ; recents service says "Radius cannot be greater than 100 for geo spatial queries" (server_info, verbatim).

### 2. Reliable enforcement of the AutoLenis 100-mile ceiling — **VERIFIED (provider) / PARTIAL (adapter re-validation)**

**Finding.** The provider honours `radius=100` exactly: sorting by distance descending under `radius=100` returned a maximum `dist` of **99.46**, and every listing in all three listing probes carried a numeric `dist`. Server-side re-validation per listing is therefore possible. The adapter, however, only records the *maximum* `dist` seen (`maxDistMiles`) as evidence — it does not drop or flag an individual listing whose `dist` exceeds the configured radius, and it does not persist `dist` on the row.

**Evidence.**
- Probe 8: five listings at `dist: 99.46` (dealer zip 74523, Antlers OK — the radius crosses the state line, which is correct behaviour for a disc).
- `dist` present on 15/15 sampled listings (see population table).
- Code: `marketcheck.adapter.ts:246` `if (typeof l.dist === "number") maxDist = Math.max(maxDist ?? 0, l.dist);` — evidence only; `normalize()` at :386-435 never reads `dist`; `NormalizedVehicle` (`IInventoryAdapter.ts:5-45`) has no distance field. The ceiling is clamped twice (`inventory-source-config.service.ts:83` and `marketcheck.adapter.ts:354`), and pinned by tests (`__tests__/marketcheck-market-config.test.ts`).
- §22a "The 100-mile ceiling is AutoLenis policy … the provider must support that policy" — supported. §22a "Distance on every listing" — the provider supplies it; the code currently recomputes distance from stored lat/long (`app/api/public/inventory/route.ts:138`) rather than storing the provider's `dist`, which is only valid relative to the query centre anyway. That is acceptable for the catalogue; for a live qualified-results query the provider's `dist` is exactly the buyer-relative distance and should be passed through.

### 3. Pagination, result limits, subscription restrictions under the ACTUAL plan — **VERIFIED for the MCP package; UNVERIFIED for the production key**

**Finding.**
- Page cap: `start=490 rows=5` (rows 490-494) succeeded; `start=1000` returned HTTP 422 `"Subscribed package pagination limit of 500 rows exceeded"`. So on this package `start + rows <= 500` is the rule, exactly as the adapter assumes (`PROVIDER_PAGINATION_LIMIT = 500`, `inventory-source-config.service.ts:36`; guard at `marketcheck.adapter.ts:200,206`).
- Max rows per call: MCP schema says "default 5, max 50" for standard searches (1500 for dealer-scoped syndication searches). Docs excerpt: "defaults to 10 with a maximum of 50" and "If you specify rows greater than your plan's limit, the API will automatically cap it" — https://docs.marketcheck.com/docs/api/cars/inventory/inventory-search *(excerpt)*. Adapter uses `MAX_ROWS_PER_CALL = 50` (:32). **Not probed above rows=5 (instruction limit).**
- `num_found` semantics: `num_found` is the total matching count (90,179), stable across probes 2, 3, 6, 8 for the same filter; it is **not** the retrievable count — retrievable is `min(num_found, package pagination limit)` = 500 here. Docs excerpt: "if start is greater than the total number of available results (num_found), the API will respond with a HTTP 422" *(excerpt)*.
- Monthly/RPS quota: docs excerpt — "free plan with 500 calls per month, 5 calls per second, and a 100 mile radius restriction"; basic "5000 calls per month, 5 calls per second, 100 mile radius restriction, 1500 row pagination limit … $299/mo plus a data fee" — https://www.marketcheck.com/apis/pricing/ *(excerpt)*. The code's constants (500/month, 5 rps, rows 50, 500-row cap; `marketcheck.adapter.ts:7-10`) match the free-tier excerpt. **Which plan the production key is on was not verifiable from this sandbox** (no dashboard access, egress blocked). The 500-row cap proven here is for the MCP's package; a basic-plan key would have a 1500-row cap per the excerpt.

**Evidence.** Probes 6, 7; `sync-yield.ts:67-70` `expectedListings = min(num_found, pagesFetched*rows, 500)`.

### 4. Available listing / VIN / pricing / mileage / feature / freshness / dealer fields and population — **VERIFIED (sample N=15)**

See the population table below. Headline rates across the 15 distinct listings sampled (3 rooftops):
- `id`, `vin`, `miles`, `vdp_url`, `heading`, `source`, `stock_no`, `dist`, `last_seen_at`/`last_seen_at_date`, `first_seen_at(_date)`, `scraped_at`, `dom`, `dom_180`, `dom_active`, `dos_active`, `in_transit`, `media.photo_links`: **15/15**.
- `price`: **10/15** (all five Pine Top Motors listings had no `price` at all — matches the adapter comment that ~⅓ of DFW listings lack a price and its `price_min=1` filter at `marketcheck.adapter.ts:375`). `msrp` 10/15. `ref_price`/`price_change_percent` 11/15 and 10/15.
- `exterior_color` 12/15, `interior_color` 10/15, `is_certified` 3/15, `photo_links_cached` 12/15 (3 of the 15 `photo_links` were a placeholder `…/1920/1080/.jpg`).
- `build` object: returned 5/5 where `include_build_object=true` was requested (probe 2) with year/make/model/trim/body_type/transmission/drivetrain/fuel_type/engine/doors/cylinders/mpg/powertrain_type; not requested on the other probes.
- `dealer.*`: `id`, `website`, `name`, `dealer_type`, `street`, `city`, `state`, `zip`, `country`, `latitude`, `longitude` (strings), `phone`: **15/15**; `seller_email` **10/15** (0/5 for Pine Top Motors); `msa_code` 10/15; `dealership_group_name` 5/15.
- `mc_dealership.*`: `mc_website_id`, `mc_dealer_id`, `mc_location_id`, `mc_rooftop_id`, `mc_category`: **15/15**; `mc_dealership_group_id/name` 5/15.

Feature lists (`high_value_features`, `options_packages`) were not present in the sampled payloads; they exist as filter/facet parameters in the schema.

### 5. Dealer address, coordinates, phone, email — returned, and under which flags — **VERIFIED (MCP) / PARTIAL (raw REST default not verifiable)**

**Finding.** With `include_dealer_object=true` the `dealer` object carries name, street, city, state, zip, country, latitude, longitude, phone, seller_email, website, dealer_type, dealership_group_name, msa_code. With `include_mc_dealership_object=true` a second `mc_dealership` object repeats the address/phone/email and adds `mc_website_id`, `mc_dealer_id`, `mc_location_id`, `mc_rooftop_id`, `mc_dealership_group_id/name`, `mc_sub_dealership_group_*`, `mc_category`. The MCP schema documents the `dealer` object as **not** containing `mc_rooftop_id`/`mc_dealer_id` — those live only in `mc_dealership`.

**Consequence for the adapter (material).** `marketcheck.adapter.ts:74-88` types `dealer.mc_rooftop_id` / `dealer.mc_dealer_id`, and `normalize()` reads them from `listing.dealer` (:415-416). In every sampled payload those keys do **not** exist on `dealer`; they exist on `mc_dealership`, which the adapter neither types nor requests (`buildApiUrl` :346-382 sends no `include_*_object` flags). Under the observed shape, `mcRooftopId` is always `undefined` and `mcDealerId` falls back to `dealer.id`, which the sample shows equals **`mc_website_id`** (1094321 / 11009287 / 11044096), not `mc_dealer_id` (1160478 / 1204572 / 1209991). The unit fixture (`__tests__/marketcheck-dealer-provenance.test.ts:35-36`) places `mc_rooftop_id` on `dealer`, so the tests pass against a shape the provider does not send. Whether the raw REST endpoint returns `dealer` (and/or `mc_dealership`) by default without the include flags could not be verified (egress blocked); the Appendix's 2026-09-02 production observation ("Every listing returns its holding rooftop with name, address, coordinates, type, phone and email") is consistent with `dealer` being present by default but says nothing about `mc_dealership`.

Also: `dealer.website` is present 15/15 and is the rooftop graph's strongest identity key (`DealerRooftop.websiteHost @unique`; `dealer-identity.service.ts:13,101`), yet the adapter discards it and `listing-rooftop-resolution.service.ts:131` states "Listings carry no dealership website" — contradicted by the sample.

### 6. Stable identifiers for dedup — **VERIFIED**

**Listings.** `id` has the shape `<VIN>-<8hex>-<4hex>` (e.g. `5TDAAAB59SS083413-c4a9a7c7-604f`). Server info (verbatim): "A single VIN can have multiple listings with unique listing IDs. Listing ID changes when price or miles change." So `id` is a *listing-version* key, not a vehicle key. The adapter correctly keys on VIN (`buildSourceKey`, `IInventoryAdapter.ts:150-153`; `InventoryItem.vin @unique`). One caution: the same VIN can be listed by more than one seller (schema: `dedup`/`nodedup`/`is_searchable`); a VIN-unique `InventoryItem` collapses those to one row and the last-seen rooftop wins on update (`orchestrator.ts:372-399`).

**Rooftops.** Observed on the same listing: `dealer.id 1094321 == mc_dealership.mc_website_id 1094321`; `mc_dealer_id 1160478`; `mc_location_id 1399920`; `mc_rooftop_id 213596`; `mc_dealership_group_id 174`. Hierarchy per the schema: website → dealer → location → rooftop → (sub)group. **`mc_rooftop_id` is the physical-rooftop key the §22a "holding rooftop" concept needs**; `dealer.id` is the website id. `mc_category` values (facet, this market): `Dealer` 75,393 · `Retailer` 14,622 · `Dealership Group` 135 · `Aggregator` 29 — schema also lists `Marketing` and `Financing`. All 15 sampled listings were `mc_category: "Dealer"`. §22a sourcing should exclude `Aggregator`/`Marketing`/`Financing` rooftops from the rooftop pool.

### 7. Rate limits, quota accounting, caching permissions, data-retention — **PARTIAL (excerpts only); caching/retention is a contract question**

**Rate limit / quota** *(excerpts; pages egress-blocked)*: "Each subscription plan has a corresponding rate limit that controls how many requests can be made per second (RPS)"; free: 500 calls/month, 5 rps; basic: 5,000 calls/month, 5 rps — https://docs.marketcheck.com/docs/get-started/api/quota-and-rate-limits , https://www.marketcheck.com/apis/pricing/ . On 429 the API sends `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset-Time`, `Quota-Limit`, `Quota-Remaining`, `Quota-Reset-Time`, `Retry-After` headers and the docs recommend exponential backoff and threshold e-mail alerts ("API Monitoring").

**Caching / retention** *(excerpt of https://www.marketcheck.com/terms_of_service/ )*: the terms reportedly prohibit "caching, storing, indexing, or otherwise persisting substantial portions of data obtained through the Service outside of normal application use", "systematically extracting, harvesting, or downloading data to create a standalone database", and "reconstructing MarketCheck's inventory, dealer network, or datasets"; MarketCheck "may temporarily suspend or restrict access or request additional information regarding use case and data handling practices". The license is "solely for querying and using MarketCheck data within your applications or internal workflows". **The verbatim text and any negotiated exceptions on AutoLenis' agreement were not readable from this sandbox → UNVERIFIED.** This bears directly on §22a: the persisted catalogue (`InventoryItem` rows with 24-entry `priceHistory`), the proposed criteria-hash result cache, and especially "the sourcing pool grows with every search" (persisting rooftop name/address/phone/email from listings into a dealer graph) are each arguably "persisting … outside of normal application use" / "reconstructing … dealer network". Attribution: docs have an "Attribution (Searchable Listings)" guide describing `is_searchable`; no buyer-facing attribution requirement text was retrievable.

### 8. Provider behaviour: no results, invalid ZIP, throttling, timeout, outage — **VERIFIED (no-result, invalid ZIP, page-cap) / PARTIAL (429 shape from docs excerpt) / UNVERIFIED (timeout, outage)**

- No results: HTTP 200, `{"num_found":0,"listings":[]}` (probe 5). Adapter maps to `ZERO_RESULTS` (`marketcheck.adapter.ts:270`).
- Invalid ZIP: HTTP **422** `"Zipcode 00000 not found"` (probe 4). **Adapter gap:** the adapter treats *any* 422 as `NUM_FOUND_REACHED` (:226) — "start past the end of the result set". A 422 on page 0 caused by a bad ZIP (or by the package pagination limit) is therefore recorded as a clean end-of-results with zero vehicles → `ZERO_RESULTS`, i.e. a configuration error reads as an empty market, contrary to §22a "A provider failure is never shown to a buyer as an empty market". The 422 body carries a distinguishing `message`, which the adapter does not read (`fetchPage` :312-321 discards the body on non-OK).
- Pagination overrun: HTTP 422 `"Subscribed package pagination limit of 500 rows exceeded"` (probe 7); the adapter's pre-guard (:200) avoids ever sending it.
- Throttling: 429 with `Retry-After` and `RateLimit-*`/`Quota-*` headers *(excerpt)*. The adapter classifies 429 as transient/DEFERRED or PARTIAL (:317, :233) but reads none of the headers and does not distinguish per-second rate-limit 429 from monthly-quota 429; it also does not retry within a run (no 8/16/32 s backoff as `autolenis-integrations` prescribes — acceptable for the budget model, but a per-second 429 mid-walk aborts the sweep).
- Timeout: `AbortSignal.timeout(12_000)` per page (:43, :309) → transient → DEFERRED/PARTIAL. Not probed.
- Outage/5xx: transient → DEFERRED/PARTIAL (:317). Not probed.
- Admin tool (`search-tool/run/route.ts:99`) still calls the legacy host `marketcheck-prod.apigee.net` with a 10 s timeout and no `radius`; the MCP server info gives the base host as `api.marketcheck.com`. Not verifiable here whether the apigee host still resolves.

### 9. Distinguishing a complete 100-mile result from a truncated one — **VERIFIED**

**Finding.** Three numbers make it unambiguous: `num_found` (total matching, 90,179), the package cap (500 — discoverable only by the 422 message, or from the plan), and rows actually received. For this market, *every* full sweep is truncated by construction (90,179 ≫ 500), so "complete" is not attainable for a broad query; completeness is only meaningful per narrow query (buyer criteria) where `num_found <= 500`. The adapter already records `numFound`, `rawListings`, `pagesFetched`, `stopReason` (`PROVIDER_CEILING` vs `NUM_FOUND_REACHED` vs `SHORT_PAGE` …) and a coverage verdict (`sync-yield.ts:79-122`) — enough to state truthfully whether the walk saw everything the provider claimed (`stopReason=NUM_FOUND_REACHED` or `SHORT_PAGE` with `rawListings>=num_found`) or was cut by the cap (`PROVIDER_CEILING`/`PAGE_CAP`). Caveat: the 500-row cap is *assumed* (`PROVIDER_PAGINATION_LIMIT`), not read from the account; a basic-plan key (1,500 per excerpt) would be under-walked, and a lower cap would surface only as an unexplained 422 misclassified as end-of-results (item 8).

### 10. Can the CURRENT adapter support the §22a flow without a parallel system? — **PARTIAL — yes structurally, with named extensions; two structural blockers (one contractual, one data-shape)**

**Live qualified-results query.** `MarketCheckAdapter.search(params)` is already a stateless, budget-aware, paginated query taking `zip`, `radius`, `make`, `model`, `yearMin/Max`, `priceMaxCents`, `rowsPerCall`, `maxCalls`, `budget`, `deadlineAt` (`IInventoryAdapter.ts:121-140`). It can be called with a buyer's ZIP and criteria directly. Gaps: no `priceMinCents` / `milesMax` / `car_type` choice (§22a "Used and budget filtering are not optional"; `car_type` is hard-coded `"used"` at :348), no `sort_by`, no `dedup` flag, no pass-through of `dist`/freshness/rooftop fields (`NormalizedVehicle` lacks `dist`, `lastSeenAt`, `dosActive`, `mcWebsiteId`, `mcLocationId`, `mcCategory`, `dealerWebsite`, `listingId`). `normalize()` drops price-less listings (:392) — correct for qualified results.

**Criteria-hash cache.** No cache exists. `InventorySyncRun`/`AdminInventorySearchRun` record runs, not results. A cache keyed on `sha256(zip|radius|criteria)` with a short TTL would be new — but it is a new *table/row*, not a new inventory system, provided its reads go through the same adapter and its writes are governed by item 7's terms.

**Rooftop capture on ingest.** Partly present: `InventoryItem.external_dealer_*`, `mc_rooftop_id`, `mc_dealer_id`, `rooftop_id` (migration 20261105) and `resolveListingRooftops` (match-only, never mints — `listing-rooftop-resolution.service.ts:9-15`). §22a's "the sourcing pool grows with every search" requires *minting* rooftops from listings, which that service deliberately refuses and which `autolenis-dealer-database-ingestion` reserves as the only write path. So the extension is: route listing-derived rooftop facts into the ingestion service (as `DealerDiscovery`/`DealerProspect` candidates with source `marketcheck` and `mc_rooftop_id` as the external id), not into `dealer_rooftops` directly.

**Call accounting.** Present and shared: `tryConsumeCall`/`makeCallBudget` on the `inventory_sources` row (`inventory-call-budget.service.ts:94-168`), used by both the orchestrator (`orchestrator.ts:243-251`) and the admin tool (`search-tool/run/route.ts:73-79`); warning at 80 % and exhausted alerts (`inventory-budget-alert.service.ts`). A buyer query path can reuse `makeCallBudget(sourceId, cycleKey, budget, granted=1..2)` unchanged. Note `DEFAULT_MONTHLY_CALL_BUDGET = 400` leaves ~90 calls/month for everything non-scheduled — at 1-2 calls per qualified buyer that is ~45-90 buyers/month on the free tier; §22a's live query is not viable on the free plan at any real volume.

**Concrete extension points.**
- `frontend/lib/services/inventory/adapters/IInventoryAdapter.ts:121-140` — add `priceMinCents`, `milesMax`, `carType`, `sortBy`, `includeDealerObjects`; :5-45 — add `listingId`, `distMiles`, `providerLastSeenAt`, `daysOnLot` (`dos_active`), `mcWebsiteId`, `mcLocationId`, `mcCategory`, `dealerWebsite`, `dealerGroupName`.
- `frontend/lib/services/inventory/adapters/marketcheck.adapter.ts:47-89` — type `mc_dealership`; :346-382 — send `include_dealer_object=true&include_mc_dealership_object=true` (and `include_build_object=true` if the raw API does not default it), `price_min` from params, `miles_range`, `sort_by=dist`; :226 — read the 422 body and map `"pagination limit"`/`"not found"` to `FAILED` with the message; :246 — reject listings with `dist > radiusMiles`; :312-321 — read `Retry-After`/`Quota-Remaining` on 429; :405-424 — read identifiers from `mc_dealership` first, keep `dealer.website`.
- `frontend/lib/services/inventory/orchestrator.ts:80-90,321-446` — extend `listingFactsFor`/upsert with the new fields; keep persistence in the orchestrator (adapters never write).
- `frontend/lib/services/inventory/listing-rooftop-resolution.service.ts:125-133` — pass `website: dealerWebsite` and prefer `mc_rooftop_id` equality once a `DealerRooftop.mcRooftopId` column exists (schema addition, `prisma/schema.prisma` `model DealerRooftop`).
- New service (extends, does not replace): `frontend/lib/services/inventory/qualified-results.service.ts` — `resolveMarketConfig` → `makeCallBudget(granted<=2)` → `MarketCheckAdapter.search({zip: buyer.zip, radius: 100, …})` → cache row → hand dealer facts to `autolenis-dealer-database-ingestion`. Route under `app/api/buyer/…`, prequal-gated server-side.
- `frontend/app/api/admin/inventory/search-tool/run/route.ts:90-102` — replace the inline apigee fetch with `MarketCheckAdapter.search(...)` (currently a second, divergent client on a different host with no radius — violates `autolenis-integrations` rule 1/"never build a parallel client").
- `frontend/scripts/verify-marketcheck-skip.ts:6` — harmless, but still passes a hard-coded `zip: "10001"`.

**Structural blockers.** (a) Terms of service on persistence/reconstruction (item 7) — cannot be resolved in code. (b) The `mc_rooftop_id` data-shape mismatch (item 5) — resolvable in code, but until fixed no row will ever carry a provider rooftop id, so any §22a design that keys the sourcing pool on `mc_rooftop_id` is building on a column that is always NULL.

---

## Sample field population (N = 15 distinct listings; probes 2, 6, 8; 3 rooftops)

| Field | Populated | Notes |
|---|---|---|
| `id` | 15/15 | `<VIN>-<hex8>-<hex4>`; changes when price/miles change (server_info) |
| `vin` | 15/15 | 17-char |
| `price` | **10/15** | 0/5 at Pine Top Motors |
| `msrp` | 10/15 | |
| `miles` | 15/15 | |
| `heading` / `build.*` | 15/15 / 5/5 | `build` only where `include_build_object=true` was sent |
| `exterior_color` / `interior_color` | 12/15 / 10/15 | |
| `is_certified` | 3/15 | |
| `vdp_url` | 15/15 | |
| `media.photo_links` | 15/15 | 3 were placeholder URLs `…/1920/1080/.jpg` |
| `media.photo_links_cached` | 12/15 | |
| `dist` | 15/15 | 1.85 / 6.18 / 99.46 |
| `last_seen_at` + `last_seen_at_date` | 15/15 | all 2026-09-01 |
| `first_seen_at(_date)`, `first_seen_at_source`, `first_seen_at_mc` | 15/15 | |
| `scraped_at` | 15/15 | |
| `dom`, `dom_180`, `dom_active`, `dos_active` | 15/15 | |
| `ref_price` / `price_change_percent` | 11/15 / 10/15 | |
| `source`, `stock_no`, `in_transit`, `seller_type`, `inventory_type`, `data_source` | 15/15 | |
| `dealer.id` | 15/15 | equals `mc_dealership.mc_website_id` in all 3 rooftops |
| `dealer.website` | 15/15 | discarded by adapter today |
| `dealer.name`, `dealer_type` | 15/15 | franchise ×5, independent ×10 |
| `dealer.street`, `city`, `state`, `zip`, `country` | 15/15 | |
| `dealer.latitude` / `longitude` | 15/15 | strings, e.g. `"33.221006"` |
| `dealer.phone` | 15/15 | |
| `dealer.seller_email` | **10/15** | 0/5 at Pine Top Motors |
| `dealer.msa_code` | 10/15 | |
| `dealer.dealership_group_name` | 5/15 | |
| `mc_dealership.mc_website_id` / `mc_dealer_id` / `mc_location_id` / `mc_rooftop_id` | 15/15 | distinct from each other on every rooftop |
| `mc_dealership.mc_category` | 15/15 | all `"Dealer"` |
| `mc_dealership.mc_dealership_group_id/name` | 5/15 | |
| `dealer.mc_rooftop_id` / `dealer.mc_dealer_id` (what the adapter reads) | **0/15** | keys do not exist on `dealer` |

---

## Blockers that would require STOP

1. **Contract/terms (item 7).** The reported MarketCheck terms prohibit persisting "substantial portions" of data outside normal application use, building a standalone database, and "reconstructing MarketCheck's … dealer network". §22a's catalogue persistence, criteria-hash cache, and especially "the sourcing pool grows with every search" (harvesting rooftop name/address/phone/email into AutoLenis' dealer graph for outreach) need explicit written confirmation from MarketCheck (or a data-feed/enterprise agreement) before implementation. Verbatim terms could not be read from this sandbox — **UNVERIFIED; STOP until confirmed.**
2. **Plan identity (item 3).** The production key's package (free vs basic; 500 vs 1,500-row cap; 500 vs 5,000 calls/month) was not verifiable. §22a's per-buyer live query is not viable on a 500-call/month plan at any real volume (the code reserves ~90 non-scheduled calls/month). Confirm the plan from the MarketCheck dashboard before designing per-buyer spend.
3. **Adapter reads rooftop ids from the wrong object (item 5).** Under the observed payload, `mcRooftopId` is never populated and `mcDealerId` stores the website id. Not a STOP for the sweep, but a STOP for any §22a design that keys the rooftop pool on `mc_rooftop_id` until the adapter is fixed and re-verified against the raw endpoint.

## Adapter extension plan (extend, never parallel)

1. `IInventoryAdapter.ts` — widen `SearchParams` (`priceMinCents`, `milesMax`, `carType`, `sortBy`) and `NormalizedVehicle` (`listingId`, `distMiles`, `providerLastSeenAt`, `daysOnLot`, `mcWebsiteId`, `mcLocationId`, `mcCategory`, `dealerWebsite`, `dealerGroupName`). Keep `buildSourceKey` VIN-first.
2. `marketcheck.adapter.ts` — type and request `mc_dealership` (+`dealer`, +`build`) explicitly; read ids from `mc_dealership` with `dealer` fallback; keep `dealer.website`; reject `dist > radius`; classify 422 by message (`not found` / `pagination limit` → FAILED with reason; otherwise end-of-results); read `Retry-After`/`Quota-*` on 429 and record them on the run; keep `price_min` but source it from params.
3. `orchestrator.ts` — persist the new fields (schema: additive nullable columns on `inventory_items`: `listing_id`, `provider_last_seen_at`, `days_on_lot`, `mc_website_id`, `mc_location_id`, `mc_category`, `external_dealer_website`), following the 20261105 migration pattern (additive, `IF NOT EXISTS`, narrowed selects).
4. `listing-rooftop-resolution.service.ts` — add `mc_rooftop_id` exact match and website-host match (needs `DealerRooftop.mcRooftopId` column); still match-only.
5. New `qualified-results.service.ts` — prequal-gated live query through the same adapter and the same `makeCallBudget` ledger; cache table keyed on criteria hash with TTL; hand rooftop facts to `autolenis-dealer-database-ingestion` (never direct writes) and filter `mc_category` to `Dealer`/`Retailer`/`Dealership Group`.
6. `admin/inventory/search-tool/run/route.ts` — replace the inline apigee fetch with the adapter.
7. Tests — update `marketcheck-dealer-provenance.test.ts` fixtures to the real payload shape (`mc_dealership` object; `dealer.id == mc_website_id`); add 422-message classification and `dist > radius` rejection tests to `marketcheck-pagination.test.ts`.
