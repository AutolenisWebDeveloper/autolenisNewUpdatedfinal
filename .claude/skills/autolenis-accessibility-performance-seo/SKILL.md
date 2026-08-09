---
name: autolenis-accessibility-performance-seo
description: >-
  Owns AutoLenis accessibility, web performance, and SEO — WCAG 2.2 AA, Core Web
  Vitals, bundle budgets, structured data / JSON-LD, canonicals, city/state
  landing pages, sitemaps/robots, and the strict noindex boundary for private
  buyer/dealer/admin/affiliate portals. Use this skill when touching
  frontend/lib/seo/, app/sitemap*.xml, app/robots.ts, the (public) route group,
  page metadata, JSON-LD, canonical/hreflang, image/font/bundle performance, or
  a11y (keyboard, focus, contrast, ARIA, alt text); or when a task mentions SEO,
  Lighthouse, LCP/CLS/INP, structured data, landing page, or accessibility.
---

## Purpose & Authority

This skill governs how AutoLenis is discovered, ranks, loads, and stays usable
for everyone. It owns the public `(public)` surface's SEO and Core Web Vitals and
the accessibility standard for every portal. It overrides generic "add some meta
tags" or "ship it, it looks fine" advice. Organic search and the city/state
landing pages are a primary acquisition channel, so a broken canonical, a
missing JSON-LD entity, a leaked-into-index portal, or a regressed LCP is a
revenue event — and accessibility is a legal and product baseline, not a
nice-to-have. The target is WCAG **2.2 AA** and green Core Web Vitals on the
public funnel.

## When this skill activates

- `frontend/lib/seo/**` (and `lib/seo/__tests__/**`).
- `app/sitemap.ts`, `app/sitemap-*.xml/`, `app/image-sitemap.xml/`,
  `app/sitemap-intelligence.xml/`, `app/robots.ts`, `app/og/`, `app/icon.tsx`.
- Any page/layout under `app/(public)/**`, and metadata anywhere.
- Keywords: SEO, metadata, canonical, JSON-LD, structured data, sitemap, robots,
  hreflang, landing page, city/state page, Lighthouse, Core Web Vitals, LCP,
  CLS, INP, bundle budget, WCAG, a11y, contrast, focus, ARIA, alt text, noindex.

## Architecture & key files

- **SEO library (`lib/seo/`):** `metadata.ts` (`buildPageMetadata`,
  `PAGE_METADATA`), `jsonld.tsx` (`JsonLd`, `organizationSchema`,
  `localBusinessSchema`, `websiteSchema`, `vehicleSchema`, `pricingSchema`,
  `personSchema`, `articleSchema`; plus `AUTOLENIS_NAP`, `AUTOLENIS_SAMEAS`),
  `locations.ts` (`SEO_LOCATIONS`, `SEO_LOCATION_SLUGS`, `getLocationBySlug`,
  `hasPublishableContent`, `nearestLocations`, `haversineMiles`, `cityFormSource`),
  `internal-links.ts`, `pillar-links.ts`, `entity-graph.ts`,
  `content-keywords.ts`, `article-body.ts`, `buyer-cta.ts`, `page-templates.ts`.
- **Sitemaps/robots:** `app/sitemap.ts` (routes), `app/robots.ts`,
  `app/image-sitemap.xml`, AMIPS tier-segmented `app/sitemap-amips*.xml`,
  `app/sitemap-intelligence.xml`.
- **Public pages:** `app/(public)/` — home `page.tsx`, `car-buying-service`
  (organic hub), `inventory`, `cars`, `compare`, `how-it-works`, `pricing`,
  `for-buyers`/`-dealers`/`-affiliates`, `legal`, `intelligence`, city/state
  landing pages, and `lp/` (paid funnel — deliberately disallowed in robots so it
  never competes with the organic hub).
