---
name: autolenis-nextjs-react
description: >-
  Owns the AutoLenis Next.js App Router frontend — Server vs Client Components,
  Server Actions, route handlers, caching/revalidation, streaming/Suspense, and
  the (public)/buyer/dealer/affiliate/admin route-group architecture. Use this
  skill when adding or changing pages, layouts, route handlers, Server Actions,
  loading/error boundaries, data fetching, or any code under frontend/app/ or
  frontend/components/; when deciding "use client" vs server; when touching
  next.config.mjs, tailwind.config.ts, or proxy.ts; or when reviewing rendering,
  caching, or hydration behavior.
---

## Purpose & Authority

This skill governs how React and Next.js are used in the AutoLenis frontend
(`frontend/`, Next.js **16.2.9**, App Router, React 19, TypeScript strict, pnpm
10.33.0). It is the source of truth for component boundaries, data fetching,
caching, and route structure. Where generic Next.js advice conflicts with the
patterns here — for example "just make it a client component" or "fetch in a
useEffect" — this skill wins. Rendering choices in AutoLenis are load-bearing:
buyer/dealer/admin portals carry authenticated PII and money-adjacent state, and
the `(public)` group carries the SEO surface, so the server/client split is a
correctness and security decision, not a preference.

## When this skill activates

- Any file under `frontend/app/**` (pages, `layout.tsx`, `route.ts`,
  `loading.tsx`, `error.tsx`, `not-found.tsx`, `sitemap.ts`, `robots.ts`).
- Any component under `frontend/components/**`.
- Editing `frontend/next.config.mjs`, `frontend/tailwind.config.ts`, or
  `frontend/proxy.ts` (edge routing — there is **no** `middleware.ts`).
- Keywords: "use client", Server Action, route handler, `revalidate`,
  `dynamic = "force-dynamic"`, Suspense, streaming, hydration, App Router,
  route group, `after()`.
- Deciding whether new UI belongs in `(public)`, `buyer/`, `dealer/`,
  `affiliate/`, `admin/`, or `auth/`.

## Architecture & key files

Route groups under `frontend/app/`:

- `(public)/` — marketing + SEO surface: `page.tsx` (home), `car-buying-service`,
  `inventory`, `cars`, `compare`, `how-it-works`, `pricing`, `for-buyers`,
  `for-dealers`, `for-affiliates`, `legal`, `contract-shield`, `insurance`,
  `refinance`, `intelligence`, `lp` (paid funnel), plus city/state landing pages.
- `buyer/` — authenticated buyer portal (requests, auction, deal, deposit,
  insurance, pickup). Private, `noindex`.
- `dealer/` — authenticated dealer portal (apply, sign-in, offers, scorecard).
- `affiliate/` — affiliate portal.
- `admin/` — internal ops/compliance/finance/support console (~53 subroutes).
- `auth/` — sign-in / verification flows.
- `api/` — route handlers, including `api/cron/*` and `api/webhooks/*`.

Supporting: root `layout.tsx`, `error.tsx`, `global-error.tsx`, `loading.tsx`,
`not-found.tsx`, `globals.css`, `sitemap.ts`, `robots.ts`. Edge routing/role
gating lives in `frontend/proxy.ts`. Data access goes through `lib/prisma.ts`,
`lib/supabase*.ts`, and the service layer `frontend/lib/services/<domain>/` —
**pages and components never inline Prisma queries when a service exists**.
Background work is dispatched with Vercel `after()`, Inngest (`lib/inngest`), or
QStash (`lib/qstash`), never awaited on the render path.

`next.config.mjs` already defines security headers (X-Frame-Options DENY,
nosniff, Referrer-Policy, Permissions-Policy), `/api` CORS, preconnect `Link`
headers, `images.remotePatterns`, canonical `redirects()`, and Turbopack root.
Respect these — add to them, do not fork them.

## Core rules & invariants

1. **Server Components are the default.** A file is a Server Component unless it
   genuinely needs interactivity. Add `"use client"` only when the component uses
   state, effects, browser APIs, event handlers, or client-only libraries.
2. **Push the client boundary down.** Keep pages/layouts as Server Components and
   wrap only the interactive leaf in a small client component. Never mark a whole
   page `"use client"` to satisfy one button.
3. **Data fetching happens on the server** — in Server Components, Server Actions,
   or route handlers via the service layer. Do not fetch authenticated data from
   client `useEffect`; do not ship secrets or Prisma into the client bundle.
4. **Authorization is server-side, every time.** Gate in `proxy.ts` and re-check
   in the Server Action / route handler using `lib/admin-auth.ts`,
   `lib/dealer-auth.ts`, `lib/auth`, `lib/security`. Never trust a client role
   check or hidden UI as a security boundary.
5. **Mutations use Server Actions or route handlers**, then `revalidatePath` /
   `revalidateTag`. No mutating `GET`s.
6. **Caching is explicit.** For dynamic/authenticated routes set
   `export const dynamic = "force-dynamic"`; for cacheable public data use
   `revalidate` / `unstable_cache` with keys on `(zip, make, model, radius)` per
   the platform inventory caching convention.
7. **Every async UI boundary has `loading.tsx` and `error.tsx`.** Stream slow
   sections behind `<Suspense>`; never block the whole route on one slow query.
8. **Money is integer minor units end-to-end** (`maxOtdAmountCents`,
   `maxOtdAmountCents`, `*Cents`). Never render or accept dollar floats; never
   trust client-computed payment/deposit status.
9. **Private portals are `noindex`**; only `(public)` is indexable (see
   `autolenis-accessibility-performance-seo`).
10. **Extend existing patterns.** Read the neighboring route/component before
    adding one; never stand up a parallel data-fetch or auth mechanism.

