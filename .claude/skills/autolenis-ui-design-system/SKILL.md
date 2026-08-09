---
name: autolenis-ui-design-system
description: >-
  The AutoLenis visual source of truth — the `--al-*` token layer in
  app/globals.css, the promoted `components/admin/crm/ui/` component kit, the
  landing-page tokens in lib/design/tokens.ts, and the resolution order that
  settles which of the repo's three competing design artifacts wins. Use this
  skill for any visual work: colors, typography, spacing, radius, shadow,
  buttons, cards, tables, dashboards, drawers, dialogs, badges, empty/loading/
  error states, or focus rings; when touching app/globals.css,
  tailwind.config.ts, components.json, components/ui/**,
  components/admin/crm/ui/**, or lib/design/tokens.ts; or when a task mentions
  brand color, design token, design system, theme, dark mode, or "make it look
  premium".
---

## Purpose & Authority

This skill exists because AutoLenis has **three design artifacts that disagree**,
and picking the wrong one produces a visually broken portal. It fixes the
resolution order and points every visual change at the implemented token layer.

It is the *what* of AutoLenis visual language. The `impeccable` skill is the
*how well* — the quality reviewer. Use both: this skill for the tokens and
components, `impeccable` for the craft audit.

## Source-of-truth hierarchy — read this before picking a color

| Rank | Artifact | Status | Use it for |
| --- | --- | --- | --- |
| 1 | **`frontend/app/globals.css` `@theme` block** | **Implemented, canonical** | Every new surface. `--color-al-*`, `--font-display/body`, the shadcn HSL set, the 53 `--crm-*` vars. |
| 2 | **`docs/design-system/AUTOLENIS_UI_SPEC.md`** | Approved spec, partially implemented | Role semantics, contrast ratios, the consolidation table. It is the *intent* behind the `--al-*` values. |
| 3 | **`frontend/lib/design/tokens.ts`** | Implemented, **scope-limited** | Landing-page v2 `(public)` surfaces only — `COLORS`, `RADIUS`, `SPACE`, `SHADOWS`, `TYPOGRAPHY`, `CTA`. |
| — | **`design_guidelines.json`** (repo root) | ⚠️ **Stale — do not follow** | Nothing. It specifies a *dark* `#05030A` / `#4B0082` theme that contradicts the shipped light system and is not implemented anywhere. |

**If those conflict, rank 1 wins.** Do not "restore" the dark guidelines file's
palette; the UI spec states explicitly that **no dark theme ships at launch**
(dark-capability is retained in the token model only, under
`.crm-root[data-theme="dark"]`).

## When this skill activates

- `frontend/app/globals.css`, `tailwind.config.ts`, `components.json`,
  `postcss.config.mjs`.
- `frontend/components/ui/**` (11 shadcn primitives),
  `frontend/components/admin/crm/ui/**` (the promoted kit),
  `frontend/lib/design/tokens.ts`.
- Any new page or component in `app/buyer`, `app/dealer`, `app/affiliate`,
  `app/admin`, or `(public)`.
- Keywords: token, palette, brand color, hex, spacing scale, radius, shadow,
  typography, focus ring, dark mode, theme, design system, component kit.

## Architecture & key files

**Token layer.** Tailwind v4 `@theme` in `app/globals.css`. Three coexisting
families, by design:

- `--color-al-*` — the AutoLenis role tokens (Phase 2, **additive**: adding them
  changed nothing visually until components opt in). Exposed both as utilities
  (`bg-al-primary`, `text-al-danger`, `rounded-al-lg`, `shadow-al-1`) and as
  CSS vars (`var(--color-al-primary)`).
- `--crm-*` — 53 vars defining the CRM kit, lifted to `:root` so any dashboard
  can consume them.
- shadcn HSL set (`--color-primary`, `--color-border`, …) — the primitive layer
  under `components/ui/`.

**Canonical role values** (`AUTOLENIS_UI_SPEC.md` §1.1, live in `globals.css`):
primary `#0B5FD1` / hover `#0A4DB8` / subtle `#EFF6FF`; success `#15803D`;
warning `#B45309`; danger `#B91C1C`; info `#0369A1`; accent `#643293`;
bg `#F8FAFC`; surface `#FFFFFF`; border `#E2E8F0` / strong `#CBD5E1`;
text `#0F172A` / muted `#475569` / subtle `#64748B`; focus = primary,
2px ring + 2px offset, `focus-visible` only.

**Component kit — the standing directive is *promote, don't create*.**
`components/admin/crm/ui/` is the platform kit: `Button`, `Badge`, `DataTable`,
`KpiCard`, `PageHeader`, `Toolbar`, `Tabs`, `SlideOver`, `ConfirmDialog`,
`EmptyState`, `ErrorState`, `Skeleton` (+ `tokens.ts`, `index.ts`). A net-new
component system requires owner sign-off.

**Fonts.** `next/font/local` in the root layout injects `--font-jakarta`
(display) and `--font-inter` (body); consume via `font-display` / `font-body`.

## Core rules & invariants

1. **No raw hex in components.** Use an `--al-*` utility/var, a `--crm-*` var, or
   — on `(public)` landing surfaces only — `lib/design/tokens.ts`. A literal
   `#0B5FD1` in a new component is a defect: it is invisible to the
   consolidation table and to any future theme swap.
2. **One green, one blue, one red.** The spec exists to kill the drift it
   documents (`#50D14E`/`#4CAF50`/`#15803D` → `--al-success`; `#3A0061` →
   `--al-primary-hover`; `#F8F9FA`/`#F8F9FB` → `--al-bg`). Do not reintroduce a
   near-duplicate shade.
3. **Reach for the CRM kit first.** Before writing a table, drawer, KPI tile,
   empty state, or confirm dialog, check `components/admin/crm/ui/`. Extend it;
   do not fork it per portal.
4. **`lib/design/tokens.ts` stays on `(public)`.** Do not import it into
   buyer/dealer/admin/affiliate surfaces — that reintroduces the split system.
5. **Token additions are additive.** New `--al-*` names only; never repurpose an
   existing token's meaning, which would silently restyle every consumer.
6. **Focus is never removed.** `focus-visible` ring at 2px + 2px offset, ≥3:1
   against adjacent color. `outline: none` without a replacement ring is a
   WCAG failure — see `autolenis-accessibility-performance-seo`.
7. **Contrast is a stated value, not a vibe.** The spec table carries the ratio
   for each role; `--al-text-subtle` (4.8:1) is permitted at ≥12px only.
8. **Four portals, one language.** Buyer, dealer, affiliate, and admin share the
   token layer and the kit. Portal identity comes from content and density, not
   from a different palette.
9. **No dark theme at launch.** Keep values swappable under
   `[data-theme="dark"]`; do not ship a dark surface because a stale artifact
   describes one.
10. **Money and status get semantic color.** Money-in/positive →
    `--al-success`; money-out/destructive → `--al-danger`; pending →
    `--al-warning`. Never encode status by color alone — pair with text or an
    icon.

## Workflows

**Build a new dashboard surface**
1. Check `components/admin/crm/ui/index.ts` for an existing component.
2. Compose with `--al-*` utilities; `font-display` for headings, `font-body` for
   copy.
3. Provide all four states: loading (`Skeleton`), empty (`EmptyState`), error
   (`ErrorState`), populated.
4. Verify focus-visible rings and contrast.
5. Run the `impeccable` audit, then `pnpm test:visual` if a public page changed.

**Add a token**
1. Confirm no existing role covers it (check the spec's role table first).
2. Add `--color-al-<role>` to the `@theme` block with a contrast note.
3. Record it in `AUTOLENIS_UI_SPEC.md` §1.1 so the spec stays the intent record.
4. Never delete or redefine an existing token in the same change.

**Reconcile a design request against the stale guidelines file**
State plainly that `design_guidelines.json` describes an unimplemented dark
theme superseded by `AUTOLENIS_UI_SPEC.md`, and implement against rank 1. If the
owner genuinely wants the dark direction, that is a design decision requiring
sign-off and a spec update — not a per-component deviation.

## Boundaries — do / never

**Do**
- Consume tokens; extend the CRM kit; keep additions additive.
- Give every surface loading/empty/error states.
- Keep contrast and focus rings verifiable against the spec table.
- Keep `lib/design/tokens.ts` scoped to `(public)`.

**Never**
- Hardcode a hex, spacing value, or shadow in a component.
- Fork the component kit per portal or introduce a second UI library.
- Restyle by redefining an existing token.
- Follow `design_guidelines.json`.
- Ship a dark surface, or strip a focus outline.

## Acceptance criteria

- [ ] No new raw hex/px-shadow literals in components.
- [ ] Reused a `components/admin/crm/ui/` primitive where one existed.
- [ ] Loading, empty, and error states present.
- [ ] `focus-visible` ring present; contrast meets the role's stated ratio.
- [ ] Any new token is additive and recorded in `AUTOLENIS_UI_SPEC.md`.
- [ ] `lib/design/tokens.ts` not imported outside `(public)`.
- [ ] `impeccable` audit run for UI work; `pnpm test:visual` for public pages.

## Cross-skill links

- `impeccable` — the UI/UX quality reviewer; run it after implementing.
- `autolenis-accessibility-performance-seo` — WCAG 2.2 AA, focus, contrast, CWV.
- `autolenis-nextjs-react` — Server vs Client boundaries for these components.
- `autolenis-buyer-journey` / `autolenis-dealer-marketplace` — portal surfaces.
- `autolenis-testing-quality-gates` — Playwright visual regression.
