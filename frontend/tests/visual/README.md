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

## Only CI results are meaningful — never judge this suite locally

The baseline is rendered by, and pinned to, the `ubuntu-24.04` CI runner (see
*Baseline provenance* below). Font and anti-aliasing rendering is
environment-specific, so running `pnpm test:visual` in a dev container or agent
sandbox typically fails **all ten** snapshots for reasons that have nothing to
do with the code. That is an environment mismatch, not a regression — and it is
not evidence that the baseline is stale.

**The `Visual regression` workflow is the only authoritative result.** It can be
run on demand (`workflow_dispatch`) against any branch, and comparison-only runs
never push. A local failure is worth investigating only if CI agrees.

## Baseline re-seed — 2026-08-28

The committed baseline was **deliberately deleted in this branch so `visual.yml`
re-seeds it on the pinned runner.** This is the documented re-seed procedure, not
an accident; see *Baseline provenance* below for why the gate is all-or-nothing.

### Why

Running the workflow against `main` (`e7ede4e`) gave **9 passed, 1 failed** —
only `marketing-how-it-works [mobile]`, expected 412x12949 vs actual 412x12972
(**+23px**). The other nine matched exactly.

Cause: commit `a3e4ec2` (in-house e-sign, DocuSign removed) changed frozen
marketing copy on `/how-it-works` — "sign via DocuSign" -> "sign securely
online", plus a card title `DocuSign E-Signing` -> `Secure E-Signing`. At the
412px mobile width that wraps to one extra line; desktop is wide enough not to
reflow, which is exactly why only the mobile snapshot failed.

The guardrail worked as designed: it failed on four consecutive runs of that PR
(runs #13-#16). The PR was merged with the check red, so `main` carried an
intentional-but-never-reviewed marketing diff from 2026-08-26 until this re-seed.

### What changed

Only the frozen baseline. **No marketing page, component, or design token was
touched** to produce it — the copy change that moved the pixels was `a3e4ec2`,
already on `main`, and it is correct: DocuSign is genuinely gone. Reverting the
copy to match a stale baseline would have reintroduced a false product claim, so
re-freezing on the current, truthful render is the right direction.

The nine snapshots that already matched are re-rendered on the same pinned image
by the same seeding pass, so they should be byte-identical to what they replaced;
the review to do on the seeding commit is the `how-it-works` mobile diff.

### If you need to do this again

Deleting a **subset** does not work — the seed step regenerates only when *no*
baseline PNGs are committed, so a partial delete leaves the job on the
compare-only path and fails on the missing snapshots. Delete all of them, or
regenerate locally with `pnpm test:visual:update` on the pinned image and commit
the result.

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
