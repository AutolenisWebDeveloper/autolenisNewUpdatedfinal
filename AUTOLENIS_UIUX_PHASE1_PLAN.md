# AutoLenis — Phase 1 Plan: Design System Spec & Execution Backlog

**Repo:** `AutolenisWebDeveloper/autolenisNewUpdatedfinal` · branch `claude/fintech-platform-audit-redesign-razk04`
**Date:** 2026-07-05 · **Status:** awaiting approval — no implementation code until this plan is signed off.
**Input:** `AUTOLENIS_UIUX_PLATFORM_AUDIT.md` (Phase 0, approved). Finding IDs (C-*, H-*, M-*, Low) refer to that document's register.

---

## Part A — Shared Design System Spec ("AutoLenis UI")

**Principle:** promote the proven, token-driven CRM kit (`components/admin/crm/ui/` + its `tokens.ts` model) to the platform-wide system rather than inventing a new one. Light mode is the launch target; the token model keeps the CRM kit's dark capability so dark mode remains a flip, not a rebuild.

### A1. Token layer (single source of truth)
- One global CSS-variable layer at `:root` in `app/globals.css`, exposed to Tailwind v4 via `@theme`. The CRM `.crm-root` scoping is lifted to global; the shadcn HSL block and the dead `.dark` block are removed; `tailwind.config.ts` v3 remnants deleted (v4 `@theme` is canonical). `components.json` corrected or removed.
- **Color roles** (semantic, never raw hex in feature code):
  - `--color-primary` `#0B5FD1` (+ `-hover #0A4DB8`, `-subtle`, `-fg`)
  - `--color-success #15803D` · `--color-warning #B45309` · `--color-danger #B91C1C` · `--color-info` (each + `-subtle` bg + `-fg`) — resolves the three-greens drift (`#50D14E`/`#4CAF50`/`#15803D` → one success role)
  - Neutrals: `--color-bg`, `--color-surface`, `--color-surface-raised`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-text-subtle` (slate-derived ramp; all text roles ≥4.5:1 on their surfaces)
  - Trust accent `#643293` retained as `--color-accent` (CRM already uses it)