- **Perf config (`next.config.mjs`):** preconnect `Link` headers
  (fonts.googleapis.com, js.stripe.com, Supabase), `images.remotePatterns`
  (use `next/image`), CDN cache headers for `/inventory/*`
  (`public, max-age=3600, stale-while-revalidate=86400`), security headers.
- **Components:** `components/seo/`, `components/ui/` (shared primitives).

## Core rules & invariants

1. **Private portals are never indexable.** `robots.ts` disallows `/buyer/`,
   `/dealer/`, `/affiliate/portal/`, `/admin/`, `/api/`, `/auth/`, `/lp/`,
   `/thank-you`. New private routes must be added to disallow **and** carry
   `robots: { index: false }` metadata. Only `(public)` (minus `/lp`) is indexed.
2. **Every public page has complete metadata** via `buildPageMetadata` /
   `PAGE_METADATA`: unique title + description, a self-referential **canonical**,
   and OpenGraph/Twitter. No duplicate titles; no missing canonicals.
3. **Structured data matches the page** and uses the real helpers in
   `jsonld.tsx` (Organization/LocalBusiness on the org surface, `vehicleSchema`
   on VDPs, `pricingSchema` on pricing, `articleSchema`/`personSchema` on
   content). NAP comes from `AUTOLENIS_NAP` — never hardcode conflicting business
   data. JSON-LD must reflect visible content (no schema spam).
4. **City/state landing pages are gated by real content.** Only emit a location
   page (and sitemap entry) when `hasPublishableContent(loc)` is true; cross-link
   via `nearestLocations`. No thin/doorway pages.
5. **Canonicals + redirects are consistent** with `next.config.mjs` `redirects()`
   (e.g. `/terms → /legal/terms`, `/buyer/vehicle-requests → /buyer/requests`).
   One canonical URL per resource; canonical points to the indexable version.
6. **Core Web Vitals budgets** on public routes: LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤
   200ms (field-equivalent). Server-render above-the-fold; stream the rest.
7. **Images through `next/image`** with explicit dimensions (no CLS) and
   meaningful `alt`; hosts must be in `images.remotePatterns`.
8. **Bundle discipline.** Keep the public bundle lean — Server Components by
   default, defer/lazy non-critical client JS, avoid heavy client libs on
   marketing pages (see `autolenis-nextjs-react`). No unnecessary `"use client"`.
9. **WCAG 2.2 AA.** Semantic HTML and landmarks; full keyboard operability with a
   visible focus indicator; text contrast ≥ 4.5:1 (3:1 large/UI); labelled
   controls and error messaging; respect `prefers-reduced-motion`; target sizes
   and focus-not-obscured per 2.2. ARIA only to fill gaps native HTML can't.
10. **Don't fork the config.** Reuse `next.config.mjs` headers/caching and the
    `lib/seo` helpers; extend, never duplicate.

## Workflows

**Ship a public page**
1. Server Component under `app/(public)/`; export metadata via
   `buildPageMetadata`/`PAGE_METADATA` with a self-referential canonical.
2. Add matching JSON-LD from `lib/seo/jsonld.tsx` (`<JsonLd>`); verify it mirrors
   visible content.
3. Ensure inclusion in `app/sitemap.ts` and that it is **not** in `robots.ts`
   disallow; internal-link it via `internal-links.ts`/`pillar-links.ts`.
4. Use `next/image` (dimensions + alt); keep client JS minimal.
5. Run `test:seo`, then `test:visual`; audit a11y + polish with `impeccable`.

**Add a city/state landing page**
1. Add/verify the entry in `SEO_LOCATIONS`; only publish when
   `hasPublishableContent` is true.
2. Emit `localBusinessSchema()` with `AUTOLENIS_NAP`; cross-link
   `nearestLocations`; wire `cityFormSource` into the buyer request CTA.
3. Confirm it lands in the correct sitemap and carries a canonical.

**Add a private/portal route**
1. Add its prefix to `robots.ts` disallow; set `robots: { index: false }`.
2. Confirm no sitemap references it and no public page links to it for crawlers.

