# AutoLenis — Sequenced Execution Backlog (Phase 2 gate artifact)

**Status:** DRAFT for owner approval. Companion to `docs/design-system/AUTOLENIS_UI_SPEC.md` and `docs/rbac/ROLE_PERMISSION_MATRIX.md`.
**Finding IDs** reference `AUTOLENIS_UIUX_PLATFORM_AUDIT.md`. Effort: S <1d · M days · L 1–2wk.

## Regression floor (every phase, every wave — a wave that ends below the floor does not merge)

| Check | Floor | Notes |
|---|---|---|
| `pnpm typecheck` | 0 errors | |
| `pnpm lint` | 0 errors; warnings ≤ current count, **monotonically decreasing** (82 at Phase 0.5 close) | warning count recorded in each PR body |
| Unit tests | all suites green: baseline 76 + buyer-insurance 3 + buyer-plan 3 + security 5 + webhooks 6 (+ suites added later) | no suite may be removed to pass |
| `pnpm build` | exit 0 | local + GitHub Actions CI |
| `pnpm test:visual` (from Phase 2 wave 0) | 0 unexplained diffs; **marketing pages: 0 diffs, hard stop** | labeled consolidation-delta commits are the only allowed dashboard diffs |
| Cross-role access check (Phase 3+) | each role's token rejected on the other three roles' API roots | scripted probe |
| Hex-count ratchet (Phase 2C+) | raw-hex grep count strictly decreases per dashboard sweep | recorded in PR body |