## Workflows

**Add a public marketing/SEO page**
1. Create `app/(public)/<segment>/page.tsx` as a Server Component.
2. Export `metadata` (or `generateMetadata`) via `lib/seo/metadata.ts`; add
   JSON-LD from `lib/seo/jsonld.tsx`; ensure a canonical.
3. Fetch cacheable data server-side with `revalidate`; add `loading.tsx`.
4. Confirm the route is reachable from `sitemap.ts` and not in `robots.ts`
   disallow. Hand visual polish to `autolenis-ui-design-system`; audit with
   `impeccable`.

**Add an authenticated portal page (buyer/dealer/admin)**
1. Create the page under the correct route group; keep it a Server Component.
2. Resolve the session/role server-side (`lib/*-auth.ts`); redirect on failure.
3. Load state through `lib/services/<domain>/`; render current state-machine
   stage (e.g. `DealStatus`, `AuctionStatus`, `VehicleRequestStatus`).
4. `export const dynamic = "force-dynamic"`; add `loading.tsx` + `error.tsx`.
5. Interactive controls → small `"use client"` leaf calling a Server Action.

**Add a mutation (Server Action)**
1. Define the action in a server module; re-authenticate + authorize inside it.
2. Validate input at the boundary (schema/coercion) before any DB write.
3. Call the domain service; dispatch side effects (email/SMS/webhooks) via
   `after()` / Inngest / QStash — do not await them on the response path.
4. `revalidatePath`/`revalidateTag` the affected routes; return a typed result.

**Add a route handler / webhook**
1. `app/api/<area>/route.ts`; verify auth (cron secret via `CRON_AUTH_HEADER`,
   webhook signature, or JWT) before doing work.
2. Keep handlers idempotent; verified Stripe/DocuSign/MicroBilt webhooks only.
3. Return typed JSON `{ success, data }` / `{ success, error }`; log with
   `lib/logger`.

## Boundaries — do / never

**Do**
- Default to Server Components; isolate interactivity in leaf client components.
- Fetch via the service layer; keep Prisma/Supabase server-only.
- Use Server Actions + `revalidate*` for mutations.
- Add `loading.tsx`/`error.tsx` and Suspense for streaming.
- Keep `noindex` on all private portals; reuse `next.config.mjs` headers.

**Never**
- Mark a page/layout `"use client"` to enable one interactive child.
- Fetch authenticated data or hold secrets in client components.
- Rely on client-side role checks, hidden buttons, or disabled inputs for auth.
- Perform mutations in `GET` handlers or trust client-side money/status values.
- Await email/SMS/enrichment/webhook fan-out on the request/render path.
- Introduce a `middleware.ts` (routing lives in `proxy.ts`) or a second
  data-access path when a service already exists.

## Best practices & examples

Push the client boundary down:

```tsx
// app/buyer/deal/[id]/page.tsx  — Server Component
export const dynamic = "force-dynamic";
export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireBuyer();               // lib/auth — server-side
  const deal = await dealService.getForBuyer(id, session.buyerId); // service layer
  return (
    <>
      <DealTimeline status={deal.status} />            {/* server-rendered */}
      <Suspense fallback={<OffersSkeleton />}>
        <DealOffers dealId={id} />                     {/* streams independently */}
      </Suspense>
      <AcceptOfferButton dealId={id} />                {/* small "use client" leaf */}
    </>
  );
}
```

```tsx
// components/buyer/AcceptOfferButton.tsx
"use client";
export function AcceptOfferButton({ dealId }: { dealId: string }) {
  return <button onClick={() => acceptOffer(dealId)}>Accept</button>; // Server Action
}
```

Server Action re-authorizes and revalidates:

```ts
"use server";
export async function acceptOffer(dealId: string) {
  const session = await requireBuyer();               // never trust the client
  await dealService.acceptOffer(dealId, session.buyerId); // FINANCING never auto-chosen
  after(() => notificationsService.dealAccepted(dealId)); // off the request path
  revalidatePath(`/buyer/deal/${dealId}`);
}
```

## Acceptance criteria

- [ ] New/changed component is a Server Component unless interactivity requires
      `"use client"`; the client boundary is a small leaf, not a whole page.
- [ ] No authenticated data fetched client-side; no secrets/Prisma in client bundle.
- [ ] Mutations run through Server Actions/route handlers with server-side authz
      and boundary validation, then `revalidatePath`/`revalidateTag`.
- [ ] Data flows through `lib/services/<domain>/`, not inline queries.
- [ ] Dynamic/authenticated routes set `dynamic = "force-dynamic"`; cacheable
      public routes set `revalidate` with correct keys.
- [ ] `loading.tsx` and `error.tsx` exist for async boundaries; slow sections
      stream behind `<Suspense>`.
- [ ] Money stays in integer cents; no client-trusted payment/status values.
- [ ] Private portals remain `noindex`; `next.config.mjs` headers untouched/extended.
- [ ] `pnpm typecheck` and `pnpm lint` pass (compiling alone is **not** sufficient —
      see `autolenis-testing-quality-gates`).

## Cross-skill links

- `autolenis-accessibility-performance-seo` — metadata, JSON-LD, canonicals,
  Core Web Vitals, noindex policy for private portals.
- `autolenis-testing-quality-gates` — required tests and E2E paths for UI changes.
- `autolenis-auth-security-privacy` — role gating in `proxy.ts` and `lib/*-auth.ts`.
- `autolenis-observability-sre` — logging, cron/webhook handlers, error boundaries.
- `autolenis-system-architecture` / `autolenis-domain-model` — service layer,
  Prisma models, state machines.
- `autolenis-ui-design-system` (tokens + component kit) and `impeccable` (audit UI).
