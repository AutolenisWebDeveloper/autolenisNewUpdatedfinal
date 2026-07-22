# Social Engine & AMIPS — Full-Stack Audit, Redesign & Hardening Program

**Project:** AutoLenis (`autolenisNewUpdatedfinal`) · **Date:** 2026-07-22
**Branch:** `claude/autolenis-skill-stack-audit-123cfb`
**Scope:** Audit and elevate the **existing** Social Engine dashboard and AMIPS dashboard to
enterprise-grade quality across frontend, backend, database, security, performance, accessibility,
and UX — **preserving all business logic**. This is a **multi-PR program**; this document is the
audit + prioritized roadmap that sequences the implementation PRs.

> Method: direct code inspection of the dashboard pages/components, `lib/social/*`,
> `lib/services/acquisition/*`, `lib/services/dealer-recruitment/*`, `lib/amips/*`, the Prisma
> schema, and the prior remediation records (`SOCIAL_ENGINE_AUDIT.md`,
> `DEALER_ECOSYSTEM_AUDIT_2026-06.md`). No business rules changed.

---

## 0. Executive summary

Both systems are **functionally mature** — the backend was already hardened in prior passes
(double-publish race, auth-fail-open, IDOR, idempotency, attribution correctness all fixed). The
dominant remaining liabilities are **frontend architecture and enterprise UX quality**, led by a
single finding:

- **`app/admin/social/SocialDashboardClient.tsx` is a 4,685-line client component** holding **115
  `useState` hooks**, 19 `useEffect`, only 3 `useMemo`, 72 `.map()` renders, 12 tabs + 4 drawers/
  modals inline, and **zero imports from the shared design-system kit** (`components/ui/kit.ts` +
  `components/ui/patterns/*`). It is the biggest maintainability, performance, and consistency risk
  in either dashboard.

The repo already has the right primitives to fix this — a token-driven kit (`DataTable`, `KpiCard`,
`StatCard`, `PageHeader`, `Panel`, `EmptyState`, `Tabs`) that the dashboards bypass. The program is
therefore mostly **consolidation onto existing architecture**, not new construction.

---

## 1. Frontend audit

### 1.1 Social Engine dashboard (`app/admin/social/`)
| Finding | Severity | Detail |
| --- | --- | --- |
| **God component** | 🔴 High | `SocialDashboardClient.tsx` = 4,685 lines, 115 `useState`, 26 inline component defs. Unmaintainable; every tab's code ships even when one tab is viewed. |
| **No code-splitting** | 🔴 High | All 12 tabs + `ComposeDrawer` (770 lines), `BulkUploadModal`, `PostDrawer`, `AnalyticsTab` (500 lines) load eagerly → large initial JS on a route only admins use. `React.lazy` + `Suspense` per tab is the fix. |
| **Design-system bypass** | 🟠 Med | 0 imports of the shared kit; bespoke `StatCard`, badges, tables, empty states duplicate `components/ui/patterns/StatCard`, `KpiCard`, `DataTable`, `EmptyState`. Divergent spacing/typography vs the rest of admin. |
| **Under-memoized** | 🟠 Med | 3 `useMemo` against 115 `useState` + 72 `.map()`; derived lists recompute every render. Tab components re-render on unrelated state changes. |
| **No list virtualization** | 🟠 Med | Queue/Leads/Media/Analytics tables render full arrays; large result sets jank. |
| **Loading/empty/error states** | 🟡 Low | Present but ad-hoc per tab; should route through `EmptyState`/`Skeleton` primitives for consistency. |
| **Responsiveness** | 🟠 Med | Bespoke grids need validation at 320–1920px+; some toolbars/tab bars likely overflow on mobile. |
| **Accessibility** | 🟠 Med | Tab bar uses `onClick` divs/buttons without full `role="tablist"`/`aria-selected`/keyboard arrow nav; badge color-only status needs text/ARIA; focus states + contrast need a WCAG 2.2 AA pass. |

### 1.2 AMIPS dashboard (`app/admin/amips/`, `components/admin/amips/`)
| Finding | Severity | Detail |
| --- | --- | --- |
| Contained but bespoke | 🟠 Med | `ExecutiveIntelligenceDashboard.tsx` (598 lines) is intelligence-first and reasonable, but also largely bypasses the shared kit; align cards/tables/headers to `patterns/*`. |
| Server-rendered data | 🟢 Good | `loadExecutiveIntelligence()` runs server-side; figures computed from live data, "never estimated" — keep this contract. |
| Maps performance | 🟠 Med | Dealer maps need clustering + territory overlays validated for large marker counts; confirm no full re-render on filter. |
| Dealer-outreach console | 🟠 Med | `app/admin/dealer-outreach/page.tsx` (228 lines) + `[prospectId]` detail — align to kit; verify confidence/provenance visualization surfaces `emailSource`/`contactSource`/`contactConfidence`. |