## Status ledger
- **Phase 0 audit** — merged (#281). **Phase 1 plan v1/v2** — merged (#282, #283).
- **Hotfix wave + pre-merge conditions** — merged (#283).
- **Phase 0.5** — in review (#284): Sentry ✅ · payment-intent limiter (fail closed) ✅ · sign-in/reset limiter (fail open) ✅ · webhook transactional idempotency + out-of-order guards ✅. **Ops still owed: SENTRY_DSN, Upstash/KV env.** Launch sign-off (Phase 5) blocked until both are live and observed.
- **RBAC workstream** — RBAC-1 matrix delivered (`docs/rbac/`), awaiting owner approval of the ⚠️ cells → RBAC-2 shadow mode → RBAC-3 enforcement (destructive list first).

## Phase 2 — Foundation (each item one reviewable commit; sequence is dependency order)

| # | Item | Closes | Effort |
|---|---|---|---|
| 2.0 | **Playwright visual-regression harness + baseline capture** (marketing pages importing shared primitives + 1 page/dashboard, sm+lg) — lands BEFORE any token work | owner guardrail | M |
| 2.1 | Token layer `--al-*` (additive, zero consumers — spec §6 Phase A) | H-7 root | S |
| 2.2 | `lib/format.ts` + codemod 8 formatters & inline call sites | H-7 | M |
| 2.3 | Re-tokenize 8 primitives, exact-value (spec §6 Phase B); purple-hover defect fix as its own commit | Foundation §4 | S |
| 2.4 | Promote CRM kit → `components/ui` (re-exports keep CRM pages working) | H-13 | L |
| 2.5 | Radix primitives: Dialog first (46 ad-hoc modals waiting), then DropdownMenu/Tooltip/Checkbox/Radio/Switch/Pagination/Toast | H-8 | L |
| 2.6 | Form stack: FormField/FormError on RHF+zodResolver | Foundation | M |
| 2.7 | Toast standardization on sonner; delete ad-hoc useState toasts | Foundation | S–M |
| 2.8 | DashboardShell + config-driven sidebar + affiliate layout + landmarks/skip-link | Foundation §3 | L |
| 2.9 | Typography consolidation (Inter + JetBrains Mono; remove 2 families) — visual-diff-labeled | Decision #6 | M |
| 2.10 | a11y sweep: `focus-visible` (567 sites), `prefers-reduced-motion` guard | M-23 | M |
| 2.11 | Tailwind v3 remnant + shadcn HSL + dead `.dark` removal; fix `components.json`; archive `design_guidelines.json` → decision record | Decision #5 | S |

**Phase 2 gate exit:** foundation in place, zero dashboards visually changed except labeled commits; marketing baseline diff clean; regression floor met.

## Phase 3 — Per-dashboard redesign & hardening (order: Dealer → Affiliate → Buyer → Admin; complete + verify one before the next; hex sweep C-phase rides each)

**3A Dealer (first — smallest core-flow debt, proves the shell):** shell/tokens/primitives adoption · shared typed API client (envelope unwrap at compile time — kills the M-7 class that produced C-1/C-2) · consolidate dual bid forms; delete fake gauge + free-text auction ID (M-6) · remove duplicate `/dealer/signin` · keyboard-accessible password toggle · dot+label statuses · messages refresh affordance · remove debug logging · 233-hex sweep.
**3B Affiliate:** shell + loading.tsx (M-17) · error-vs-empty separation (M-18) · **banking-model unification — `AffiliatePayoutMethod` canonical (H-6; data-contract change, its own gate)** · document signed-URL downloads (M-20) · compliance ack records disclosures (M-19) · 2%→3% copy · nested-button fix · leaderboard SQL aggregate (H-12) · network-tree N+1s · 269-hex sweep.
**3C Buyer:** shell/tokens · **early-accept `forceEarly` disclosure Dialog (H-2 completion; behavior addition, gated)** · shared `computeJourney()` (M-3) · journey-aware sidebar (M-4) · accessible lightbox via Dialog (M-5) · EmptyState adoption (M-9) · remove dead `auction/` tree · `next/image` migration · **API auth helper suspended/verified checks (M-1; gated)** · **Contract Shield mock-PASS guard (M-2; gated)** · split 1,497-line request form · 856-hex sweep.
**3D Admin (largest, last):** shell/tokens + DataTable/KpiCard/PageHeader across 52 sections · split SocialDashboardClient (4,685 lines) + 5 command centers into shared scaffolding (H-14) · section `error.tsx`/`not-found.tsx` (M-16) · nav restructure + dedupe + role-driven visibility (M-21, coordinated with RBAC-2 map) · `<md` table behavior (M-22) · aria-label sweep · `next/dynamic` recharts · self-host leaflet markers · 2,191-hex sweep (per-section commits).

**Per-dashboard gate exit:** audit findings for that dashboard closed or explicitly deferred with reason; five states verified on every view; cross-role probe green; floor met.

## Phase 4 — Optimization, automation & cleanup (cross-cutting)
Code-splitting sweep — `dynamic()` for recharts/leaflet/heavy clients (M-13) · cache strategy: audit 215 `force-dynamic` pages, ISR for public/SEO tree (M-14) · unbounded `findMany` sweep — `take`/pagination on 28 admin routes (M-11) · N+1 batching incl. bulk-send suppression checks (M-12) · **RBAC-2 shadow mode → denial report → RBAC-3 enforcement (destructive list first)** · `PLAN_UPGRADED` AdminActionType enum member (+ any other deferred migrations, batched) · env validation module w/ boot-time fail-fast (M-15) · proxy.ts dead-guard removal + auth-route header fix (M-8/M-9) · dead code: CRA scaffold `src/`, `.eslintrc.json`, duplicate route trees, unused deps (`PayoutRequestButton` if rail still closed), 82 lint warnings → 0 · `backend/server.py` removal **[pending owner: Emergent preview still in use?]** · typed API client extended platform-wide.

## Phase 5 — Launch readiness
Full regression floor · WCAG 2.2 AA spot-audit per dashboard (keyboard walk + contrast + SR pass on core flows) · cross-role access re-check · bundle before/after report · **Phase 0.5 verified LIVE: Sentry event observed in prod project; limiter keys observed in Redis; webhook replay drill** · RBAC status report · Definition-of-Done review against the engagement brief · final sign-off.

## Standing decisions log
#1 inventory confirmed · #2 CRM-kit promotion (standing directive) · #3 Premium free upgrade INTENTIONAL (hardened, tested, telemetry) · #4 payout rail deferred, CTA hidden · #5 design_guidelines.json → decision record · #6 one type system · #7 RBAC own workstream, API-first, shadow-then-enforce.
