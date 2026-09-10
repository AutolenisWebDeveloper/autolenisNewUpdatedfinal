# Phase 4 — migration proof

One migration: `frontend/prisma/migrations/20261112000000_stage4_trade_election/`.

| | |
| --- | --- |
| Statement | `ALTER TABLE "vehicle_requests" ADD COLUMN IF NOT EXISTS "trade_elected" BOOLEAN;` |
| Class | additive, nullable, no default, no index, no constraint, no rewrite |
| Ordering | **migration first, without exception** — see below |
| Proof | `./run-proof.sh`, 8 steps, exit 0 |
| Server it ran on | **PostgreSQL 16.13 — DEGRADED**, production runs 17.6 |

## Why the column exists when Phase 1 shipped its sibling

§5a requires the eligibility recheck to confirm "co-buyer and trade elections recorded". Phase 1's
wave shipped `vehicle_requests.co_buyer_elected` and no trade counterpart, and that was correct at
the time: `payment/PAY-06b`, the row that reads both, was a **Phase 3** row when the wave was
authored. §11.6 ruling 12 moved PAY-06b to Phase 4 on 2026-09-09 so the check would ship with its
writer — and nobody re-derived which schema objects the destination phase now required. This is
that column.

`vehicle_request_financing.trade_in` was considered first and cannot serve: the relation is
optional, so "no financing row" and "the buyer has not answered" are the same observation, and an
election is a three-state fact. Phase 4 **mirrors** the election into it rather than replacing it,
so every existing reader keeps working.

## The server-major substitution, stated plainly

The runbook requires PostgreSQL 17.6 and `phase-3-proof/run-proof.sh` hard-refuses anything else.
**That refusal was not relaxed.** This is a separate harness for a separate migration; Phase 3's is
untouched.

This session cannot obtain a 17.x server: the environment's network policy denies every
`postgresql.org` host (`apt.`, `www.`, `ftp.` all fail CONNECT with 403 through the agent proxy),
so PGDG is unreachable and only the preinstalled 16.13 exists. The harness therefore accepts 16 or
17, prints which it ran on, and marks the run `DEGRADED` when it is not 17.

**Why a 16.13 PASS is real evidence for this statement.** The entire migration is one
`ADD COLUMN IF NOT EXISTS ... BOOLEAN`. Its semantics — nullable, no default, catalog-only update,
`IF NOT EXISTS` as a NOTICE-only no-op — are identical from 9.6 through 17; there is no 17-only
behaviour for it to depend on. The production baseline being restored was itself synthesised with a
16.13 client (`production-baseline/00-header.sql:3-5`).

**Where it would not be evidence.** Not for the Phase 1 wave: enum labels inside a transaction
(55P04), partial unique indexes validated against live data, and plpgsql triggers are all places a
major-version difference could plausibly bite. This migration contains none of them.

**What would close it:** one run of `./run-proof.sh` against a PostgreSQL 17.6 server, which needs
either network access to `apt.postgresql.org` or a preinstalled 17.x binary in the image.

## What the proof asserts

1. Baseline restores and `vehicle_requests` has no `trade_elected` — the premise.
2. The committed chain applies on top: the Phase 1 wave, `20261110000000`, `20261111000000`.
3. This migration applies.
4. **Exactly one column added** (62 → 63), and it is `YES|boolean|NODEFAULT`. A DEFAULT would record
   every existing buyer as having declined a trade nobody asked them about.
5. **Zero rows carry an election.** NULL is "not asked yet", which is what `ELECTIONS_REQUIRED`
   fires on.
6. **Nothing else changed.** Seven of the eight digests — tables, indexes, constraints, enums,
   triggers, policies, functions — byte-identical before and after; only `cols_d` moves, and step 4
   already accounts for that. The filter's field name is itself asserted, because a filter that
   strips a field that does not exist would compare the moving field and fail every run.
7. **Re-apply is a clean no-op**: definition, counts and digests all identical.
8. **The deploy-order hazard is reproduced, not asserted.** A second database is built to the chain
   *without* this migration, and `SELECT "trade_elected"` against it returns
   `42703 undefined_column`.

Step 8 exists because the immediately preceding migration in this chain claimed "safe in either
order" and was wrong — see `../../../frontend/prisma/migrations/20261111000000_deposit_status_disputed/ORDERING.md`.
A prose claim about deploy ordering is exactly the kind that decays silently, so this one is
executable.

## The ordering constraint

**Apply the migration, then deploy the application. The reverse breaks buyer checkout.**

Prisma selects every scalar a model declares unless the query narrows it. Once `trade_elected` is
on the model and the client is regenerated (`pnpm build` is `prisma generate && next build`), every
unnarrowed read of `VehicleRequest` asks for a column an unmigrated database does not have.

Six unnarrowed reads exist. `include:` does not narrow — it adds relations while still selecting all
of the parent's scalars.

| Read | Note |
| --- | --- |
| `lib/services/vehicle-request/open-request.service.ts:67` `findOpenRequest` | **the one that matters** |
| `lib/services/vehicle-request/vehicle-request.service.ts:22` `hasActiveRequest` | dead — zero callers |
| `app/api/buyer/requests/[requestId]/cancel/route.ts:14` | |
| `app/api/admin/requests/[requestId]/route.ts:73` | |
| `app/api/public/request-vehicle/complete/route.ts:230` | |
| `app/admin/vehicle-requests/page.tsx:18` | `include`, no `select` |

