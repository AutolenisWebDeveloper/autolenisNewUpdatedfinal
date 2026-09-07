#!/usr/bin/env bash
# Phase 1 migration proof, run against a PostgreSQL 17.6 restore of production's PHYSICAL schema.
#
# WHAT THIS PROVES: that the two Phase 1 migration directories apply cleanly, produce every object
# they are expected to produce, and are idempotent — starting from the physical schema production
# actually has today, not from an empty database replayed through the repository's migration chain.
#
# WHAT IT DOES NOT PROVE: anything about `_prisma_migrations`. The restore deliberately carries no
# ledger. Ledger correctness is a separate question and is NOT addressed here.
#
# SAFETY: this script is destructive (it DROPs and CREATEs a database) and therefore refuses to run
# against anything but a loopback server and a database name it created itself. It never touches
# production and never reads a production DSN.
set -euo pipefail

PGHOST_="${PROOF_HOST:-127.0.0.1}"
PGPORT_="${PROOF_PORT:-55432}"
PGUSER_="${PROOF_USER:-pgtest}"
DB="${PROOF_DB:-autolenis_prodbase}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$PGHOST_" in
  127.0.0.1|::1|localhost) ;;
  *) echo "REFUSED: proof host must be loopback, got '$PGHOST_'" >&2; exit 2 ;;
esac
case "$DB" in
  autolenis_prodbase|autolenis_e2e*) ;;
  *) echo "REFUSED: proof database must be autolenis_prodbase or autolenis_e2e*, got '$DB'" >&2; exit 2 ;;
esac

ADMIN="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/postgres"
URL="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/${DB}"

ver=$(psql "$ADMIN" -At -c "select current_setting('server_version')")
case "$ver" in
  17.*) ;;
  *) echo "REFUSED: production runs PostgreSQL 17.x; this server is $ver. Do not substitute another major version." >&2; exit 2 ;;
esac
echo "server_version=$ver"

echo "== 1. restore production physical schema =="
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$DB\";" -c "CREATE DATABASE \"$DB\";"
for f in "$HERE"/production-baseline/[0-9]*.sql; do
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "== 2. baseline census =="
psql "$URL" -At -f "$HERE/production-baseline/census.sql" | tee /tmp/proof-census-baseline.txt

# Every CHECK production has TODAY — its full definition and its predicate SHAPE, plus every value
# it admits — captured before anything is applied. This is the "before" side of the preservation
# proof in step 4b, re-derived from the committed baseline on every run rather than transcribed into
# an expectation that can go stale.
#
# ON_ERROR_STOP on every one of these four captures, and a non-empty assertion on both "before"
# files. Without it the whole of step 4b degrades to a SILENT PASS: `psql -At -f x.sql > out` exits
# 0 and writes an empty file when the SQL errors (verified: exit 0, 0 bytes; with ON_ERROR_STOP,
# exit 3), `set -euo pipefail` does not trip, and every comparison below then finds nothing changed
# and nothing lost — reporting "no CHECK weakened against production" having measured nothing.
psql "$URL" -v ON_ERROR_STOP=1 -At -f "$HERE/production-baseline/check-defs.sql" > /tmp/proof-checkdefs-before.txt
psql "$URL" -v ON_ERROR_STOP=1 -At -f "$HERE/production-baseline/check-sets.sql"  > /tmp/proof-checks-before.txt
ckdefs_n=$(wc -l < /tmp/proof-checkdefs-before.txt); cksets_n=$(wc -l < /tmp/proof-checks-before.txt)
echo "  baseline CHECKs captured: $ckdefs_n constraints, $cksets_n admitted values"
# The baseline is committed, so these are known quantities, not guesses. A capture that comes back
# short has not measured the schema it claims to have measured.
[ "$ckdefs_n" -ge 29 ] || { echo "FAIL: baseline CHECK definition capture returned $ckdefs_n rows, expected >= 29" >&2; exit 1; }
[ "$cksets_n" -ge 168 ] || { echo "FAIL: baseline CHECK value capture returned $cksets_n rows, expected >= 168" >&2; exit 1; }

echo "== 3. apply both Phase 1 directories, each in ONE transaction (as Prisma does) =="
for d in 20261106000000_transaction_spine_enums 20261106000100_transaction_spine_foundation; do
  { echo "BEGIN;"; cat "$HERE/$d/migration.sql"; echo "COMMIT;"; } | psql "$URL" -v ON_ERROR_STOP=1 -q
  echo "  applied $d"
