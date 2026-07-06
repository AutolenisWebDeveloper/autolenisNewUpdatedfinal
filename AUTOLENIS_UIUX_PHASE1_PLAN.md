# AutoLenis — Phase 1 Plan v2: Design System Spec & Execution Backlog

**Repo:** `AutolenisWebDeveloper/autolenisNewUpdatedfinal` · branch `claude/fintech-platform-audit-redesign-razk04`
**Date:** 2026-07-06 · **Status:** v2 — revised per owner directives; awaiting approval at the Phase 1 gate. No Phase 0.5/2+ implementation until sign-off.
**Supersedes:** Phase 1 plan v1 (merged in PR #282). Changes in v2: adds the **Phase 0.5 Launch-Blocker Hardening track**, the **RBAC workstream**, the **marketing token-consumer guardrail**, updated decisions, and the shipped-hotfix record.
**Input:** `AUTOLENIS_UIUX_PLATFORM_AUDIT.md` (Phase 0, merged). Finding IDs (C-*, H-*, M-*) refer to its register.

---

## STANDING DIRECTIVES (owner-issued, binding)

1. **Phase 2 promotes `components/admin/crm/ui/` platform-wide. No net-new component system.** Any deviation requires owner sign-off.
2. **Marketing (`(public)`) is out of redesign scope but is a token-consumer.** Verified shared imports from marketing into redesign targets: `components/ui/button` (8 files), `input`/`select`/`label` (3 each), `textarea` (2), plus `ChatWidget`. **Guardrail:** during token migration these primitives must be re-tokenized visually-equivalent by construction (tokens resolve to the exact current computed values); marketing visuals are frozen — every Phase 2 verification loop includes a marketing spot-check (`/`, one SEO landing page, one form page). No marketing-visible change ships without explicit approval.
3. Every phase gate pauses for owner approval; every wave verifies against the green baseline (typecheck clean · lint 0 errors · 76/76 tests).

---

## HOTFIX WAVE — SHIPPED (this branch, 7 isolated commits)

| # | Commit | Fix | Finding |
|---|--------|-----|---------|
| 1 | `6f77007` | Dealer quick-offer reads payload at correct envelope depth — bid entry restored | C-1 |
| 2 | `f437542` | Dealer messages thread reads correct depth — threads render, send appends | C-2 |
| 3 | `82ffd86` | Insurance quote resolves the same vehicle the page displays (`desc` both sides) | H-1 |
| 4 | `24cb896` | Buyer search error state + retry; offer-selection surfaces real API message (incl. AUCTION_LIVE) | H-3 / H-2 (partial) |
| 5 | `1daa2cc` | Total Earned excludes REVERSED, reconciles to level rows/leaderboard; pending stays separate; digest aligned | H-5 |
| 6 | `6070402` | Payout CTA removed; balance visible; "Payouts opening soon"; readiness steps listed | H-4 |
| 7 | `6dc989f` | Premium upgrade: race-safe idempotency + AuditLog/BuyerActivityEvent (no charge behavior change) | Decision #3 |

Each verified individually against the baseline. Note: the full early-accept (`forceEarly`) confirmation flow for H-2 remains in Phase 3C — the hotfix makes the failure honest, not the flow complete. Premium-endpoint durable rate limiting lands with the Phase 0.5 limiter.

---

## PHASE 0.5 — LAUNCH-BLOCKER HARDENING (new track, parallel to redesign, same gating)

Runs alongside Phases 2–3 as its own commit series; each item independently verifiable.

| # | Item | Detail | Effort |
|---|------|--------|--------|
| 0.5-1 | **Durable rate limiting** on sign-in (buyer/dealer/affiliate/admin) **and payment-intent creation** | Upstash-backed sliding window (`@upstash/qstash` already a dep; add `@upstash/ratelimit` + Redis, or DB-backed fallback — final choice in the 0.5 design note). Per-IP + per-identifier keys; fail-open on limiter outage with alert, fail-closed on payment-intent abuse thresholds. Payment-intent limiting is Critical-adjacent (card-testing → Stripe account risk) and ships first. Retrofit onto `plan/upgrade` and password-reset. Replaces the in-memory Map on public AI chat. | M |
| 0.5-2 | **Stripe webhook idempotency + atomic side-effects** | Wrap deposit-update → auction-create in `$transaction`; per-side-effect processed markers on `PaymentProviderEvent` metadata so retries resume, not re-run; keep the existing atomic event-claim. No contract change to Stripe. (M-10) | M |
| 0.5-3 | **Error monitoring** | Sentry (`@sentry/nextjs`): server + edge + client, release tagging, `logger.error` bridge, alert rules for webhook/payment paths. Requires `SENTRY_DSN` env from you. (H-9) | M |

Gate: all three verified (limiter exercised, webhook replay tested, Sentry event visible) before launch sign-off. **These are launch blockers — Phase 5 cannot pass without them.**

---

## RBAC WORKSTREAM (own track — not folded into UI work)

Priority: the **224 any-admin API routes**, not nav filtering.

1. **RBAC-1 (deliverable for your approval):** role → permission matrix covering all 298 admin routes, grouped by capability domain (finance, dealers, buyers, compliance, content, social, system), mapped to the existing roles (`SUPER_ADMIN`, `FINANCE_ADMIN`, `SUPPORT_ADMIN`, …) and the existing `getAdminWithRole`/`requireContentCapability` mechanisms. Effort M.
2. **RBAC-2 (shadow mode):** enforcement wrapper logs would-be-denied calls (audit-only, zero behavior change) for a soak period you set; report of observed denials. Effort M.
3. **RBAC-3 (hard enforcement):** flip to enforce after you review the shadow report. Behavior change — separately gated. Effort S–M.

---

## Part A — Shared Design System Spec ("AutoLenis UI")

*(Unchanged from v1 except where noted; restated for one-document completeness.)*

**Principle:** promote the CRM kit + its `tokens.ts` model. Light mode is the launch target; dark capability retained in the token model.

### A1. Tokens
- One global CSS-var layer at `:root` (CRM model lifted out of `.crm-root`), exposed via Tailwind v4 `@theme`; shadcn HSL block, dead `.dark` block, and v3 `tailwind.config.ts` remnants removed; `components.json` corrected.
- Color roles: `--color-primary #0B5FD1` (+hover `#0A4DB8`, subtle, fg) · `success #15803D` · `warning #B45309` · `danger #B91C1C` · `info` (each + subtle/fg) · neutrals `bg/surface/surface-raised/border/text/text-muted/text-subtle` · accent `#643293`. Token values are chosen to match current rendered output where marketing-shared primitives are concerned (Standing Directive 2).
- Radius `6/8/12px`; one card radius (12). Elevation: 3 shadow tokens. Spacing: 4px scale, no arbitrary bracket values.
- `design_guidelines.json` is **removed from the repo** and archived as a design-decision record (`docs/design-decisions/2026-07-dark-spec-retired.md`) noting: never implemented, retired 2026-07, current light/blue system canonized, no rebrand coupled to launch. (Decision #5.)

### A2. Typography — **one type system** (Decision #6)
- **Two families:** Inter (all UI text — body, data, headings) + JetBrains Mono (numerals/IDs/code). Space Grotesk and Plus Jakarta Sans are removed from the app payload; any dealer-surface distinction is expressed through theme tokens (color/weight/density), not fonts. *(v2 change: v1 kept Space Grotesk for display; the "consolidate to one type system" directive collapses this to Inter + mono.)*
- Scale: 12/16 · 14/20 · 16/24 · 18/28 · 20/28 · 24/32 · 30/36 · 36/40; weights 400–700; 12px floor (9–10px usages migrate up).

### A3. Component inventory
Promoted CRM kit: Button, Badge/StatusPill, DataTable, Tabs, KpiCard, PageHeader, EmptyState, Skeleton, SlideOver, Toolbar. Repaired existing 8 primitives (visual-equivalent re-tokenization; purple-hover bug fix is a visible defect fix, called out in its commit). New Radix-based: Dialog, DropdownMenu, Tooltip, Checkbox, Radio, Switch, Pagination, Toast (sonner wrapper), FormField/FormError (RHF + zodResolver), DashboardShell (skip link, landmarks, config-driven role/journey-aware sidebar). Shared `lib/format.ts`.

### A4. States & interaction
Five states on every view (loading skeleton / empty w/ action / error w/ retry + correlation id / partial / success); mutations confirm via toast or inline status; no `alert()`; destructive actions confirm via Dialog; motion 150–200ms ease-out behind `prefers-reduced-motion`.

### A5. Accessibility (WCAG 2.2 AA)
`focus-visible` everywhere; keyboard-complete overlays; `aria-label` on icon-only buttons; status = dot **and** text; landmarks + skip link; labeled forms with `aria-invalid`/`aria-describedby`; 4.5:1 verified per token pair.

### A6. Breakpoints & density
`sm 640 / md 768 / lg 1024 / xl 1280`; dashboards optimized lg/xl; every table defines `<md` behavior (priority-column or card list); sidebars drawer `<lg`.

---

## Part B — Execution Backlog

### Phase 2 — Foundation (each item = one reviewable commit; marketing spot-check in every loop)
| # | Item | Closes | Effort |
|---|------|--------|--------|
| 2.1 | Global token layer + Tailwind v4 cleanup + `design_guidelines.json` retirement record | H-7 root, Decision #5 | M |
| 2.2 | `lib/format.ts` + codemod 8 formatters & inline call sites | H-7 | M |
| 2.3 | Re-tokenize 8 existing primitives **visually equivalent** (separate commit for the purple-hover defect fix) | Foundation §4 | S |
| 2.4 | Promote CRM kit → `components/ui` (CRM pages keep working) | H-13 | L |
| 2.5 | Radix primitives: Dialog first, then the rest | H-8 | L |
| 2.6 | Form stack (RHF + zodResolver + FormField) | Foundation | M |
| 2.7 | sonner standardization | Foundation | S–M |
| 2.8 | DashboardShell + affiliate layout + landmarks/skip-link | Foundation §3 | L |
| 2.9 | Typography consolidation to Inter + JetBrains Mono (fonts removed from payload; heading styles remapped) | Decision #6 | M |
| 2.10 | a11y sweep: focus-visible, reduced-motion | M-23 | M |

### Phase 3 — Per-dashboard (order: Dealer → Affiliate → Buyer → Admin; complete & verify one before the next)
- **3A Dealer:** shell/tokens/primitives; shared API client (one envelope convention, kills `[object Object]` errors — M-7); consolidate dual bid forms, remove fake gauge & free-text auction ID (M-6); remove duplicate signin route; keyboard-accessible password toggle; dot+label statuses; messages refresh affordance; hex migration.
- **3B Affiliate:** shell + loading.tsx (M-17); error-vs-empty separation (M-18); **unify banking models — Finance Hub `AffiliatePayoutMethod` canonical, onboarding reads/writes it (H-6; data-contract change, explicitly gated)**; document signed-URL downloads (M-20); compliance ack records disclosures (M-19); 2%→3% copy; nested-button fix; leaderboard SQL aggregate (H-12); network-tree N+1s.
- **3C Buyer:** shell/tokens; **early-accept `forceEarly` flow with disclosure Dialog (H-2 completion; behavior addition, gated)**; shared `computeJourney()` (M-3); journey-aware sidebar (M-4); accessible lightbox (M-5); EmptyState adoption; remove dead `auction/` tree; `next/image`; **API auth helper suspended/verified checks (M-1; hardening, gated)**; guard Contract Shield mock-PASS (M-2; gated); split request form.
- **3D Admin:** shell/tokens + kit adoption across 52 sections; split giant clients (H-14); section error/not-found boundaries (M-16); nav restructure + dedupe (M-21); mobile table behavior (M-22); aria-label sweep; `next/dynamic` recharts; self-host leaflet markers.

### Phase 4 — Optimization & cleanup
Code-splitting sweep (M-13) · cache/ISR audit of 215 force-dynamic pages (M-14) · unbounded `findMany` sweep (M-11) · N+1 batching (M-12) · dead code: CRA scaffold, `.eslintrc.json`, duplicate routes, unused deps (incl. now-unused `PayoutRequestButton` if the rail stays closed), 82 lint warnings → 0 · env validation w/ boot-time fail-fast (M-15) · proxy.ts dead-guard + auth-route header fix (M-8/M-9) · `backend/server.py` decision (pending owner: still on Emergent preview?).

### Phase 5 — Launch readiness
Verification loop; WCAG spot-audit per dashboard; cross-role access re-check; bundle before/after; **Phase 0.5 items confirmed live**; RBAC status report; Definition-of-Done review; final sign-off.

---

## Decision register (v2)
| # | Decision | Status |
|---|----------|--------|
| 1 | Inventory: Admin/Buyer/Dealer/Affiliate; marketing out of redesign scope, token-consumer w/ visual freeze | **Confirmed** |
| 2 | CRM kit promotion, no net-new system | **Standing directive** |
| 3 | Buyer Premium free upgrade | **PENDING owner** — endpoint hardened now (idempotent, audited; rate limit via 0.5-1) |
| 4 | Affiliate payout rail | **Deferred, out of scope** — CTA hidden, balance visible (shipped) |
| 5 | `design_guidelines.json` | **Remove + archive as decision record; light/blue canonized; no launch-coupled rebrand** |
| 6 | Fonts | **One type system (Inter + JetBrains Mono); dealer distinction via tokens only** |
| 7 | Admin RBAC | **Own workstream: matrix → shadow → enforce; API-layer first; not folded into UI work** |

**Approval requested at this gate:** Part A (incl. A2's one-type-system reading of Decision #6), Part B sequencing, Phase 0.5 scope/order (payment-intent limiter first), and the RBAC workstream shape.