### 1.3 Shared design system (reuse target)
`components/ui/kit.ts` re-exports `components/admin/crm/ui` (primitives: `DataTable`, `KpiCard`,
`EmptyState`, `Skeleton`, `PageHeader`, `Tabs`); `components/ui/patterns/*` holds the scaffold tier
(`PageContainer`, `PageHeader`, `StatCard`, `Panel`, `EmptyState`) + `tokens.ts`. **Rule (owner
ruling in `kit.ts`): import primitives from the kit, compositions from patterns — never a
per-dashboard copy.** The redesign is fundamentally "adopt this everywhere."

---

## 2. Backend audit

Both engines were substantially hardened already; residual items are incremental.

| Area | State | Action |
| --- | --- | --- |
| Social publish race / idempotency | 🟢 Fixed (`social-post.orchestrator.ts` atomic claim) | Preserve; add regression tests when refactoring callers. |
| Attribution correctness | 🟢 Fixed (require ≥1 post-identifying UTM; platform hint on sync) | Preserve. |
| Internal attribution auth | 🟢 Fixed (fail-closed, exact-equality) | Preserve. |
| Provider fetch timeouts | 🟠 Partial | Remaining single-shot provider calls (buffer/linkedin/tiktok/youtube/dalle) still need `AbortSignal.timeout` (SOCIAL_ENGINE_AUDIT follow-up). |
| Untrusted-text → LLM | 🟠 Open | Centralize sanitization of signal/Reddit/quality-feedback text before Groq prompts (one shared helper). |
| Public endpoint rate-limiting | 🟠 Open | `social-click` / `social-proof` need rate limits. |
| Admin action authz | 🟠 Open | Gate expensive/mutating `admin/social/*` behind `getAdminWithRole(OPERATIONAL_ROLES)`, not auth-only (partially done). |
| Dealer enrichment provenance | 🟢 Good | `email-enrichment.service.ts` tracks source/confidence; inferred≠verified. Preserve. |
| Apollo/YouTube/Places adapters | ⚪ Not built | Documented build-items behind typed adapters (`autolenis-integrations`). |

---

## 3. Database audit

| Finding | Severity | Detail / Action |
| --- | --- | --- |
| Index coverage | 🟠 Med | Verify hot dashboard queries are indexed: `SocialPost(status, scheduledAt)`, `SocialLead(status, createdAt, platform)` (present), `DealerProspect(status, zip, email)` (present). Add composite indexes where dashboard filters combine columns (e.g. `SocialPost(status, platform, scheduledAt)`). Confirm with `EXPLAIN` before adding. |
| N+1 risk | 🟠 Med | Audit tab data routes for per-row follow-up queries (leads→post, offers→dealer); prefer `include`/join or batched `in` queries. |
| Graceful-degrade pattern | 🟡 Note | Social page try/catches a missing `contentFranchise` table (manual migration may be unapplied). Good resilience, but track migration drift — the social tables should be in a tracked migration. |
| RLS | 🟠 Med | Confirm RLS policies exist/are correct for social + dealer-intel tables accessed by admin service-role vs. any client path; add RLS tests. |
| Migration discipline | 🟠 Med | Any new column (verification-status enum, review-queue view, `contactMethodType`) goes through a reviewed, reversible migration (`autolenis-supabase-postgres`); prefer extending tables over new parallel ones. |

**No migration is included in this audit PR.** DB changes ship in their own reviewed PR with
`EXPLAIN`-backed justification and rollback.

---

## 4. Security audit

Prior passes fixed the P0s (contract-upload IDOR, privilege-escalation on dealer mutation routes,
attribution fail-open, token-in-query-string). Residual review items:

- **Authorization consistency:** finish moving mutating `admin/social/*` + AMIPS mutation routes to
  `getAdminWithRole(OPERATIONAL_ROLES)`; read-only `SUPPORT_ADMIN` must not mutate.
- **Untrusted input to LLMs:** prompt-injection surface from social signals/comments and dealer
  research text — centralized sanitization + structured-output validation (`autolenis-ai-safety`).
