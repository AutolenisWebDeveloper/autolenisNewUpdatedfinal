# 03 — Indexable Footprint Map (static analysis)

Derived from the route manifest (`frontend/app/**`, 903 route files; **57 public `page.tsx`
outside `admin|buyer|dealer|affiliate|auth|api`**) plus the generation code for each family.
Paths relative to `frontend/`.

Counts that depend on production rows are given as **the query that would produce them**, never
estimated.

---

## Page families

| # | Family | Route | Generation | Data source | Count / count-determining query | In sitemap | Canonical | Metadata | Structured data | Indexability control | Internal entry points | Conversion path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-1 | Homepage | `/` | static | code | 1 | `sitemap.ts:15` p=1.0 | self via `buildPageMetadata` | `PAGE_METADATA.home` | entity graph + Organization (`layout.tsx:92-94`) | index,follow | site nav | direct CTA |
| F-2 | Core marketing | `/how-it-works`, `/for-buyers`, `/for-dealers`, `/for-affiliates`, `/pricing`, `/about`, `/contact`, `/faq`, `/trust`, `/contract-shield`, `/insurance`, `/request-vehicle`, `/dealer-application` | static | code | **13** | `sitemap.ts:17-31` | self | `PAGE_METADATA` (except `/dealer-application` — **T-3**) | per-page | index,follow | `PublicNav` | CTA → request |
| F-3 | Legal | `/legal/*` | static | code | **7** | `sitemap.ts:38-44` p=0.2–0.3 | self | per-page | — | index,follow | footer | none (correct) |
| F-4 | Free tools | `/tools`, `/tools/dealer-fee-calculator` | static | code | **2** | `sitemap.ts:33-34` | self | per-page | — | index,follow | nav + guides | calculator → lead capture |
| F-5 | **State hub** | `/car-buying-service/texas` | static | `SEO_LOCATIONS` filtered to DFW (`texas/page.tsx:42-44`) | **1** | `sitemap.ts:56` **p=0.9** | self (`PATH`, line 37) | sync `generateMetadata` line 46 | Breadcrumb, ProfessionalService, Service×4, HowTo, FAQPage | index,follow | `CitiesWeServeGrid` | `FinalCta` → request |
| F-6 | **City pages** | `/car-buying-service/[city]` | **SSG**, `dynamicParams=false` (`[city]/page.tsx:47-52`) | `SEO_LOCATIONS` (`lib/seo/locations.ts`, 2592 lines) | **104** — `SEO_LOCATIONS.length`; 21 states (TX,CA,IL,FL,GA,DC,VA,MD,AZ,PA,MI,MA,WA,CO,MN,NC,OR,NV,TN,NY,NJ) | `sitemap.ts:71-76` p=0.8 | self (line 66) | per-city (lines 62-74) | same 6 types as F-5 | `notFound()` if thin (line 82) | Texas hub grid + `NearbyCitiesGrid` | `FinalCta` → request |
| F-7 | Pillar guides | `/buying-guide/{6 slugs}` | static routes | `PILLAR_PAGES` (`lib/seo/pillar-links.ts:13-50`) | **6** | `sitemap.ts:63-68` p=0.9 | self | per-page | Article + FAQ | index,follow | `/buying-guide` hub | in-article CTA |
| F-8 | Guide hub + author | `/buying-guide`, `/author/markist` | ISR 86400 (`buying-guide/page.tsx:18`) | `contentArticle` | **2** | `sitemap.ts:58-59` | self | per-page | Person (author) | index,follow | nav | — |
| F-9 | **Programmatic articles** | `/buying-guide/[slug]` | ISR 3600 (`[slug]/page.tsx:35`) | `contentArticle` | `SELECT count(*) FROM content_articles WHERE status='PUBLISHED' AND noindex=false AND lifecycle_status='ACTIVE';` (sitemap cap 50 000) | `sitemap.ts:100-114` p=0.7 | self | from row | Article, FAQ, Breadcrumb | `noindex` column honoured (line 146); **route/sitemap divergence — T-6** | pillar + related links (`internal-links.ts`) | `buyer-cta.ts` → request |
| F-10 | **AMIPS intelligence** | `/intelligence/[slug]` | ISR 3600 (`[slug]/page.tsx:19`) | `amipsPage` | `SELECT count(*) FROM amips_pages WHERE lifecycle_status='ACTIVE';` | `sitemap-amips-{a..d}.xml` + `sitemap-intelligence.xml` (**duplicated — T-4**) | self (line 85) | from row `title`/`metaDescription` | per-tier | `lifecycleStatus='ACTIVE'` else 404 (lines 38,91) — **see 01/C-7** | `/admin` only — **no public entry point found (T-7)** | `ctaType` per row |
| F-11 | Vehicle categories | `/cars/{suv,trucks,sedans,under-25000,under-30000,under-40000}` | `force-dynamic` (`[make]/page.tsx:15`) | `CATEGORIES` map (line 39) + `inventoryItem` | **6** | `sitemap.ts:46-51` p=0.8 | self | built per category | ItemList, AggregateOffer, LocalBusiness | index,follow | `/inventory` | CTA → request |
| F-12 | Make pages | `/cars/[make]` | `force-dynamic` + `generateStaticParams` (**contradictory — T-5**) | `inventoryItem` distinct `make` | `SELECT count(DISTINCT make) FROM inventory_items WHERE is_active=true;` — **sitemap capped by `take:200` on combos** (`sitemap.ts:127`) | `sitemap.ts:136-142` p=0.7 | self | generated | ItemList, AggregateOffer, LocalBusiness | index,follow | `/inventory`, `/cars/*` | CTA → request |
| F-13 | Make+model | `/cars/[make]/[model]` | `force-dynamic` + `generateStaticParams` (**T-5**) | `inventoryItem` distinct `make,model` | `SELECT count(*) FROM (SELECT DISTINCT make,model FROM inventory_items WHERE is_active=true) t;` — **sitemap emits at most 200** (`sitemap.ts:123-135`) | `sitemap.ts:130-135` p=0.7 | self | generated | Car/ItemList | index,follow | `/cars/[make]` | CTA → request |
| F-14 | Anchor state (legacy) | `/cars/texas` | via `[make]` | — | 1 | `sitemap.ts:53` | self | generated | — | index,follow | — | CTA |
| F-15 | Inventory index | `/inventory` | `force-dynamic` (line 32) | `inventoryItem` | 1 | `sitemap.ts:16` p=0.9 hourly | **pinned to clean `/inventory`** (line 19) | `PAGE_METADATA.inventory` | ItemList | **`noindex,follow` when any filter param present (lines 25-27)** — correct | nav | browse → request |
| F-16 | Vehicle detail | `/inventory/[vehicleId]` | `force-dynamic` (line 13) | `inventoryItem` | `SELECT count(*) FROM inventory_items WHERE is_active=true;` — sitemap capped `take:5000` (`sitemap.ts:85`) | `sitemap.ts:87-92` p=0.6 | self | per-vehicle | Car + Offer (`jsonld.tsx:110`) | `index,follow` (line 74) | `/inventory` | direct request |
| F-17 | Comparisons | `/compare` | ISR 86400 (line 10) + `force-dynamic` (line 9) (**T-5**) | code | 1 | **absent from sitemap** | self | per-page | — | index,follow | nav | CTA |
| F-18 | Refinance | `/refinance`, `/refinance/eligibility`, `/refinance/confirm`, `/refinance/ineligible` | static | code | **4** (only `/refinance` in sitemap) | `sitemap.ts:22` p=0.7 | self | **3 of 4 lack metadata — T-3** | — | index,follow | nav | refinance lead |
| F-19 | Brand / trust | `/hope`, `/testimonials`, `/status`, `/guide`, `/guide/thank-you`, `/feedback` | static | code/DB | **6** (only `/hope` in sitemap) | partial | self | `/feedback` lacks metadata — **T-3** | — | index,follow | footer | varies |
| F-20 | Paid landing | `/lp/[campaign]` | `force-dynamic` (line 7) | code | n/a | **excluded** (`sitemap.ts:54-55`) | — | per-campaign | FAQPage (`page.tsx:254`) | **`noindex, follow`** (line 105) + `Disallow: /lp/` (`robots.ts:10`) | paid only | LP funnel |
| F-21 | Transactional tokens | `/dealer-offer/[token]`, `/dealer-offer-outside/[token]`, `/buyer-offer-review/[reviewToken]` | dynamic | DB | n/a | no | — | title only | — | **`robots:{index:false,follow:false}` page-level — correct** (`dealer-offer/[token]/page.tsx:6`; `dealer-offer-outside/[token]/page.tsx:9`; `buyer-offer-review/[reviewToken]/page.tsx:6`) | emailed links | n/a |
| F-22 | Private portals | `/buyer/*`, `/dealer/*`, `/affiliate/portal/*`, `/admin/*`, `/api/*`, `/auth/*` | dynamic | DB | n/a | no | — | — | — | `Disallow` (`robots.ts:9`) — **no `X-Robots-Tag` header — T-9** | auth | n/a |

