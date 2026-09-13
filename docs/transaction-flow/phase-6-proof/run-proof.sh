#!/usr/bin/env bash
# Phase 6 migration proof.
#
# WHAT THIS PROVES: that 20261115000000_phase6_relaunch_partial_unique applies cleanly on top of
# the full repository migration chain, produces every object verify.sql expects, REMOVES the
# absolute unique it replaces, is IDEMPOTENT (a second application changes no object), and leaves
# the drift gate at its pinned baseline. It additionally proves the BEHAVIOUR the ruling turns on,
# which no schema assertion can: that a second ORIGINAL auction on one deposit is still refused,
# and that a relaunch on that same deposit is now accepted.
#
# WHAT IT DOES NOT PROVE:
#   - Anything about production's own physical state. This starts from an EMPTY database replayed
#     through the chain, which is what CI's `migrations` job does.
#   - Anything on PostgreSQL 17.6 unless you run it there. See the version banner below: this
#     script records the server version it actually ran on and does NOT pretend to one it did not
#     see. Owner ruling 2026-09-13: run on what is available, record it, mark it DEGRADED, do not
#     approximate. CI's `migrations` job is the authority for 17.x, as it was for migration 110.
#
# SAFETY: destructive (it DROPs and CREATEs a database) and therefore refuses to run against
# anything but a loopback server and a database name it created itself. It never touches
# production and never reads a production DSN.
set -euo pipefail

PGHOST_="${PROOF_HOST:-127.0.0.1}"
PGPORT_="${PROOF_PORT:-55432}"
PGUSER_="${PROOF_USER:-pgtest}"
DB="${PROOF_DB:-autolenis_chain}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/../../../frontend" && pwd)"
MIG="20261115000000_phase6_relaunch_partial_unique"

case "$PGHOST_" in
  127.0.0.1|::1|localhost) ;;
  *) echo "REFUSED: proof host must be loopback, got '$PGHOST_'" >&2; exit 2 ;;
esac
case "$DB" in
  autolenis_chain|autolenis_prodbase|autolenis_e2e*) ;;
  *) echo "REFUSED: proof database must be autolenis_chain, autolenis_prodbase or autolenis_e2e*, got '$DB'" >&2; exit 2 ;;
esac

ADMIN="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/postgres"
URL="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/${DB}"

ver=$(psql "$ADMIN" -X -P pager=off -At -c "select current_setting('server_version')")
echo "== server_version=$ver =="
case "$ver" in
  17.*) echo "   matches production's major version" ;;
  *)    echo "   DEGRADED: production runs PostgreSQL 17.x. This run is $ver, so it proves the DDL,"
        echo "   the behaviour and the idempotency but NOT 17.x-specific behaviour. Every statement"
        echo "   here (ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX ... WHERE, DROP INDEX IF EXISTS)"
        echo "   is invariant across 11-17, and partial-index NULL handling has been unchanged since"
        echo "   long before 15 made NULLS NOT DISTINCT an option — but the 17.6 run is CI's"
        echo "   \`migrations\` job on the pull request, not this script."
        echo "   PostgreSQL 17.6 was not obtainable in the authoring session: only 16.x is installed,"
        echo "   the Docker daemon is unavailable, and apt.postgresql.org is policy-denied by the"
        echo "   egress proxy (403 on CONNECT). Recorded rather than approximated." ;;
esac

echo
echo "== 1. empty database =="
psql "$ADMIN" -X -P pager=off -q -c "DROP DATABASE IF EXISTS \"$DB\";" -c "CREATE DATABASE \"$DB\";"

echo "== 2. apply the chain UP TO BUT NOT INCLUDING Phase 6 =="
STAGE="$(mktemp -d)"
mv "$APP/prisma/migrations/$MIG" "$STAGE/"
restore() { mv "$STAGE/$MIG" "$APP/prisma/migrations/" 2>/dev/null || true; }
trap restore EXIT

