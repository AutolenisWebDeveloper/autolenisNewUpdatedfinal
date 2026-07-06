# AutoLenis UI — Design System Specification (Phase 2 gate artifact)

**Status:** DRAFT for owner approval. No implementation until the Phase 2 gate passes.
**Standing directive:** promote `components/admin/crm/ui/` platform-wide; no net-new component system. Deviations require owner sign-off.
**Scope:** the four dashboards (admin, buyer, dealer, affiliate). Marketing `(public)` is a frozen token-consumer (§7).

---

## 1. Token layer

One global CSS-variable layer at `:root` in `app/globals.css`, exposed to Tailwind v4 via `@theme`. The CRM kit's hex-var model (`--crm-*`) is lifted out of `.crm-root` scope and renamed `--al-*`; the shadcn HSL block, the dead `.dark` block, and the v3 `tailwind.config.ts` remnants are deleted. `components.json` corrected. Dark-mode capability is retained in the token model (values swap under `[data-theme="dark"]`) but no dark theme ships at launch.

### 1.1 Color roles (exact launch values)

| Token | Value | Role | Contrast basis |
|---|---|---|---|
| `--al-primary` | `#0B5FD1` | Brand actions, links, active nav | 5.2:1 on white (AA) |
| `--al-primary-hover` | `#0A4DB8` | Hover/pressed | — |
| `--al-primary-subtle` | `#EFF6FF` | Selected/tinted backgrounds | with `--al-primary` text |
| `--al-primary-fg` | `#FFFFFF` | Text on primary | 5.2:1 |
| `--al-success` | `#15803D` | Positive status, money-in | 4.54:1 on white |
| `--al-success-subtle` / `-fg` | `#F0FDF4` / `#065F46` | Chips/banners | 7.5:1 |
| `--al-warning` | `#B45309` | Pending/attention | 4.52:1 |
| `--al-warning-subtle` / `-fg` | `#FFFBEB` / `#92400E` | Chips/banners | 7.1:1 |
| `--al-danger` | `#B91C1C` | Destructive, errors, money-out | 5.9:1 |
| `--al-danger-subtle` / `-fg` | `#FEF2F2` / `#991B1B` | Chips/banners | 6.6:1 |
| `--al-info` | `#0369A1` | Neutral-informational | 5.0:1 |
| `--al-accent` | `#643293` | Trust/verification accents (CRM heritage) | 8.0:1 |
| `--al-bg` | `#F8FAFC` | App background | — |
| `--al-surface` | `#FFFFFF` | Cards, tables, panels | — |
| `--al-surface-raised` | `#FFFFFF` + `--al-shadow-2` | Popovers, menus | — |
| `--al-border` | `#E2E8F0` | Default border | — |
| `--al-border-strong` | `#CBD5E1` | Inputs, emphasis | — |
| `--al-text` | `#0F172A` | Primary text | 17.8:1 |
| `--al-text-muted` | `#475569` | Secondary text | 7.5:1 |
| `--al-text-subtle` | `#64748B` | Captions, meta (≥12px only) | 4.8:1 |
| `--al-focus` | `#0B5FD1` @ 2px ring, 2px offset | `focus-visible` only | 3:1 vs adjacent |

**Consolidations this table enforces:** the three greens (`#50D14E`, `#4CAF50`, `#15803D`) → `--al-success`; the stray purple button hover (`#3A0061`) → `--al-primary-hover`; the two page backgrounds (`#F8F9FA`/`#F8F9FB`) → `--al-bg`; slate-borrowed grays (`#111827`, `#6B7280`, `#94A3B8`, `#4B5563`) → the three text roles.

### 1.2 Radius, elevation, spacing, breakpoints
- Radius: `--al-radius-sm 6px` (inputs, chips) · `--al-radius-md 8px` (buttons, menus) · `--al-radius-lg 12px` (cards, modals — the ONE card radius; ends the lg/xl/2xl split).
- Elevation: `--al-shadow-1` card `0 1px 2px rgb(15 23 42 / .06)` · `--al-shadow-2` popover `0 4px 12px rgb(15 23 42 / .10)` · `--al-shadow-3` modal `0 12px 32px rgb(15 23 42 / .18)`. No ad-hoc shadows.
- Spacing: Tailwind 4px scale only; card padding 16 (mobile)/24; page gutter 24/32; section gap 24. Arbitrary bracket values (`p-[10px]`, `text-[9px]`) are lint-banned after migration (§6.4).
- Breakpoints: `sm 640 · md 768 · lg 1024 · xl 1280`. Dashboards optimize lg/xl; every table defines a `<md` behavior (priority-column collapse or card list — never bare horizontal scroll); sidebars become drawers `<lg`.

### 1.3 Typography — one type system (Decision #6)
- **Inter** — all UI text (headings included). **JetBrains Mono** — numerals/IDs/amounts in dense tables (`font-feature-settings: "tnum"` where mono is overkill). Space Grotesk and Plus Jakarta Sans removed from the payload. Dealer distinction, if wanted later, is a token theme, not a font.
- Scale (size/line-height, rem): `caption 12/16 · body-sm 14/20 · body 16/24 · lead 18/28 · h4 20/28 · h3 24/32 · h2 30/36 · h1 36/40`. Weights 400/500/600/700. **12px floor** — the 9–10px usages migrate to caption.
- Numbers in KPIs and tables use tabular numerals.

## 2. Component inventory

