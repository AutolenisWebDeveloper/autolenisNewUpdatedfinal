# Phase 1 migration proof

**This directory is evidence, not Phase 1.** The two `migration.sql` files here are a materialised
copy of the statements §8.2 specifies for the Phase 1 wave. They are deliberately **not** in
`frontend/prisma/migrations/`, so nothing in this directory begins Phase 1, changes the Prisma
chain, or affects a deploy. Their only job is to answer one question with evidence rather than
assertion: *would the wave, as written, actually apply?*

Nothing here was ever pointed at production. Production was read **read-only** (`SELECT` on
`pg_type`, `pg_attribute`, `pg_constraint`, `pg_indexes`) to learn its server version and the exact
definitions of the four adopted background tables.

## What was proven

| # | Claim | Result |
| --- | --- | --- |
| 1 | Production's PostgreSQL version, read-only | `PostgreSQL 17.6 on aarch64-unknown-linux-gnu`, `server_version_num` 170006 |
| 2 | The proof runs on the same major/minor version | Isolated instance: `PostgreSQL 17.6 on x86_64-pc-linux-gnu`, `server_version_num` 170006. **16.13 was not used as a substitute.** |
| 3 | A schema baseline was restored | `prisma migrate deploy`, 103 migrations, exit 0 |
| 4 | Restored object counts recorded | tables 223 · columns 2684 · indexes 576 · FK constraints 117 · enum types 89 · enum values 466 · functions 41 · triggers 5 · RLS-enabled 39 · policies 0 · migrations recorded 103 |
| 5 | Every statement of both directories materialised | `20261106000000_transaction_spine_enums/migration.sql` (41 `ALTER TYPE`), `20261106000100_transaction_spine_foundation/migration.sql` (916 lines) |
| 6 | The complete pair applies, in order | enums exit 0, foundation exit 0 |
| 7 | Every expected object exists | `verify.sql` → **0 rows**. It checks 268 objects: 41 enum labels, 8 enum types, 14 tables, 121 columns, 21 named indexes, 47 foreign keys, 2 triggers, 14 RLS-enabled tables — and separately asserts 0 policies on them and that the replaced `e_sign_envelopes_deal_id_key` is gone |
| 8 | The complete pair applies a second time | enums exit 0, foundation exit 0 |
| 9 | The second application changed nothing | object census `diff` → empty; `verify.sql` → 0 rows |
| 10 | Failures reported, not edited out | Two defects the proof found are recorded below and were fixed |

Post-wave census (second application byte-identical): tables 237 · columns 3136 · indexes 629 ·
FK constraints 164 · enum types 97 · enum values 538 · functions 43 · triggers 7 ·
RLS-enabled tables 53 · **policies 0** · migrations recorded 103 (unchanged — nothing here touches
the Prisma ledger).

The enum-value delta is 72 = 41 `ALTER TYPE … ADD VALUE` labels + 31 labels belonging to the
8 new enum types.

## Why the wave is two directories — re-proven on 17.6

The earlier evidence for the split was executed against PostgreSQL 16.13. That is no longer the
basis for the claim. On the isolated 17.6 instance:

```
BEGIN;
ALTER TYPE split_probe ADD VALUE IF NOT EXISTS 'DRAFT';
CREATE UNIQUE INDEX split_probe_one_open ON split_probe_vr (buyer_id) WHERE status IN ('SUBMITTED','DRAFT');
ERROR:  unsafe use of new value "DRAFT" of enum type split_probe
HINT:  New enum values must be committed before they can be used.
```

The same two statements in two transactions both succeed (exit 0) and `split_probe_one_open`
appears in `pg_indexes`.

The proof also found a **second** object with the same dependency, which the plan had missed:
`audit_logs.action` is the `AdminActionType` enum, not a text column, so the legacy-path partial
index `WHERE action = 'LEGACY_PATH_WRITE'` needs its label committed by the first directory too.
§8.2 now says so.

## The enforcement objects were exercised, not just created

| Object | Probe | Result |
| --- | --- | --- |
| Partial unique index | second open Vehicle Request for one buyer | `ERROR: duplicate key value violates unique constraint "vehicle_requests_one_open_per_buyer_key"` |
| Same index, §23.4 | `DEAL_CREATED` request + a new `SUBMITTED` one | both persist (2 rows) — a completed deal does not block a new $99 request |
| Shortlist cap trigger | sixth `shortlist_items` insert | `ERROR: shortlist sl-proof already holds the maximum of 5 candidates` (P0001) |
| Candidate cap trigger | sixth `auction_vehicles` insert for one request | `ERROR: vehicle request vr-1 already holds the maximum of 5 candidates` (P0001) |

Each probe ran inside a transaction that was rolled back, so the verified state is unchanged.

## Scope of the proof, stated honestly

- **The maximal set was applied.** Statements §8.2 marks owner-gated (`OfferStatus.NOT_SELECTED`,
  `inventory_query_cache`, the `refinance_applications` partner columns) are included and marked, so
  the proof covers the superset. Each is a single guarded statement that can be deleted without
  reordering anything else; omitting them does not change the result for the rest.
- **This does not prove production is ready.** §5.6 found three buyers holding 2–5 rows in the open
  set, so `vehicle_requests_one_open_per_buyer_key` cannot be created in production until §13-D2's
  owner-run cleanup completes. The proof establishes that the statement is valid SQL that produces
  the intended object on an empty database — nothing more.
- **`CREATE INDEX CONCURRENTLY` appears nowhere in the wave.** Prisma runs each migration file in one
  transaction, where it is illegal. The parity rows that prescribed it have been corrected.
- **Where §8.2 does not enumerate a value set** (sourcing-case status, co-buyer role, obligation
  type, correction kind), these files use `text` — with a `CHECK` where §8.2 does give the values —
  rather than inventing enum labels the plan has not decided.

## Reproducing it

```
# isolated instance only — never a Supabase host, never production
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=<local> PGDATABASE=autolenis_e2e
psql --single-transaction -v ON_ERROR_STOP=1 -f 20261106000000_transaction_spine_enums/migration.sql
psql --single-transaction -v ON_ERROR_STOP=1 -f 20261106000100_transaction_spine_foundation/migration.sql
psql -v ON_ERROR_STOP=1 -f verify.sql          # 0 rows = every expected object exists
# then repeat all three; the census must not move and verify.sql must still return 0 rows
```

Tooling used for the run recorded above: node v22.22.2 · pnpm 10.33.0 · prisma 5.22.0 ·
psql client 16.13 against a 17.6 server · git 2.43.0. Every command ran **locally in this session**;
none of it ran in CI. The commit that carries these files, and the head SHA the results correspond
to, are named in the pull request.
