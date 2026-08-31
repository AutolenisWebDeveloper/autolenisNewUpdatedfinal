# Vercel preview deployment failures — 2026-08-30/31

Point-in-time investigation. Records why a run of preview deployments failed, what
was ruled out, and what could not be reached from a hosted agent session. Written so
the next person who sees a fast `Building → Error` does not re-run the same
eliminations.

## Symptom

Four consecutive preview deployments on `claude/autolenisadmin-content-ux-7p6hdr`
failed 1–3 seconds after entering `Building`. GitHub Actions CI was green on every
one of those commits.

## Timeline

All times UTC, taken from the GitHub commit-status API
(`/repos/:owner/:repo/statuses/:sha`), which records both the `pending` and the
terminal status per deployment.

| SHA | Started | Result | Duration |
| --- | --- | --- | --- |
| `42020e6` | 19:29:19 | success | 3m08s |
| `7f4f5cb` | 20:38:56 | **failure** | 2s |
| `71e2407` | 20:41:38 | **failure** | 1s |
| `359abab` | 20:57:28 | **failure** | 2s |
| `267d038` | 01:08:54 | **failure** | 3s |
| `24ae53d` | 01:32:08 | success (production) | 2m56s |
| `267d038` | 01:32:40 | success | 3m03s |

## What the timeline proves

**The repository is not the variable.** `267d038` appears twice: it failed in 3s at
01:08 and succeeded in 3m03s at 01:32. Same commit, same tree, same `vercel.json`.
No change to the repo can explain a commit that both fails and succeeds.

**The build never ran on the failures.** `pnpm install --frozen-lockfile` takes 4–7s
in a comparable container and `pnpm build` takes ~60s. A 1–3 second
`Building → Error` is shorter than the install step alone, so no dependency install
completed and nothing was compiled. The failures are upstream of the build.

**The failures were bounded in time**, roughly 20:38–01:09, with successful
deployments on either side (19:29 and 01:32).

## Ruled out

- **This branch's code.** `42020e6` succeeded before any of the feature code existed,
  and `267d038` later succeeded unchanged.
- **`vercel.json` / `.vercelignore`.** Untouched by the branch —
  `git log 73223c3..267d038 -- frontend/vercel.json` is empty.
- **Cron count.** `frontend/vercel.json` declares 66 crons, but the same file
  deployed successfully to production at 01:32, so the count is within what the plan
  allows and is not the trigger. (Worth knowing regardless: 4 crons run every minute
  and 8 every five minutes.)
- **Lockfile / dependency / `next.config.mjs` drift.** No such change in the range.
- **Build breakage.** CI ran `pnpm build` green on every one of the failing commits.

## Not determined

The specific reason for the 20:38–01:09 window. It is upstream of the build, so the
answer is in the Vercel build logs, not in this repository:

```
npx vercel inspect dpl_DQpvozWSmecPXvAGis81dcwmPsF1 --logs
```

## Why it could not be determined from a hosted agent session

Recorded so this is not re-attempted from the same dead ends:

- The Vercel MCP connector authenticates as an identity that can see the team
  (`autolenis`, Pro) but has no project access: `list_projects` returns `[]`,
  `list_deployments` returns `403 forbidden`, and `get_deployment` returns `404`
  even for valid deployment IDs read out of the commit statuses.
- The hosted session's network egress policy blocks `autolenis.com` and
  `api.vercel.com`, so neither the site nor the Vercel REST API is reachable.
- `api.github.com` *is* reachable, which is how the timeline above was recovered.
  The GitHub MCP toolset has no combined-status method for an arbitrary SHA
  (`pull_request_read`'s `get_status` is PR-scoped), and Vercel reports deployments
  as a **commit status**, not a check run — so `get_check_runs` does not show it.

## Method note

If this recurs, get the per-deployment timings first. Duration separates a
pre-build failure (seconds) from a real build failure (minutes), and that single
distinction rules out the entire class of code-and-config causes before anyone
starts bisecting a diff.