( cd "$APP" && DATABASE_URL="$URL" DIRECT_URL="$URL" pnpm exec prisma migrate deploy >/tmp/phase6-chain-before.log 2>&1 ) \
  || { echo "FAIL: the chain did not apply before Phase 6"; tail -30 /tmp/phase6-chain-before.log; exit 1; }
echo "   chain applied: $(psql "$URL" -X -P pager=off -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null") migrations"

echo "== 2b. PREFLIGHT — every row must read CHECKED =="
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" -f "$HERE/preflight.sql" | tee /tmp/phase6-preflight.txt
test -s /tmp/phase6-preflight.txt || { echo "FAIL: preflight produced no output (it did not run)"; exit 1; }
if grep -q 'BLOCK' /tmp/phase6-preflight.txt; then
  echo; echo "FAIL: preflight reports a BLOCK"; exit 1
fi
echo "   preflight clean"

echo "== 2c. BEFORE snapshot: the Phase 6 objects must be MISSING and the absolute unique PRESENT =="
psql "$URL" -X -P pager=off -At -f "$HERE/verify.sql" > /tmp/phase6-verify-before.txt
test -s /tmp/phase6-verify-before.txt || { echo "FAIL: verify.sql produced no output before the migration"; exit 1; }
for obj in 'auctions.relaunched_at' 'auctions.relaunch_count' \
           'index auctions_deposit_id_original_key' 'index auctions_original_auction_id_key'; do
  if grep -F "$obj|" /tmp/phase6-verify-before.txt | grep -q '|PRESENT|'; then
    echo "FAIL: '$obj' is already PRESENT before the migration — the before state is not clean"; exit 1
  fi
done
# The inverted assertion runs the other way before the migration: the absolute index still exists,
# so "is REMOVED" must read MISSING here. Asserting it proves the assertion itself is live rather
# than vacuously passing.
grep -F 'index auctions_deposit_id_key is REMOVED|' /tmp/phase6-verify-before.txt | grep -q '|MISSING|' \
  || { echo "FAIL: the absolute unique was already gone before the migration"; exit 1; }
echo "   every Phase 6 object confirmed absent, and the index it replaces confirmed present"

echo "== 3. apply Phase 6 =="
restore; trap - EXIT
( cd "$APP" && DATABASE_URL="$URL" DIRECT_URL="$URL" pnpm exec prisma migrate deploy >/tmp/phase6-apply.log 2>&1 ) \
  || { echo "FAIL: Phase 6 did not apply"; tail -40 /tmp/phase6-apply.log; exit 1; }
grep -E "$MIG|migration.* applied" /tmp/phase6-apply.log | tail -3 || true

echo "== 4. verify — physical schema =="
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -At -f "$HERE/verify.sql" > /tmp/phase6-verify-after.txt
test -s /tmp/phase6-verify-after.txt || { echo "FAIL: verify.sql produced no output"; exit 1; }
awk -F'|' '{ printf "   %-8s %-72s %s\n", $2, $1, substr($3,1,60) }' /tmp/phase6-verify-after.txt
if grep -q '|MISSING|' /tmp/phase6-verify-after.txt; then
  echo; echo "FAIL: at least one expected object is MISSING:"; grep '|MISSING|' /tmp/phase6-verify-after.txt; exit 1
fi
echo "   all $(wc -l < /tmp/phase6-verify-after.txt) assertions PRESENT"

echo "== 5. verify — _prisma_migrations =="
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -f "$HERE/ledger.sql" | tee /tmp/phase6-ledger.txt
if grep -q 'REPORT' /tmp/phase6-ledger.txt; then
  echo; echo "FAIL: the ledger reports a problem"; exit 1
fi

echo "== 6. BEHAVIOUR — the ruling, not just the DDL =="
# A schema assertion cannot tell you the predicate is the RIGHT one. These four inserts can:
# a second original must be refused, a relaunch must be accepted, and a second relaunch on the
# same parent must be refused. Run against real rows in a transaction that is rolled back.
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -f "$HERE/behaviour.sql" | tee /tmp/phase6-behaviour.txt
test -s /tmp/phase6-behaviour.txt || { echo "FAIL: behaviour.sql produced no output"; exit 1; }
if grep -q 'FAIL' /tmp/phase6-behaviour.txt; then
  echo; echo "FAIL: a behaviour assertion did not hold"; exit 1