`findOpenRequest` has seven live call sites, which between them are the buyer's whole payment path:
`buyer/deposit/create-intent:163`, `buyer/deposit/success/page:36`, `buyer/plan/upgrade:85`,
`admin/payments/deposit/create-intent:61`, `admin/payments/deposit/send-link:59`,
`admin/buyers/[buyerId]/plan:125`, `public/request-vehicle/complete:231`.

**The reverse order is safe**, which is why the order is a requirement and not a preference: a
database carrying an unread column costs nothing.

## Running it

```bash
cd docs/transaction-flow/phase-4-proof
PROOF_PORT=5432 PROOF_USER=pgtest ./run-proof.sh
```

Loopback only, and it refuses any database name it did not create. It never reads a production DSN.

---

# The catalogue purge (owner-run, not a migration)

Three SQL files, plus the harness that proves them. **None of this is a migration and none of it
runs from a deploy.** It is DML against business tables, which the per-run protocol authorizes
only for the owner, one approved run at a time.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `catalogue-purge-establish.sql` | 9909 | `ffb242497f75d4f07c14f8069f565531b7073376585306356954b804e9b7cc62` |
| `catalogue-purge-delete.sql` | 17220 | `a7717ccad1a92bbd9bdb53454dd71db912f205b13d2500c9230589abf0dc7087` |
| `sweep-failure-diagnostic.sql` | 7831 | `6dbb442d5e5d6db4a6d6f567e29b58d66a26930e9165202c4f30d627b91cad42` |
| `catalogue-purge-rehearsal.sh` | 19338 | `35e28fd74385145aa13d57eab5daefb227403374e3293c136ada18761c7e8d6c` |

## Why

Read-only census, owner-run 2026-09-10: all 221 `inventory_items` carry no city, state or zip
(207 NULL, 14 empty string), no `rooftop_id` and no `mc_rooftop_id`; the newest was created
2026-09-02 and last updated 09-03; every one was swept before `center_zip` became 76011.

Those are one fact, not four. With no geography `distanceMilesBetween` returns null, so
`shortlistGate` fails closed with `DISTANCE_UNKNOWN` and offers `REQUEST_SIMILAR`. Not one of the
221 can be shortlisted by anyone, and none can resolve to a rooftop. Fixing the adapter fixes
every sweep after it deploys and does nothing for these rows; leaving them makes the catalogue
half correct and half inert with nothing on the buyer's side telling the two apart.

## What blocks a delete, read from the physical schema

`pg_constraint.confdeltype` on the restored production schema, asserted by the rehearsal
(step 2) rather than read from migration source:

| Reference | Action | Effect |
| --- | --- | --- |
| `shortlist_items.inventory_item_id` | `r` RESTRICT | **blocks** — 15 rows |
| `auction_vehicles.inventory_item_id` | `a` NO ACTION | **blocks** — 3 rows, not named in the brief |
| `vehicle_requests.inventory_item_id` | `n` SET NULL | silently changes a business record |
| `vehicle_match_scores` · `inventory_price_alerts` · `inventory_quality_scores` · `vehicle_request_match_results` | none | orphans nothing will clean |

The two that block are not routed around: the rows they point at are **retained**. Deleting one
removes something a buyer chose, and those rows are already inert and already handled — Phase 4's
`revalidateCandidate` drops a candidate that fails revalidation on location, with a reason, in
front of the buyer. The SET NULL is performed explicitly instead of by the FK, because
`updated_at` is maintained by Prisma's `@updatedAt` and an FK-driven change would leave the row
claiming it had not changed. The four soft references are deleted in the same transaction.

## Order of operations

Run the purge **after** a successful sweep, never before. New rows are VIN-keyed and insert
alongside the old, so there is no window in which the catalogue is empty. The delete script
enforces it: with no geocoded active listing present it refuses, and `-v allow_empty_catalogue=1`
is the deliberate override.

```bash
# 1 — establish. Read-only, operation class 3.
psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" -f catalogue-purge-establish.sql

# 2 — delete. Owner-run DML. `expected_deletes` is query 4's `deletable`.
psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 \
  -v expected_deletes=<N> -f catalogue-purge-delete.sql
```

`defective_not_selected` in query 4 is step 2's rollback condition computed in advance. If it is
anything but 0, step 2 refuses; report the number rather than widening the predicates.

## Proof

`./catalogue-purge-rehearsal.sh` — 11 steps, exit 0, PostgreSQL 16.13 (**DEGRADED**, as above).
It restores production's physical schema, seeds a synthetic replica of the census, and proves:
the FK topology the scripts were written against; the establish script running inside a
server-enforced read-only transaction; four refusals (no `expected_deletes`; a count that does
not reconcile; no geocoded listing present; a row that shares the defect but escapes a
predicate — that last one rolls back rather than half-applying); the real delete removing exactly
203 listings; 15 shortlisted and 3 candidate listings retained; 4 requests cleared and evented;
the four soft references cut selectively in both directions; zero orphans; and a second run
refusing rather than silently doing nothing.

The seed is modelled on the census. It is **not** a copy of production data, so it proves the SQL,
not the row contents.

## No `audit_logs` row

`audit_logs.action` is the `AdminActionType` enum and has no `DELETE` member. Writing
`STATUS_CHANGE` would put a false statement in the audit trail to satisfy a convention, and adding
an enum member is DDL that belongs in a migration. The record is instead: the run output (which
names every deleted id, and which the per-run protocol already requires be reported in full) and a
`vehicle_request_events` row per cleared request, where `event_type` is a free string and can say
what actually happened.
