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

## Two gates: pixels and copy

Each marketing page is asserted twice, because the two gates catch different
things and neither covers the other.

| Gate | Baseline | Catches | Blind to |
| --- | --- | --- | --- |
| `toHaveScreenshot` | `marketing-<page>-<project>.png` | layout movement, colour, spacing, token drift | an in-place copy edit small enough to fall under the tolerance |
| `toMatchSnapshot` | `marketing-<page>-<project>.txt` | any change to visible copy, exactly | layout, colour, spacing |

**Why the text gate exists.** The pixel gate runs at `maxDiffPixelRatio: 0.001`,
a tolerance that exists to absorb anti-aliasing noise. That same tolerance also
absorbs a small **in-place** copy edit: swapping a few words changes glyphs
without moving layout, so the diff lands under 0.1% and passes.

That is not hypothetical. Commit `a3e4ec2` changed marketing copy on
`/for-buyers` and `/how-it-works`. **Four** snapshots drifted; only
`how-it-works [mobile]` reflowed enough to cross the threshold and fail. The
other three went green while genuinely stale, and the stale baseline sat on
`main` for two days. Marketing copy here carries product claims, so a silent
copy drift is a truthfulness risk, not a cosmetic one.

Text is compared exactly and has no tolerance to hide behind. Changing copy is
fine — it just has to be an intentional, reviewed baseline update, exactly like
changing a pixel.

**What the text gate does NOT cover.** It reads `document.body.innerText`, i.e.
the copy a visitor actually sees. Image `alt` text, `aria-label`s, `<title>`,
meta/OpenGraph tags and JSON-LD are outside it, and as of this writing nothing
else freezes those for the marketing tier either (`test:seo` covers article
bodies, CTAs and internal links, not page metadata). Treat that as a known gap,
not as covered.

**The capture settles before it reads.** The cookie-consent banner mounts
client-side *after* `networkidle`, a ~283-character swing that appears in some
runs and not others. The helper polls `document.body.innerText` until two
consecutive reads match, which makes the capture deterministic (verified: three
consecutive runs byte-identical on all five pages, both viewports).

## Only CI results are meaningful — never judge this suite locally

The baseline is rendered by, and pinned to, the `ubuntu-24.04` CI runner (see
*Baseline provenance* below). Font and anti-aliasing rendering is
environment-specific, so running `pnpm test:visual` in a dev container or agent
sandbox typically fails **all ten** snapshots for reasons that have nothing to
do with the code. That is an environment mismatch, not a regression — and it is
not evidence that the baseline is stale.

**The `Visual regression` workflow is the only authoritative result** *for the
pixel gate*. It can be run on demand (`workflow_dispatch`) against any branch,
and comparison-only runs never push. A local pixel failure is worth
investigating only if CI agrees.

**The text gate is different: it IS meaningful locally.** Copy depends on the
DOM, not on fonts or anti-aliasing, so a `.txt` baseline is environment-
independent and can be regenerated and verified anywhere the app runs. That
asymmetry matters when updating baselines — see below.

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

### What changed — four snapshots, not one

The re-seed landed as `d7ce8eb` (run
[#19](https://github.com/AutolenisWebDeveloper/autolenisNewUpdatedfinal/actions/runs/33188712755),
seed + two-pass determinism check both passed). Comparing the new baseline
against the old one byte-for-byte:

| Snapshot | Old | New | Change |
| --- | --- | --- | --- |
| `for-buyers-desktop` | 1280x7438 | 1280x7438 | bytes differ, **same size** |
| `for-buyers-mobile` | 412x11836 | 412x11836 | bytes differ, **same size** |
| `how-it-works-desktop` | 1280x8615 | 1280x8615 | bytes differ, **same size** |
| `how-it-works-mobile` | 412x12949 | 412x12972 | **+23px — the one that failed** |
| contact, home, refinance (6) | — | — | byte-identical |

`a3e4ec2` changed copy on **both** `/for-buyers` and `/how-it-works`, so four
snapshots carry real drift. Three of them swapped glyphs in place without
reflowing, landing under the 0.1% `maxDiffPixelRatio` tolerance — so they
**passed the gate while being genuinely stale**. Only the mobile
`how-it-works` render reflowed to an extra line and crossed the threshold.

Two things worth taking from that:

- **A passing snapshot is not proof of an unchanged page.** The tolerance that
  absorbs anti-aliasing noise also absorbs a small copy edit. The gate catches
  layout movement reliably; it catches in-place text changes only when they are
  large enough.
- **The six byte-identical snapshots are the determinism evidence.** Re-rendering
  reproduced them exactly, which is what makes the four that changed
  trustworthy as real drift rather than environmental noise.

No marketing page, component, or design token was touched to produce this
baseline. The copy change that moved the pixels is `a3e4ec2`, already on `main`,
and it is correct: DocuSign is genuinely gone. Reverting the copy to match a
stale baseline would have reintroduced a false product claim.

### If you need to do this again

Deleting a **subset** does not work — the seed step regenerates only when *no*
baseline PNGs are committed, so a partial delete leaves the job on the
compare-only path and fails on the missing snapshots. Delete all of them, or
regenerate locally with `pnpm test:visual:update` on the pinned image and commit
the result.

### Updating the COPY baseline only

`pnpm test:visual:update` rewrites **both** the `.txt` and the `.png` baselines.
Off-runner, the regenerated PNGs are wrong (local fonts), so restore them and
keep only the text:

```bash
# with the app running and VISUAL_BASE_URL pointed at it
pnpm test:visual:update
git restore tests/visual/__baseline__/*.png   # discard local pixel renders
git status --short tests/visual/__baseline__/ # expect ONLY .txt changes
```

Then confirm no PNG moved before committing:

```bash
git diff --stat -- 'tests/visual/__baseline__/*.png'   # must be empty
```

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