fi
echo "   every behaviour assertion held"

echo "== 7. idempotency: re-apply the migration BY HAND and prove the no-op =="
digest() {
  psql "$URL" -X -P pager=off -At -c "
    SELECT md5(string_agg(sig, E'\n' ORDER BY sig)) FROM (
      SELECT 'col:' || table_name || '.' || column_name || ':' || data_type
             || ':' || is_nullable || ':' || coalesce(column_default, '-') AS sig
        FROM information_schema.columns WHERE table_schema = 'public'
      UNION ALL
      SELECT 'idx:' || indexname || ':' || indexdef FROM pg_indexes WHERE schemaname = 'public'
      UNION ALL
      SELECT 'con:' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
    ) s"
}
d1=$(digest)
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -q -f "$APP/prisma/migrations/$MIG/migration.sql" \
  || { echo "FAIL: re-applying the migration errored — it is not idempotent"; exit 1; }
d2=$(digest)
echo "   digest before re-apply: $d1"
echo "   digest after  re-apply: $d2"
[ "$d1" = "$d2" ] || { echo "FAIL: re-applying the migration CHANGED the schema — not a no-op"; exit 1; }
echo "   identical — the migration is idempotent"

echo "== 8. verify again after the re-apply =="
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -At -f "$HERE/verify.sql" > /tmp/phase6-verify-reapply.txt
if grep -q '|MISSING|' /tmp/phase6-verify-reapply.txt; then
  echo "FAIL: an object went MISSING after the re-apply"; grep '|MISSING|' /tmp/phase6-verify-reapply.txt; exit 1
fi
diff -q /tmp/phase6-verify-after.txt /tmp/phase6-verify-reapply.txt >/dev/null \
  && echo "   verification output byte-identical across the re-apply" \
  || { echo "FAIL: verification output changed across the re-apply"; diff /tmp/phase6-verify-after.txt /tmp/phase6-verify-reapply.txt || true; exit 1; }

echo "== 9. ROLLBACK rehearsal — and its stated precondition =="
# rollback.sql is safe only while no relaunch exists. Prove BOTH directions: it applies cleanly on
# the untouched database, and the forward migration then re-applies on top of it.
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -q -f "$APP/prisma/migrations/$MIG/rollback.sql" \
  || { echo "FAIL: rollback.sql errored on a database with no relaunch"; exit 1; }
psql "$URL" -X -P pager=off -At -c "SELECT CASE WHEN count(*)=1 THEN 'ok' ELSE 'FAIL' END FROM pg_indexes WHERE schemaname='public' AND indexname='auctions_deposit_id_key'" | grep -q ok \
  || { echo "FAIL: rollback did not restore the absolute unique"; exit 1; }
echo "   rollback restored auctions_deposit_id_key"
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -q -f "$APP/prisma/migrations/$MIG/migration.sql" \
  || { echo "FAIL: the forward migration does not re-apply after a rollback"; exit 1; }
d3=$(digest)
[ "$d1" = "$d3" ] || { echo "FAIL: rollback then re-apply did not return the schema to its post-migration state"; exit 1; }
echo "   forward migration re-applied after rollback; schema digest identical — the revert path is round-trip clean"

echo "== 10. drift gate — the chain must still match schema.prisma =="
( cd "$APP" && DATABASE_URL="$URL" DIRECT_URL="$URL" pnpm exec tsx scripts/check-migration-drift.ts 2>&1 | tail -12 ) \
  || { echo "FAIL: drift gate"; exit 1; }

echo
echo "== PHASE 6 MIGRATION PROOF: PASS on PostgreSQL $ver =="
echo "   preflight -> apply -> verify (physical + ledger) -> behaviour -> re-apply -> no-op -> verify"
echo "   -> rollback -> re-apply -> digest identical -> drift at baseline"