done

echo "== 4. verify every expected object =="
v1=$(psql "$URL" -v ON_ERROR_STOP=1 -At -F'|' -f "$HERE/verify.sql")
echo "$v1"
if echo "$v1" | grep -q '^MISSING|'; then echo "FAIL: expected objects missing after first apply" >&2; exit 1; fi
echo "$v1" | grep -q '^TOTAL|' || { echo "FAIL: verifier produced no TOTAL row — it did not run" >&2; exit 1; }
# A FLOOR, not merely a presence check. `verify.sql` could lose half its expectation lists and still
# print a TOTAL and pass — the same silent-shrinkage the CHECK captures above are floored against.
v1n=$(echo "$v1" | grep '^TOTAL|' | cut -d'|' -f3)
[ "${v1n:-0}" -ge 399 ] || { echo "FAIL: verifier checked $v1n objects, expected >= 399" >&2; exit 1; }
psql "$URL" -At -f "$HERE/production-baseline/census.sql" > /tmp/proof-census-after1.txt
psql "$URL" -At -f "$HERE/production-baseline/digests.sql" > /tmp/proof-dig-after1.txt

echo "== 4b. no CHECK weakened against production =="
# A rewritten CHECK is the one statement here that can narrow production SILENTLY. `DROP CONSTRAINT
# IF EXISTS` + `ADD CONSTRAINT` succeeds whether the new predicate is weaker or stronger than the old
# one, and a narrowing only surfaces later as a 23514 on a value production used to accept — after
# the migration is in the chain and, per CLAUDE.md, no longer editable. Dropping
# `deposit_reminder_5`/`_6` would break the six-touch $99 recovery cadence exactly that way.
#
# Three assertions, in order. The first two exist because the third — enumerating admitted values —
# is a valid proof for ONE predicate shape only.
psql "$URL" -v ON_ERROR_STOP=1 -At -f "$HERE/production-baseline/check-defs.sql" > /tmp/proof-checkdefs-after.txt
psql "$URL" -v ON_ERROR_STOP=1 -At -f "$HERE/production-baseline/check-sets.sql"  > /tmp/proof-checks-after.txt
[ -s /tmp/proof-checkdefs-after.txt ] || { echo "FAIL: post-wave CHECK definition capture is empty" >&2; exit 1; }
[ -s /tmp/proof-checks-after.txt ]    || { echo "FAIL: post-wave CHECK value capture is empty" >&2; exit 1; }

# (i) No CHECK production has may vanish. A constraint dropped and never re-added contributes no
#     values, so the value comparison in (iii) would not notice it going.
cut -d'|' -f1 /tmp/proof-checkdefs-before.txt | sort -u > /tmp/proof-cknames-before.txt
cut -d'|' -f1 /tmp/proof-checkdefs-after.txt  | sort -u > /tmp/proof-cknames-after.txt
vanished=$(comm -23 /tmp/proof-cknames-before.txt /tmp/proof-cknames-after.txt)
if [ -n "$vanished" ]; then
  echo "  VANISHED:"; echo "$vanished" | sed 's/^/    - /'
  echo "FAIL: a CHECK constraint production has is absent after the wave." >&2
  exit 1
fi

# (ii) Enumeration only proves preservation for a finite list of literals. For a range, an
#      arithmetic expression, a conditional or a cross-column relationship it proves nothing: such a
#      predicate contributes no literals, so a narrowing of it reports "nothing lost" in (iii). This
#      schema holds eight such predicates already (the `*_exclusive` pair rules). So: any constraint
#      whose DEFINITION changed must be ENUMERABLE on both sides, or the run stops here and the
#      implication old => new has to be demonstrated explicitly instead.
changed=$(comm -13 <(sort /tmp/proof-checkdefs-before.txt) <(sort /tmp/proof-checkdefs-after.txt)           | cut -d'|' -f1 | sort -u           | comm -12 - /tmp/proof-cknames-before.txt)
if [ -n "$changed" ]; then
  echo "  definitions changed for:"; echo "$changed" | sed 's/^/    ~ /'
  for name in $changed; do
    b=$(grep -F "$name|" /tmp/proof-checkdefs-before.txt | cut -d'|' -f2)
    a=$(grep -F "$name|" /tmp/proof-checkdefs-after.txt  | cut -d'|' -f2)
    if [ "$b" != "ENUMERABLE" ] || [ "$a" != "ENUMERABLE" ]; then
      echo "FAIL: '$name' was rewritten but is not a finite-list predicate (before=$b after=$a)." >&2
      echo "      Enumerating admitted values does not prove preservation for that shape. Demonstrate" >&2
      echo "      the implication old => new explicitly and record it, or do not ship the rewrite." >&2
      exit 1
    fi
  done
  echo "  every rewritten CHECK is a finite-list predicate on both sides — enumeration applies"
