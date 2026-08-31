# 05 — Programmatic Content Quality Risk

Template-to-unique-content ratios measured from the templates themselves. Paths relative to
`frontend/`.

**Word counts below are measured from source** (JSX text nodes and string literals in the shared
components; the unique fields parsed directly out of `lib/seo/locations.ts`). They approximate
*rendered* text — a rendered-HTML measurement needs a crawl, which does not exist here
(`02-data-sources.md`, D-8). Ratios are therefore **approximations**, explicitly labelled.

---

## Programmatic families and their gates

| Family | Route | Count | Uniqueness gate | Blocks publish? | Risk |
| --- | --- | --- | --- | --- | --- |
| City pages | `/car-buying-service/[city]` | 104 | `hasPublishableContent()` — word-count floors | **Yes — `notFound()`** | **LOW** |
| Buying-guide articles | `/buying-guide/[slug]` | DB-driven | Jaccard vs same **cluster + city** | **No — `required: false`** | **HIGH** |
| AMIPS intelligence | `/intelligence/[slug]` | DB-driven | Jaccard vs same **make + model + metro** | Yes — `FAILED` returns to queue | **MEDIUM** |
| Make / make+model | `/cars/[make]`, `/cars/[make]/[model]` | inventory-driven | **none** | n/a | **HIGH** |
| Vehicle detail | `/inventory/[vehicleId]` | inventory-driven | **none** | n/a | MEDIUM |
| Category pages | `/cars/{suv,trucks,…}` | 6 | none (hand-authored) | n/a | LOW |

---

## R-1 · City pages — the strongest gate in the codebase (LOW risk)

`lib/seo/locations.ts:2546-2554`:
```
wordCount(uniqueIntro) >= 120 && wordCount(localContext) >= 80 &&
localFaqs.length >= 3      && nearbyAreas.length >= 3
```
Enforced twice — `generateMetadata` returns `noindex` (`car-buying-service/[city]/page.tsx:59-61`)
and the page calls `notFound()` (line 82). With `dynamicParams = false` (line 52) only the 104
dataset slugs can render at all. **A thin city page is structurally impossible.**

### Measured content per city page (n = 104)

| Component | Words (min / avg / max) |
| --- | --- |
| `uniqueIntro` | 137 / **153** / 170 |
| `localContext` | 95 / **106** / 121 |
| `localFaqs` | 105 / **122** / 143 |
| **Unique subtotal** | **337 / 381 / 434** |

### Measured shared template

| Shared component | Words |
| --- | --- |
| `ComparisonTable` | 214 |
| `SeoHero` | 191 |
| `TrustIndependence` | 184 |
| `WhatWeDoConcierge` | 132 |
| `FinalCta` | 109 |
| `HowItWorksReverseAuction` | 93 |
| `SeoFaqSection` | 86 |
| `SavingsCallout` | 80 |
| `Breadcrumbs` | 46 |
| **Component subtotal** | **1,135** |
| `REVERSE_AUCTION_STEPS` (`content.ts`) | 161 |
| `CORE_FAQS.slice(0,3)` (`[city]/page.tsx:88`) — 3 of the shared FAQs | portion of 334 |

**Approximate ratio: ~381 unique / ~1,450 shared ≈ 21% unique, 79% shared.**

**Assessment.** 21% is low in the abstract, but the shared 79% is *legitimate* shared
explanation — how the reverse auction works, the comparison table, trust and CTA — which any
service business repeats across locations. Google's guidance targets *scaled content abuse*:
pages with no independent value. Each city page carries 337+ words of genuinely
location-specific prose plus 3+ location-specific FAQs and a haversine-computed
`NearbyCitiesGrid` (`car-buying-service/[city]/page.tsx:38`). **This family is defensible.** The
gate is the model the rest of the system should follow.

**Residual risk:** the floors are *word counts*, not similarity checks. Nothing prevents 104
`uniqueIntro` values that are 150 words of the same sentences with the city swapped. **No
cross-city similarity check exists for this family.** The dataset is hand-authored today
(2,592 lines), so this is a latent risk that materialises the moment cities are added at scale.

---

## R-2 · Buying-guide articles — the highest risk (HIGH)

Two independent defects compound.

**Defect A — the duplicate check does not block publication.**
`lib/services/content/content-validation.service.ts:245` sets `required: false` on the
`duplicate` layer. `ValidationRunResult.passed` is defined as *"every REQUIRED layer passed"*
(line 39). **A near-duplicate article therefore passes validation and publishes**, carrying only
an advisory `Near-duplicate of <slug> at NN%` string (line 249).