**Fix a Core Web Vitals / a11y regression**
1. Identify the metric (LCP image/font, CLS from unsized media/late fonts, INP
   from heavy client JS) or WCAG failure (contrast, focus, keyboard, labels).
2. Prefer server rendering, `next/image` dimensions, preconnect, and smaller
   client bundles; re-verify with Lighthouse + `test:visual`.

## Boundaries — do / never

**Do**
- Give every public page unique metadata + a self-referential canonical.
- Use `lib/seo` helpers and `AUTOLENIS_NAP`; match JSON-LD to visible content.
- Gate location pages on `hasPublishableContent`; cross-link real ones.
- Serve images via `next/image` with dimensions + alt; keep bundles lean.
- Meet WCAG 2.2 AA: keyboard, focus, contrast, labels, reduced motion.
- Keep private portals in `robots.ts` disallow **and** `noindex`.

**Never**
- Index or sitemap a buyer/dealer/admin/affiliate/`lp`/`thank-you` route.
- Ship a public page with a missing/duplicate title or missing canonical.
- Emit JSON-LD that doesn't reflect on-page content, or hardcode NAP that
  conflicts with `AUTOLENIS_NAP`.
- Create thin/doorway location pages lacking publishable content.
- Use `<img>`/unsized media that causes CLS, or add heavy client JS to marketing
  pages "just in case".
- Rely on color alone, remove focus outlines, or ship keyboard-inaccessible UI.

## Best practices & examples

Metadata + canonical + JSON-LD on a public page:

```tsx
import { buildPageMetadata } from "@/lib/seo/metadata";
import { JsonLd, localBusinessSchema } from "@/lib/seo/jsonld";
import { getLocationBySlug, hasPublishableContent } from "@/lib/seo/locations";

export function generateMetadata({ params }) {
  return buildPageMetadata({ /* title, description, self-referential canonical */ });
}

export default function CityPage({ params }) {
  const loc = getLocationBySlug(params.city);
  if (!loc || !hasPublishableContent(loc)) notFound();  // no thin/doorway page
  return (
    <>
      <JsonLd id="local-business" data={localBusinessSchema()} /> {/* NAP from AUTOLENIS_NAP */}
      {/* server-rendered above-the-fold; next/image with dimensions + alt */}
    </>
  );
}
```

Keeping a portal out of the index (both signals):

```ts
// app/robots.ts already disallows /admin/, /buyer/, /dealer/, ...
export const metadata = { robots: { index: false, follow: false } }; // new private route
```

## Acceptance criteria

- [ ] Public page has unique title/description, OpenGraph/Twitter, and a
      self-referential canonical via `buildPageMetadata`/`PAGE_METADATA`.
- [ ] JSON-LD from `lib/seo/jsonld.tsx` matches visible content; NAP from
      `AUTOLENIS_NAP`.
- [ ] Location pages only publish when `hasPublishableContent`; cross-linked and
      in the correct sitemap.
- [ ] No private/`lp`/`thank-you` route is indexed or sitemapped; new private
      routes are in `robots.ts` disallow **and** `noindex`.
- [ ] Images use `next/image` with dimensions + alt; hosts in `remotePatterns`;
      client JS minimized (no needless `"use client"`).
- [ ] Core Web Vitals budgets met (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms).
- [ ] WCAG 2.2 AA: keyboard operable, visible focus, ≥4.5:1 contrast, labelled
      controls, reduced-motion respected.
- [ ] `test:seo` and `test:visual` pass; `impeccable` audit clean.

## Cross-skill links

- `autolenis-nextjs-react` — Server/Client boundaries, caching, streaming that
  drive CWV and bundle size.
- `autolenis-testing-quality-gates` — `test:seo` + Playwright visual gates.
- `lib/services/content` + AMIPS work — location/content generation feeding the
  sitemaps.
- `autolenis-observability-sre` — sitemap/robots cron behavior and monitoring.
- `autolenis-ui-design-system` (tokens + component kit) and `impeccable` (a11y + UX audit).