---

## Sitemap inventory

| Sitemap | Route file | Contents | Declared in `robots.ts` |
| --- | --- | --- | --- |
| `/sitemap.xml` | `app/sitemap.ts` (148 lines, ISR 3600) | F-1…F-4, F-5, F-6, F-7, F-9, F-11…F-14, F-16 | yes (line 30) |
| `/image-sitemap.xml` | `app/image-sitemap.xml/route.ts` | images | yes (line 31) |
| `/sitemap-amips.xml` | index → tiers a–d | sitemapindex | yes (line 33) |
| `/sitemap-amips-{a,b,c,d}.xml` | `lib/amips/sitemap.ts:40-86` | F-10 by tier, `ACTIVE` only, cap 50 000 | via index |
| `/sitemap-intelligence.xml` | `app/sitemap-intelligence.xml/route.ts` | **all** F-10 `ACTIVE`, cap 50 000 | yes (line 35) |

**Never referenced anywhere:** `lib/services/seo/seo-sitemap.service.ts:6` `generateSitemap()` —
zero callers; its hardcoded 14-page `STATIC_PAGES` list (line 4) is dead code that contradicts
the real 40+ static entries in `app/sitemap.ts`.

---

## Static route-graph connectivity — **approximation only**

Derived from import/link analysis of source files, **not a crawl**. Treat as a hypothesis list.