**Defect B — the corpus cannot see the duplication that actually matters.**
`content-validation.service.ts:341-342`:
```ts
where: { cluster: article.cluster, city: article.city, id: { not: article.id } }
```
The comparison set is same-cluster **and** same-city. The dominant programmatic pattern here is
one cluster template × many cities (`ContentArticle` has `cluster`, `city`, `metro`,
`targetKeyword` — `prisma/schema.prisma:4284-4291`). **A "dealer fees in Dallas" article is
never compared against "dealer fees in Houston"** — different `city`, so the Houston article is
excluded from the corpus by construction. The single highest-probability duplication axis is the
one the query filters out.

Combined: the family most likely to produce city-swapped near-duplicates has a duplicate check
that (a) looks in the wrong place and (b) would not stop publication even if it looked in the
right one.

**What does hold:** `MIN_WORDS = 700` (line 25) and compliance/sanitization layers are
REQUIRED and do block. Fact-risk sets `requiresHumanReview` so generation never auto-publishes a
flagged article (lines 15-17). So articles are *long* and *compliant* — just not provably
*distinct*.

**Remediation:** make `duplicate` a REQUIRED layer, and widen the corpus to same-`cluster`
**across cities** (keep `take: 200`, order by recency) — optionally with a higher threshold for
cross-city than same-city, since some overlap is expected.

---

## R-3 · AMIPS pages — MEDIUM

`lib/amips/quality-gate.ts:88-98` compares Jaccard similarity > 0.8 against `existingBodies`,
supplied by `lib/amips/amips-generator.ts:165-173`:
```ts
where: { make: data.vehicle.make, model: data.vehicle.model, metro: data.market?.metro ?? null }
```
**Same blind spot as R-2, one axis over:** the same vehicle in a *different metro* has a
different `metro` value and is excluded from the corpus. Given AMIPS tiers C/D/E are explicitly
metro tiers (`quality-gate.ts:18` — `METRO_TIERS = {"C","D","E"}`), metro-swapped near-duplicates
for the same make+model are the expected failure mode and are structurally invisible.

Unlike R-2 the gate **does** block: `FAILED` returns the item to the queue
(`amips-generator.ts:181-193`), and only 5/5 publishes (`quality-gate.ts:140-141`). Risk is
MEDIUM rather than HIGH because bodies are LLM-generated per page (higher natural variance) and
Gate 1 requires ≥3 real data tokens (line 83), which forces per-page factual differentiation.

### R-3a · Stateful-regex defect lets non-compliant content publish — HIGH severity

`lib/amips/quality-gate.ts:37,39` declare module-level regexes with the `/g` flag and use them
with `.test()`:
```ts
const HARD_FAIL_PATTERN   = /\bguaranteed\b/gi;                 // line 37
const UNDATED_APR_PATTERN = /\b\d+(?:\.\d+)?\s*%\s*APR\b/gi;    // line 39
```
Used at lines 110 and 113. A `/g` regex advances `lastIndex` on a successful `.test()` and
**retains it across calls**. Because these constants are module-scoped and reused for every page,
results alternate. Demonstrated:

```
HARD_FAIL_PATTERN.test("This deal is guaranteed to be the best.")
  call 1 → true   (lastIndex 23)
  call 2 → false  (lastIndex 0)     ← the guarantee is NOT caught
  call 3 → true   (lastIndex 23)
```

**Effect: roughly every second AMIPS page containing "guaranteed" passes Gate 3 and can
publish.** The same applies to the undated-APR warning at line 110. Since Gate 3 is the
compliance gate, this is a compliance defect, not merely an SEO one — AutoLenis represents the
buyer and must not publish absolute guarantees.

`STRIP_PATTERNS` (lines 32-35) is **not** affected: `.test()` is followed by `.replace()`
(lines 104-106), and `String.replace` with a global regex ignores `lastIndex` and resets it to
0 afterwards.

**Remediation:** drop the `/g` flag from both patterns (neither needs it — `.test()` only asks
*does it match*), or construct them inside `runQualityGates`, or use `.search() !== -1`.

---

## R-4 · Make and make+model pages have no quality gate at all — HIGH

`/cars/[make]` and `/cars/[make]/[model]` are generated directly from distinct
`inventoryItem.make` / `make,model` values (`app/sitemap.ts:123-142`;
`app/(public)/cars/[make]/page.tsx:122`). There is **no uniqueness gate, no minimum-content
gate, and no publishability check** anywhere in this path.

Consequences:
- **A single inventory row creates an indexable page.** One listing for an obscure make+model
  yields a page whose only unique content is that one vehicle. If the listing sells and
  `isActive` flips, the page becomes an empty result set that still renders and is still
  indexed until the sitemap regenerates.