else
  echo "  no CHECK definition changed"
fi

# (iii) For those finite lists: every value production admits, the wave must still admit.
lost=$(comm -23 <(sort -u /tmp/proof-checks-before.txt) <(sort -u /tmp/proof-checks-after.txt))
added=$(comm -13 <(sort -u /tmp/proof-checks-before.txt) <(sort -u /tmp/proof-checks-after.txt))
if [ -n "$added" ]; then echo "  ADDED (expected — the wave widens these):"; echo "$added" | sed 's/^/    + /'; fi
if [ -n "$lost" ]; then
  echo "  LOST:"; echo "$lost" | sed 's/^/    - /'
  echo "FAIL: a CHECK stopped admitting a value production admits. That is a silent production" >&2
  echo "      narrowing, and CLAUDE.md forbids editing an applied migration to correct it." >&2
  exit 1
fi
echo "  no admitted value lost — every rewritten CHECK is a superset of production's"

echo "== 4c. the deploy-time preflight parses and honours its contract =="
# `preflight.sql` runs read-only against PRODUCTION before `prisma migrate deploy`. Running it here
# proves only that it is valid SQL and emits its CHECKED row; the baseline carries no rows, so it
# says NOTHING about whether production is clean. That is the point of running it at deploy time.
pf=$(psql "$URL" -v ON_ERROR_STOP=1 -At -F'|' -f "$HERE/preflight.sql")
echo "$pf"
echo "$pf" | grep -q '^CHECKED|' || { echo "FAIL: preflight.sql produced no CHECKED row — it did not run" >&2; exit 1; }

echo "== 4d. the enforcement objects BEHAVE, not merely exist =="
# `verify.sql` is structurally blind to this class. Two defects in an earlier draft of this wave
# passed all of its assertions and were found only by executing a DELETE: a bare `ON DELETE SET NULL`
# on a COMPOSITE key nulled the parent's PRIMARY KEY, and the append-only trigger caught the
# referential SET NULL a parent's deletion issues, making every request and deal holding a snapshot
# undeletable. `behaviour.sql` exercises both paths and the rest of the enforcement objects, inside a
# transaction this script ROLLBACKs, so the proof database is unchanged by it.
bh=$({ echo "BEGIN;"; cat "$HERE/behaviour.sql"; echo "ROLLBACK;"; } | psql "$URL" -v ON_ERROR_STOP=1 -At -F"|")
echo "$bh"
if echo "$bh" | grep -q "^FAILED|"; then echo "FAIL: an enforcement object does not behave as specified" >&2; exit 1; fi
echo "$bh" | grep -q "^CHECKED|" || { echo "FAIL: behaviour.sql produced no CHECKED row - it did not run" >&2; exit 1; }
bhn=$(echo "$bh" | grep '^CHECKED|' | cut -d'|' -f3)
[ "${bhn:-0}" -ge 11 ] || { echo "FAIL: behaviour.sql exercised $bhn behaviours, expected >= 11" >&2; exit 1; }

echo "== 5. apply both directories AGAIN (idempotency) =="
for d in 20261106000000_transaction_spine_enums 20261106000100_transaction_spine_foundation; do
  { echo "BEGIN;"; cat "$HERE/$d/migration.sql"; echo "COMMIT;"; } | psql "$URL" -v ON_ERROR_STOP=1 -q
  echo "  re-applied $d"
done

