# AUTOLENIS — Broad `console.*` → logger Migration (Gap 10 completion for `lib/`)

**Session:** 4 (continued) · **Date:** 2026-06-15 · **Branch:** `claude/epic-lamport-h6i6cy`
**Scope:** Migrate all remaining raw `console.*` in `lib/` to the structured `lib/logger.ts` and widen the `no-console` ESLint ratchet to all of `lib/`.

## What changed
- **522 `console.*` calls across 116 files** in `lib/` migrated to `logger.*` via a one-shot, audited codemod (the codemod script was removed after running).
  - Mapping: `log→info`, `info→info`, `warn→warn`, `error→error`, `debug→debug`. **No log is dropped** — visibility is preserved and now centrally controllable via `LOG_LEVEL` (e.g., set `LOG_LEVEL=warn` in prod to silence info/debug).
  - The codemod respected `"use client"`/`"use server"` directives when inserting `import { logger } from "@/lib/logger";`, skipped files already importing the logger, and only matched the 5 standard methods (the `searchconsole.googleapis.com` URL and `"admin console"` string were correctly left untouched).
- **ESLint ratchet widened:** `no-console: "warn"` now applies to all of `lib/**` (was just the 5 lifecycle dirs), with `lib/logger.ts` exempted (it is the console sink). `lib/` is now console-free, so this prevents regressions.
- Removed 3 now-stale `// eslint-disable-next-line no-console` directives left above migrated lines.

## Combined with the earlier critical-dir migration
- Batch C migrated the 17 calls in `lib/services/deal/**` + `lib/services/esign/**`.
- This pass migrated the remaining 522. **All of `lib/` (≈539 calls) now routes through the structured logger.**

## Not in scope (future)
- `app/**` and `components/**` still contain raw `console.*` (route handlers, client components). These were left out of this pass; the same codemod + ratchet pattern applies and can be run per-area. The `no-console` rule is intentionally **not** yet applied to `app/`/`components/`.

## Validation (full gate, all green)
| Check | Result |
|---|---|
| `pnpm tsc --noEmit` | **0 errors** (all 116 files type-valid) |
| `pnpm lint` | **0 errors / 97 warnings** (down from 100 — 3 stale directives removed) |
| `pnpm build` | **PASS** |
| `pnpm test` | **38 pass / 0 fail** |

The migration is a pure observability upgrade: structured JSON logs in production, a single sink, and a central level lever — with zero behavior change to log visibility.