| Family | Inbound public link found | Approximate status |
| --- | --- | --- |
| F-6 city pages | `CitiesWeServeGrid` (Texas hub), `NearbyCitiesGrid` (city↔city) | linked — but **only 10 DFW cities appear in the Texas hub grid** (`texas/page.tsx:42-44` filters `metro === "Dallas-Fort Worth"`); the remaining ~94 cities in 20 other states have **no state hub** and are reachable only via `NearbyCitiesGrid` proximity or the sitemap |
| F-10 `/intelligence/*` | **none** in any public component or page | **orphaned — T-7.** The only `/intelligence` link in the repo is an admin button (`components/admin/amips/ExecutiveIntelligenceDashboard.tsx:505`) pointing at `/intelligence`, an index route that **does not exist** (only `[slug]` does) — so that button 404s too |
| F-17 `/compare` | nav | linked, but absent from sitemap |
| F-9 articles | pillar + `rankRelatedArticles` (`internal-links.ts:92`) | linked |

**Not attempted — requires crawl infrastructure** (see `04-technical-findings.md`): real orphan
confirmation, crawl depth, live broken links, redirect chains.

---

## Coverage gaps visible from code alone

| Gap | Evidence |
| --- | --- |
| **No state hubs outside Texas** | `car-buying-service/[city]/page.tsx:93-94` — non-TX cities render the state as a **non-linked** breadcrumb because no hub exists. 20 states have city pages with no state-level parent. |
| **No metro-level pages** | `SeoLocation.metro` exists (128 occurrences) and 25 metros are assumed (`executive-intelligence.ts:27` `METRO_UNIVERSE = 25`) but no `/car-buying-service/[metro]` route exists. |
| **No make+model+location family** | F-13 is national only; no `/cars/[make]/[model]/[city]` route. The highest-intent automotive query shape is uncovered. |
| **Make/model sitemap capped at 200** | `sitemap.ts:127` `take: 200` on the distinct query — beyond 200 combos, pages exist and render but are never submitted. |
| **`/compare` absent from sitemap** | comparison intent is unrepresented in F-17. |
