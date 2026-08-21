# Visual-regression harness (Phase 2 design-system guardrail)

Diffs screenshots of pages that consume the shared design-system primitives
against a committed baseline, so token migration cannot silently change
rendered output. Marketing pages are **frozen** — any diff is a hard stop.

## How it runs

The harness screenshots a **running instance** (`VISUAL_BASE_URL`); it does not
boot the app. Point it at either:

- a CI job that starts the built app against a service-container Postgres
  (the `ci.yml` build already provisions placeholder env — extend it to
  `next start` + seed for a real baseline), or
- a deployed **preview URL** for the public marketing tier (auth not required).

```bash
# Capture / update the baseline (review the image diff in the PR):
VISUAL_BASE_URL=https://<preview> pnpm test:visual:update

# Verify against the committed baseline (runs in CI every Phase 2/3 loop):
VISUAL_BASE_URL=https://<preview> pnpm test:visual
```

Chromium is preinstalled in the CI/agent image; set `PW_CHROMIUM_PATH` if the
default resolution fails. Do **not** run `playwright install`.

## Status / known limitation

Baselines are **not committed yet**: the development sandbox has no database and
the app's `force-dynamic` pages cannot render there, so a real baseline must be
captured from a live instance in CI or against a preview URL. Until the CI job
lands, the affiliate token sweep relies on **exact-value token mapping**
(each `#hex` → a token whose value equals that hex) plus review — equivalent by
construction — and this harness gates from CI as soon as its baseline is
captured. This limitation is called out to the owner explicitly rather than
silently skipped.

## Dashboard tier

Auth-gated dashboard pages need a signed-in `storageState`; set
`VISUAL_STORAGE_STATE` in CI to include them. Dashboard diffs are expected only
inside labeled consolidation-delta commits; otherwise they fail the gate.

## Baseline provenance (committed)

The marketing baseline in `__baseline__/` is rendered by the CI runner image
(`ubuntu-24.04`, pinned in `.github/workflows/visual.yml`) — never an ad-hoc
container — so capture and comparison share the identical font/anti-aliasing
environment. The `visual.yml` job self-seeds the baseline on that runner when
none is committed (with a two-pass determinism check) and commits it back; every
subsequent run compares a fresh render against the committed baseline on the same
pinned image. The self-seed gate is all-or-nothing: it regenerates (and commits
back) only when **no** baseline PNGs are committed. To re-seed after an
intentional design change, either delete **all** `__baseline__/*.png` so the job
takes the seed path, or regenerate locally with `pnpm test:visual:update` and
commit the result — then review the diff here. Deleting only a subset does **not**
trigger regeneration; the job runs compare-only and fails on the missing snapshots.