**Promoted from the CRM kit → `components/ui/`** (generalized: `--crm-*` → `--al-*`, CRM pages keep working via re-exports during migration): Button, Badge + StatusPill, DataTable (sorting + `aria-sort`, sticky header, empty/loading/error rows, pagination slot), Tabs, KpiCard, PageHeader, EmptyState, Skeleton, SlideOver, Toolbar.
**Repaired in place (visual-equivalent re-tokenization):** the 8 existing primitives (badge, button, card, input, label, select, separator, textarea). The purple-hover defect fix is its own commit (it IS a visible change).
**New, Radix-primitive-based** (a11y correctness is not hand-rollable at this scale): Dialog (focus trap, `aria-modal`, ESC, scroll lock), DropdownMenu, Tooltip, Checkbox, Radio, Switch, Pagination, Toast (thin sonner wrapper: `toast.success/error/info`, one visual style), FormField/FormError (react-hook-form + zodResolver; label/`aria-invalid`/`aria-describedby` wiring).
**Shell:** DashboardShell — skip link, `<header>/<nav>/<main>` landmarks, config-driven sidebar (items declare `roles`, `journeyStage`, badge source), mobile drawer, one active-state treatment. Replaces the four bespoke sidebars; adds the missing affiliate layout.
**Utilities:** `lib/format.ts` — `formatCurrency(cents)`, `formatNumber`, `formatDate`, `formatRelative`. Replaces the 8 conflicting formatters and 328 inline call sites.

## 3. State standards (enforced per view in Phase 3 checklists)
Loading = Skeleton matching final layout (no spinners-in-a-void) · Empty = EmptyState with icon, one-line explanation, primary action · Error = inline alert + retry + correlation/digest id; **never silently rendered as empty** · Partial = per-section fallback when one of several queries fails · Success. Mutations confirm via Toast or inline status; no `alert()`; destructive actions confirm via Dialog.

## 4. Interaction & motion
150–200ms ease-out on enter/hover only; all motion behind `prefers-reduced-motion`; no decorative/looping animation; focus ring via `focus-visible` exclusively (the 567 `focus:ring` call sites migrate).

## 5. Accessibility (WCAG 2.2 AA)
Landmarks + skip link in the shell · keyboard-complete overlays (Radix) · `aria-label` on every icon-only button · status = color **and** text, never a dot alone · forms: label association, `aria-invalid`, `aria-describedby` via FormField · 4.5:1 minimum for text (token pairs pre-verified in §1.1) · target size ≥24px (2.2) · `aria-sort` on sortable tables.

---

## 6. HEX-MIGRATION STRATEGY (~3,100 occurrences across 725 files)

**Phase A — additive tokens (zero visual change).** Land the `--al-*` layer alongside everything existing. Nothing consumes it yet; old hex keeps rendering. *Rollback: revert one commit; no consumer exists.*

**Phase B — exact-value codemod, primitives first.** Re-tokenize the 8 shared primitives + promoted kit with tokens whose values EQUAL the current rendered values (`#0B5FD1` → `var(--al-primary)` etc.) — visually equivalent by construction, verified by the visual-regression baseline (§7). *Rollback unit: one commit per component.*

**Phase C — per-dashboard sweeps (the bulk).** Scripted codemod over one dashboard segment at a time, mapping the known literal set (`#0B5FD1`, `#0A4DB8`, `#111827`, `#6B7280`, `#94A3B8`, `#F8F9FA/B`, greens, ambers, reds → roles). Anything not in the map is left in place and listed in the commit body for manual review — no blind rewrites. Order matches Phase 3: dealer → affiliate → buyer → admin, one **section** per commit for admin (52 sections; a dashboard-sized commit is not reviewable). *Rollback unit: one commit = one dashboard (or one admin section); `git revert` restores prior rendering exactly because Phase A/B never changed values.*

**Phase D — ratchet.** ESLint rule (no raw hex in `className`/`style` under `app/`+`components/`, allowlist for the token file) + CI grep-count budget that only goes down. Prevents regression without blocking unrelated work.

**Consolidation deltas** (the ~30 literals that do NOT map 1:1 to their current value — e.g. `#50D14E` green → `--al-success #15803D`, 9px text → 12px) ship as their own labeled commits per dashboard, AFTER the equivalent-value sweep, so every intentional visual change is isolated, screenshot-diffed, and individually revertable.

## 7. Marketing visual-regression guardrail (supersedes "equivalent by construction")

Per owner correction: a **captured Playwright screenshot baseline** of the marketing pages that import the 8 shared primitives (verified import set: button ×8 files, input/select/label ×3, textarea ×2 — homepage, refinance flow, SEO landing template, contact/lead forms), plus one page per dashboard. Baseline captured BEFORE Phase A at `sm/lg` widths; `pnpm test:visual` diffs against it in every Phase 2/3 verification loop (threshold 0.1% pixels; diffs fail the gate). Marketing diffs = hard stop; dashboard diffs = expected only in labeled consolidation-delta commits. Chromium is preinstalled in CI-compatible form; baseline PNGs live in `tests/visual/__baseline__/`.

---

## 8. Open items at this gate
1. Approve the exact token values (§1.1) — especially `--al-success #15803D` replacing the two brighter greens on marketing-adjacent CTAs.
2. Approve the one-type-system reading of Decision #6 (Inter everywhere incl. headings; Space Grotesk removed).
3. Approve Radix as the primitive base for the new a11y components (adds a dependency; the alternative — hand-rolled focus management across 46 modal call sites — is how the current gaps happened).