- **Radius:** `--radius-sm 6px`, `--radius-md 8px`, `--radius-lg 12px`. One card radius platform-wide: `--radius-lg` (ends the rounded-lg/xl/2xl split).
- **Elevation:** 3 shadow tokens (`--shadow-1` card, `--shadow-2` popover/dropdown, `--shadow-3` modal). No ad-hoc shadows.
- **Spacing:** Tailwind 4px scale only — no arbitrary `p-[10px]`-style values. Standard card padding 16/24; page gutter 24 (mobile) / 32 (desktop); section gap 24.
- `design_guidelines.json` (unbuilt dark spec) is archived to `docs/archive/` and superseded by this spec. **[Default decision #5 — flag if a rebrand toward that spec is actually planned]**

### A2. Typography
- **Three families, one dropped:** Space Grotesk = display/headings; **Inter = body & data UI** (better at dense 12–14px data than Space Grotesk); JetBrains Mono = numerals/code/IDs in tables where alignment matters. **Plus Jakarta Sans is removed.** **[Default decision #6 — dealer surfaces adopt the shared system; say if the dealer sub-brand is deliberate]**
- **Scale (rem/line-height):** 12/16 caption · 14/20 body-sm (dense tables) · 16/24 body · 18/28 lead · 20/28 h4 · 24/32 h3 · 30/36 h2 · 36/40 h1. Weights 400/500/600/700.
- **Floor:** 12px minimum for any readable text. The 9–10px `text-[9px]/[10px]` usages (admin sidebar, dense screens) are migrated to 12px caption with tracking, not kept.

### A3. Component inventory
**Promoted from CRM kit (generalized, moved to `components/ui/`):** Button, Badge/StatusPill, DataTable (sorting + `aria-sort`, sticky header, zebra option, empty/loading rows, pagination slot), Tabs, KpiCard, PageHeader, EmptyState, Skeleton, SlideOver, Toolbar.
**Repaired in place:** existing 8 primitives re-tokenized (purple `hover:#3A0061` bug removed, hardcoded hex → tokens, real `asChild`).
**New (Radix primitives under the hood for a11y):** Dialog (focus trap, `aria-modal`, ESC, scroll lock), DropdownMenu, Tooltip, Checkbox, Radio, Switch, Pagination, Toast (thin wrapper standardizing sonner), FormField/FormError (react-hook-form + zodResolver), DashboardShell (skip link, `<header>`/`<nav>`/`<main>` landmarks, config-driven sidebar with role/journey-aware item visibility, mobile drawer).
**Shared utilities:** `lib/format.ts` — `formatCurrency` (cents-in), `formatNumber`, `formatDate`, `formatRelative`; single source replacing ~8 formatters + inline call sites.

### A4. Interaction & state standards (every view, enforced in Phase 3 checklists)
- **Five states wired with real data paths:** loading = Skeleton matching final layout; empty = EmptyState with icon + one-line explanation + primary action; error = inline retry + correlation/digest id (never a silent empty — closes M-18); partial = per-section fallback when one query fails (buyer dashboard pattern generalized); success.
- **Feedback:** all mutations confirm via sonner toast or inline status; no `alert()`; destructive actions require Dialog confirmation.
- **Motion:** 150–200ms ease-out for enter/hover only; everything behind `prefers-reduced-motion`; no decorative animation.

### A5. Accessibility (WCAG 2.2 AA)
`focus-visible` rings on all interactive elements (sweep 567 `focus:ring` call sites); keyboard-complete modals/menus (Radix); `aria-label` on every icon-only button; status never conveyed by color/dot alone (dot + text label); landmarks + skip link in DashboardShell; forms with `<label htmlFor>`, `aria-invalid`, `aria-describedby` error binding via FormField; 4.5:1 contrast verified per token pair at spec time.

### A6. Breakpoints & density
`sm 640 · md 768 · lg 1024 · xl 1280`. Dashboards optimize for lg/xl (data-dense: KPI rows, 8-column tables); every table gets a defined `<md` behavior — priority-column collapse or card list, not bare horizontal scroll. Sidebars: drawer `<lg`.

---

## Part B — Execution Backlog (sequenced, commit-boundary per item)

Effort: S <1d · M = days · L = 1–2 wks. Every wave ends with the verification loop (build + typecheck + lint + tests green vs the 76-test baseline, visual QA of states, a11y spot-check, cross-role access check) and pauses for your approval.

### Wave 0 — Behavior-restoring hotfixes (needs explicit approval: alters behavior from "broken" to "as documented")
| # | Fix | Finding | Effort |
|---|-----|---------|--------|
| 0.1 | Dealer quick-offer reads `data.data.auction` (restore bid entry) | C-1 | S |
| 0.2 | Dealer messages thread reads `data.data.messages`/`.message` (restore messaging) | C-2 | S |
| 0.3 | Buyer insurance: align vehicle resolution (`desc` on both sides) | H-1 | S |
| 0.4 | Buyer search: catch + error state + retry | H-3 | S |
| 0.5 | Affiliate payout CTA: honest disabled state ("Payouts open soon") while rail is disabled **[default decision #4: hide, don't build processor now]** | H-4 | S |
| 0.6 | Affiliate Total Earned: exclude REVERSED+PENDING (align with level rows & leaderboard) | H-5 | S |

### Phase 2 — Foundation (each item = one PR-sized commit)
| # | Item | Closes | Effort |
|---|------|--------|--------|
| 2.1 | Token layer: global CSS vars + `@theme`; delete HSL/.dark/v3 config remnants; archive design_guidelines.json | H-7 (root) | M |
| 2.2 | `lib/format.ts` + codemod the 8 formatters & inline call sites | H-7 | M |
| 2.3 | Repair 8 existing primitives (tokens, purple bug, asChild) | Foundation §4 | S |
| 2.4 | Promote CRM kit → `components/ui` (generalize, keep CRM pages working) | H-13 | L |
| 2.5 | New Radix primitives: Dialog first, then DropdownMenu/Tooltip/Checkbox/Radio/Switch/Pagination | H-8 | L |
| 2.6 | Form stack (RHF + zodResolver + FormField/FormError) | Foundation | M |
| 2.7 | Toast standardization on sonner; remove ad-hoc useState toasts | Foundation | S–M |
| 2.8 | DashboardShell + config-driven sidebar; add `app/affiliate/layout.tsx`; skip link + landmarks | Foundation §3, M-21 partial | L |
| 2.9 | Global a11y sweep: focus-visible, reduced-motion guard | M-23 | M |

### Phase 3 — Per-dashboard redesign & hardening (complete + verify one before the next)
**Order: Dealer → Affiliate → Buyer → Admin** (smallest core-flow debt first; proves the shell; admin last because largest).

**3A Dealer:** adopt shell/tokens/primitives; single shared API client (envelope unwrap + `.error.message`) killing the three conventions (M-7); consolidate the two bid forms into quick-offer, delete fake competitiveness gauge & free-text auction ID (M-6); remove duplicate `/dealer/signin`; keyboard-accessible password toggle; dot+label statuses; messages polling or refresh affordance; remove debug logging; migrate 233 hex.
**3B Affiliate:** shell + loading.tsx everywhere (M-17); error-vs-empty separation (M-18); unify banking models — Finance Hub becomes canonical, onboarding reads/writes the same model **(H-6 — schema/contract change, called out explicitly for approval)**; document signed-URL downloads (M-20); compliance ack records disclosure checklist (M-19); fix 2%→3% copy; un-nest buttons; leaderboard → SQL aggregate + limit (H-12); N+1 fixes (network tree).
**3C Buyer:** shell + tokens; offer-selection early-accept flow w/ disclosure Dialog (H-2 — **behavior addition, flagged**); shared `computeJourney()` (M-3); journey-aware sidebar gating (M-4); accessible VehicleGallery lightbox via Dialog (M-5); EmptyState adoption; remove dead `auction/` tree; replace `alert()`; `next/image` migration; API auth helper adds suspended/verified checks (M-1 — **hardening, flagged**); guard Contract Shield mock-PASS route behind env/admin (M-2 — **flagged**); split 1,497-line request form.
**3D Admin:** shell + tokens + DataTable/KpiCard/PageHeader adoption across sections; split SocialDashboardClient + command centers into shared tabbed-detail scaffolding (H-14); section `error.tsx` + `not-found.tsx` (M-16); nav restructure (dedupe Affiliates ×3, funnel entries, orphaned `/admin/operations`; role-driven visibility) (M-21); mobile table behavior (M-22); aria-label sweep; `next/dynamic` for recharts; self-host leaflet markers.

### Phase 4 — Optimization & automation (cross-cutting)
Code-splitting sweep (M-13) · cache strategy: audit 215 `force-dynamic` pages, ISR for public/SEO tree (M-14) · unbounded `findMany` sweep — add `take`/pagination (M-11) · N+1 batch fixes incl. bulk-send suppression checks (M-12) · dead-code removal: CRA scaffold, `.eslintrc.json`, duplicate routes, unused deps, 82 lint warnings → 0 (Lows) · env validation module w/ boot-time fail-fast (M-15) · error monitoring (Sentry) (H-9) · rate limiting (Upstash, already a dep) on auth + payment endpoints (H-10) · proxy.ts: fix dead guard blocks + auth-route header on request headers (M-8, M-9) · Stripe webhook side-effect idempotency hardening (M-10) · **admin RBAC extension (H-11) [decision #7 — requires your role-matrix sign-off; scheduled here, gated separately]**.

### Phase 5 — Launch readiness
Full verification loop; WCAG 2.2 AA spot-audit per dashboard; cross-role access re-check (buyer/dealer/affiliate/admin token against each other's routes); Lighthouse/bundle before-after; Definition-of-Done checklist against the brief; final report.

---

## Default decisions embedded in this plan (approve or override)
1. **Inventory** — four dashboards as audited; `(public)` out of scope. *(Assumed confirmed by Phase 0 approval.)*
2. **Wave 0 hotfixes** — proceed first, one commit each.
3. **Buyer Premium self-upgrade** — left as-is (treated as intentional); no change planned.
4. **Affiliate payouts** — honest disabled CTA now; payout processor build stays out of scope.
5. **`design_guidelines.json`** — archived; current light/blue system canonized.
6. **Fonts** — drop Plus Jakarta Sans; Inter becomes body/data face; dealer sub-brand dissolved into shared system.
7. **Admin RBAC** — in scope, Phase 4, gated on a role matrix I'll draft for your sign-off before enforcement changes.

**Approval requested:** Part A spec, Part B sequencing, Wave 0 go-ahead, and the seven defaults above.