- **Data quality propagates straight to public URLs.** `slugify` is
  `value.toLowerCase().trim().replace(/\s+/g,"-")` (`cars/[make]/page.tsx:22`) — it strips
  nothing else. A make or model containing `/`, `#`, `?`, `&` or an accent produces a malformed
  or colliding URL. Two different source values that differ only in punctuation collapse to the
  same slug.
- **A feed change silently changes the URL space.** Nothing throttles how many new indexable
  URLs an inventory sync can mint. `autolenis-inventory-intelligence` describes LANE_3 as
  low-confidence external listing data; this path turns it into public URLs with no gate.

This is the clearest instance of the prompt's *"code path that can generate pages without a
quality or uniqueness gate."*

**Remediation:** require a minimum active-listing count before a make/model page is indexable
(`noindex` below the floor rather than 404, to avoid flapping); harden `slugify` to a strict
`[a-z0-9-]` allowlist with collision detection; cap net-new URLs per sync.

---

## R-5 · `/inventory/[vehicleId]` — MEDIUM
One indexable URL per active inventory row (`app/sitemap.ts:81-92`, `take: 5000`), no content
gate, `robots: {index:true, follow:true}` (`inventory/[vehicleId]/page.tsx:74`). Standard for
marketplaces, and the sitemap cap bounds submission — but sold/expired vehicles leave the sitemap
without any explicit 410/`noindex` transition, which accumulates soft-404s over time. Flagged,
not escalated.

---

## Cross-cutting: the same bug, three times

| Family | Corpus scope | The axis it cannot see | Blocks? |
| --- | --- | --- | --- |
| `/buying-guide/*` | `cluster + city` | **same cluster, other cities** | **No** |
| `/intelligence/*` | `make + model + metro` | **same vehicle, other metros** | Yes |
| `/car-buying-service/*` | none (word floors only) | **any cross-city similarity** | Yes (on length) |

Every uniqueness check in the system compares a page only against pages sharing its *location
token*. The location token is precisely what varies in a city-swap. **No programmatic family has
a cross-location similarity check.** This is one systemic design error expressed three ways, and
it should be fixed once — as a shared "compare across the location axis, not within it" helper
used by all three — rather than three times.

Both engines already agree on the threshold (`0.8` in
`content-validation.service.ts:27` and `quality-gate.ts:91`, with the former's comment
explicitly noting it *"mirrors AMIPS quality-gate uniqueness"*), so a shared implementation is a
consolidation, not a new system.

---

## Alignment with Google's scaled-content guidance

Labelled **UNVERIFIED-AGAINST-LIVE-DOCS** — no network access was used; cited from knowledge as
of the training cutoff. Verify against
`developers.google.com/search/docs/essentials/spam-policies#scaled-content-abuse` and the
`helpful, reliable, people-first content` guidance before acting.

| Guidance | AutoLenis position |
| --- | --- |
| Scaled content abuse — generating many pages with little original value | City pages **comply** (R-1). Make/model pages are **exposed** (R-4). Buying-guide is **exposed** (R-2). |
| Doorway pages — near-identical pages funnelling users to one destination | City pages explicitly designed against this (`locations.ts:19-23`) and gated. Buying-guide has no cross-city gate. |
| "Who / How / Why" self-assessment — disclose AI generation, add value beyond the template | AMIPS Gate 1 forces ≥3 real data tokens — good. No AI-generation disclosure was found on `/intelligence/*` or `/buying-guide/*` pages. |
| Unverifiable claims | AMIPS **actively strips** savings claims (`quality-gate.ts:32-35`) — genuinely good practice, undermined by R-3a for the `guaranteed` hard-fail. |

**Consistency check — VERIFIED, and it passes.** `quality-gate.ts:30-31` states *"We have no
transaction data at Tier B–E, so any '$X saved' / 'average savings' language is removed."*
`SavingsCallout` (80 words, rendered on all 104 city pages and the Texas hub) does **not** pass
through that stripper, so it was checked directly:

- `components/seo/landing/SavingsCallout.tsx:1-2` — file header: *"ALL figures are owner-confirm
  placeholders — never fabricate savings numbers (FTC/Google YMYL violation)."*
- Lines 20-21 — the average-savings figure block is **deliberately not rendered**:
  *"hidden until an owner-confirmed, substantiated number exists — never render a placeholder."*
- Lines 16-17 — the only claim is directional and unquantified: *"the out-the-door price tends to
  fall versus negotiating alone."*
- Lines 24-25 — carries a disclaimer: *"Savings vary… AutoLenis does not guarantee any specific
  savings outcome."*

**The two systems agree.** The city family makes no quantified savings claim, and no conflict
exists. This is recorded as a positive finding: it is the correct YMYL posture, and any redesign
must preserve both the AMIPS stripper and this component's withheld-figure behaviour.