echo "== 6. verify again; census and object definitions must be unchanged =="
v2=$(psql "$URL" -v ON_ERROR_STOP=1 -At -F'|' -f "$HERE/verify.sql")
echo "$v2"
if echo "$v2" | grep -q '^MISSING|'; then echo "FAIL: expected objects missing after second apply" >&2; exit 1; fi
echo "$v2" | grep -q '^TOTAL|' || { echo "FAIL: verifier produced no TOTAL row on the second run — it did not run" >&2; exit 1; }
psql "$URL" -At -f "$HERE/production-baseline/census.sql" > /tmp/proof-census-after2.txt
psql "$URL" -At -f "$HERE/production-baseline/digests.sql" > /tmp/proof-dig-after2.txt
diff /tmp/proof-census-after1.txt /tmp/proof-census-after2.txt || { echo "FAIL: census drifted on re-apply" >&2; exit 1; }
diff /tmp/proof-dig-after1.txt   /tmp/proof-dig-after2.txt   || { echo "FAIL: object definitions changed on re-apply" >&2; exit 1; }

echo "== 7. rollback.sql returns the schema to production's exact shape =="
# The reversal half of the wave, proven the same way the wave itself is: by running it. A rollback
# file that has never been executed is a comment. This restores a SECOND copy of the baseline, applies
# both directories, runs `rollback.sql`, and requires the resulting catalogue to be byte-identical to
# the untouched baseline - every table, column and its type, index definition, constraint definition,
# trigger, function, RLS flag and enum TYPE.
#
# The one documented exception is enum LABELS: PostgreSQL has no `ALTER TYPE ... DROP VALUE`, so the
# labels directory 1 adds to pre-existing types survive the rollback. That is a property of the wave
# (section 8.2), and it is reported rather than asserted away.
RBDB="${DB}_rb"
case "$RBDB" in autolenis_prodbase_rb|autolenis_e2e*) ;; *) echo "REFUSED: rollback db name '$RBDB'" >&2; exit 2 ;; esac
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$RBDB\";" -c "CREATE DATABASE \"$RBDB\";"
RBURL="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/${RBDB}"
for f in "$HERE"/production-baseline/[0-9]*.sql; do psql "$RBURL" -v ON_ERROR_STOP=1 -q -f "$f"; done
census_all() {
  psql "$1" -v ON_ERROR_STOP=1 -At -c "
select 'T:'||tablename from pg_tables where schemaname='public'
union all select 'C:'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'-') from information_schema.columns where table_schema='public'
union all select 'I:'||indexdef from pg_indexes where schemaname='public'
union all select 'K:'||c.conname||' '||pg_get_constraintdef(c.oid) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'
union all select 'G:'||tgname from pg_trigger where not tgisinternal
union all select 'F:'||p.proname from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public'
union all select 'R:'||c2.relname from pg_class c2 join pg_namespace n3 on n3.oid=c2.relnamespace where n3.nspname='public' and c2.relrowsecurity
union all select 'Y:'||t.typname from pg_type t join pg_namespace n4 on n4.oid=t.typnamespace where n4.nspname='public' and t.typtype='e'" | sort
}
census_all "$RBURL" > /tmp/proof-rb-baseline.txt
rb_n=$(wc -l < /tmp/proof-rb-baseline.txt)
# A capture that comes back short has not measured the schema it claims to have measured - the same
# silent-empty failure the CHECK captures above are guarded against.
[ "$rb_n" -ge 4000 ] || { echo "FAIL: rollback baseline census returned $rb_n rows, expected >= 4000" >&2; exit 1; }
for d in 20261106000000_transaction_spine_enums 20261106000100_transaction_spine_foundation; do
  { echo "BEGIN;"; cat "$HERE/$d/migration.sql"; echo "COMMIT;"; } | psql "$RBURL" -v ON_ERROR_STOP=1 -q
done
psql "$RBURL" -v ON_ERROR_STOP=1 -q -f "$HERE/rollback.sql"
census_all "$RBURL" > /tmp/proof-rb-after.txt
if ! diff /tmp/proof-rb-baseline.txt /tmp/proof-rb-after.txt; then
  echo "FAIL: rollback.sql did not return the schema to production's shape." >&2; exit 1
fi
echo "  rollback verified: $rb_n objects identical to the untouched baseline"
echo "  enum labels remaining after rollback: $(psql "$RBURL" -At -c "select count(*) from pg_enum") (labels cannot be dropped)"

echo
echo "PROOF PASSED - applied twice from production's physical schema, all expected objects present,"
echo "no CHECK narrowed against production, census and object definitions identical across both"
echo "applications."