- **Secret isolation:** provider tokens server-only; never in query strings or client bundles
  (kept: Meta token in header). Verify no `NEXT_PUBLIC_` leakage of provider secrets.
- **Public endpoints:** rate-limit `social-click`/`social-proof`; validate UTM inputs.
- **Dependency vulnerabilities:** GitHub flags 11 (3 high/6 mod/2 low) on default branch → triage
  in a dedicated dependency-review PR (`pnpm audit` + targeted bumps).
- **No security control weakened** by any change in this program.

---

## 5. Performance audit

| Lever | Where | Expected win |
| --- | --- | --- |
| Route-level code-splitting | Social dashboard tabs/drawers via `React.lazy` | Large ↓ initial JS on `/admin/social` |
| Memoization | Derived lists/filters in tabs (`useMemo`), stable callbacks (`useCallback`) | Fewer re-renders across 115-state tree |
| List virtualization | Queue/Leads/Media/Analytics tables | Smooth scroll on large sets |
| Query efficiency | Tab data routes: kill N+1, add composite indexes | ↓ API latency |
| Streaming/Suspense | Server shells stream tab data | Faster TTFB/perceived load |
| Image optimization | Media/compose thumbnails via `next/image` | ↓ bytes, better LCP |

Benchmark before/after each major optimization (bundle analyzer + route timings).

---

## 6. Accessibility audit (target WCAG 2.2 AA)
Tab navigation (`role="tablist"`, `aria-selected`, arrow-key nav), status badges (text/ARIA, not
color-only), focus-visible states, form labels/ARIA on compose/bulk modals, 44px touch targets,
contrast tokens, and `prefers-reduced-motion` for animations. Validate with axe + keyboard-only +
screen-reader spot checks.

---

## 7. UX audit
Information architecture is sound (tabbed console). Improvements: consistent `PageHeader` + toolbar
placement, clearer visual hierarchy via `StatCard`/`Panel`, discoverable primary actions (compose/
publish/approve), unified empty/loading/error states, and workflow efficiency (bulk actions,
saved filters, keyboard shortcuts). AMIPS: keep intelligence-first hierarchy; align cards to the kit;
strengthen confidence/provenance visualization on dealer profiles.

---

## 8. Prioritized roadmap (sequenced PRs)

1. **PR 1 — Audit + safe structural foundation (this PR):** this document + begin the Social
   dashboard decomposition safely (extract shared types/formatters/badges/constants into modules;
   establish the lazy-load pattern), behavior-preserving, verified by typecheck/lint/test.
2. **PR 2 — Social dashboard decomposition + kit adoption:** split all 12 tabs + drawers into
   `React.lazy` modules; replace bespoke StatCard/badges/tables/empty-states with kit/patterns;
   memoize derived data; virtualize long tables. Playwright + visual regression to prove no
   behavior/visual regressions.
3. **PR 3 — Social dashboard a11y + responsive pass:** WCAG 2.2 AA tab nav, focus, contrast, ARIA;
   validate 320–1920px+.
4. **PR 4 — AMIPS dashboard kit adoption + maps perf:** align cards/tables/headers; clustering/
   territory overlays; confidence/provenance visualization on dealer profiles.
5. **PR 5 — Backend reliability slice:** provider fetch timeouts, centralized LLM-input sanitization,
   public-endpoint rate limits, remaining authz consistency.
6. **PR 6 — DB performance:** `EXPLAIN`-backed composite indexes, N+1 elimination, RLS tests
   (reviewed migration + rollback).
7. **PR 7 — Dependency + security review:** triage the 11 Dependabot alerts; `/security-review` gate.

Each PR runs the full pipeline in `CLAUDE.md` (typecheck → lint → tests → Playwright/Impeccable for
UI → code review → security review → draft PR) and preserves all business logic.

---

## 9. Deliverables index (per the master directive)
1–9 audits → §1–7 above. 10 issues resolved / 11 components redesigned / 12 APIs / 13 DB / 14
security / 15 perf → tracked per PR in the roadmap (§8). 16 tests → each PR's validation section.
17 remaining tech debt → §2/§3/§4 open items + build-items (Apollo/YouTube/Places adapters). 18
files modified / 19 migrations → per-PR changelog. 20 draft PR → opened per PR.

**Guiding constraint:** preserve all existing AutoLenis architecture, workflows, and business logic;
extend the existing systems and the shared design system; never rebuild or duplicate.
