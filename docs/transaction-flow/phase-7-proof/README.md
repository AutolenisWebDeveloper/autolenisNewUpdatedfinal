# Phase 7 proof artefacts

Three files, in the order you use them:

| File | When | Contract |
| --- | --- | --- |
| `DEPLOY-PACKAGE.md` | Read first | The whole package: both migrations verbatim with size and SHA-256, deploy ordering and what breaks if the app goes first, the commands in execution order, and what each output means |
| `preflight.sql` | Immediately **before** `prisma migrate deploy` | PASS ⟺ no `BLOCK` row. One `CHECKED` row. A silent zero-row result is **not** a pass |
| `verify.sql` | Immediately **after** `prisma migrate deploy`, before the application deploy | PASS ⟺ no `MISSING` row. Checks the physical schema **and** `_prisma_migrations` — neither alone is sufficient |

Both SQL files are pure SELECTs and are run inside a server-enforced read-only transaction:

```bash
psql "$DIRECT_URL" -P pager=off -X -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" -f <file>
```

Neither repairs anything. A preflight that fixes its own preconditions with an `UPDATE` is a
preflight that hides them, and a `MISSING` row after a deploy is reported — the repair is a new
forward migration or an owner-approved `prisma migrate resolve`, never hand-run DDL.

`§6` of `DEPLOY-PACKAGE.md` records what was actually proved on the throwaway loopback database,
including the negative runs: the preflight's `BLOCK` branch and the verify's `MISSING` branch were
each made to fire, and the verify was shown to catch DDL applied out of band — the failure mode that
once left six migrations unrecorded in this project.

Nothing here has been run against production.
