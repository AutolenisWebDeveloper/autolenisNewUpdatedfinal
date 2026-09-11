#!/usr/bin/env bash
# Phase 5 migration proof.
#
# WHAT THIS PROVES: that 20261113000000_phase5_sourcing_invitations applies cleanly on top
# of the full repository migration chain, produces every object verify.sql expects, and is
# IDEMPOTENT — a second application is a no-op that changes no object.
#
# WHAT IT DOES NOT PROVE:
#   - Anything about production's own physical state. This starts from an EMPTY database
#     replayed through the chain, which is what CI's `migrations` job does. The
#     production-physical-schema restore is phase-1-proof/run-proof.sh and is a different
#     question; Phase 5 touches no object whose production shape differs from the chain's
#     (the owner's 2026-09-11 census confirmed sourcing_candidates, identity_firewall_entries
#     and the Phase 1 auction_invitations columns all exist in production).
#   - Anything on PostgreSQL 17.6 unless you run it there. See PG_MAJOR below: this script
#     records the server version it actually ran on and does NOT pretend to a version it
#     did not see.
#
# SAFETY: destructive (it DROPs and CREATEs a database) and therefore refuses to run
# against anything but a loopback server and a database name it created itself. It never
# touches production and never reads a production DSN.
set -euo pipefail

PGHOST_="${PROOF_HOST:-127.0.0.1}"
PGPORT_="${PROOF_PORT:-55432}"
PGUSER_="${PROOF_USER:-pgtest}"
DB="${PROOF_DB:-autolenis_chain}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/../../../frontend" && pwd)"

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

ver=$(psql "$ADMIN" -At -c "select current_setting('server_version')")
echo "== server_version=$ver =="
case "$ver" in
  17.*) echo "   matches production's major version" ;;
  *)    echo "   NOTE: production runs PostgreSQL 17.x. This run is $ver, so it proves the"
        echo "   DDL and the idempotency but NOT 17.x-specific behaviour. Every statement in"
        echo "   this migration (ADD COLUMN IF NOT EXISTS, ALTER COLUMN SET/DROP NOT NULL,"
        echo "   SET DEFAULT, UPDATE, CREATE [UNIQUE] INDEX IF NOT EXISTS) is invariant across"
        echo "   11-17, and NULLS DISTINCT has been the unique-index default since long before"
        echo "   15 made NULLS NOT DISTINCT an option — but the 17.6 run is CI's"
        echo "   \`migrations\` job on the pull request, not this script." ;;
esac

echo
echo "== 1. empty database =="
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$DB\";" -c "CREATE DATABASE \"$DB\";"

echo "== 2. apply the chain UP TO BUT NOT INCLUDING Phase 5 =="
# The predecessor state. Moving the Phase 5 directory aside is how the "before" snapshot is
# taken without editing any file: `migrate deploy` applies whatever directories it finds.
STAGE="$(mktemp -d)"
mv "$APP/prisma/migrations/20261113000000_phase5_sourcing_invitations" "$STAGE/"
restore_phase5() { mv "$STAGE/20261113000000_phase5_sourcing_invitations" "$APP/prisma/migrations/" 2>/dev/null || true; }
trap restore_phase5 EXIT

( cd "$APP" && DATABASE_URL="$URL" DIRECT_URL="$URL" pnpm exec prisma migrate deploy >/tmp/phase5-chain-before.log 2>&1 ) \
  || { echo "FAIL: the chain did not apply before Phase 5"; tail -30 /tmp/phase5-chain-before.log; exit 1; }
echo "   chain applied: $(psql "$URL" -At -c "select count(*) from _prisma_migrations where finished_at is not null") migrations"

echo "== 2b. BEFORE snapshot: the five objects must all be MISSING =="
psql "$URL" -At -f "$HERE/verify.sql" > /tmp/phase5-verify-before.txt
test -s /tmp/phase5-verify-before.txt || { echo "FAIL: verify.sql produced no output before the migration (it did not run)"; exit 1; }
before_present=$(grep -c '|PRESENT|' /tmp/phase5-verify-before.txt || true)
before_missing=$(grep -c '|MISSING|' /tmp/phase5-verify-before.txt || true)
echo "   before: $before_present PRESENT / $before_missing MISSING"
# Not an equality assertion: a handful of verify.sql rows are "this Phase 1 object still
# exists" and "no NULL row", which are legitimately PRESENT before Phase 5 runs. What must
# hold is that the Phase 5 objects themselves are absent.
for obj in initiator_role after_paid_auction 'identity_firewall_entries.auction_id' \
           'apollo_reveals.sourcing_case_id' \
           'unique sourcing_candidates_sourcing_case_id_rooftop_id_key'; do
  if grep -F "$obj" /tmp/phase5-verify-before.txt | grep -q '|PRESENT|'; then
    echo "FAIL: '$obj' is already PRESENT before the migration — the before state is not clean"
    exit 1
  fi
done
echo "   every Phase 5 object confirmed absent beforehand"

# RLS enable-state, captured BEFORE. The migration claims RLS is untouched; "untouched" is
# a comparison, not an absolute, because the enable-state differs per table and production's
# own state is part of the known structural drift. Asserting a fixed expectation here is
# what an earlier draft did, and it failed on the expectation rather than on the migration.
rls_state() {
  psql "$URL" -v ON_ERROR_STOP=1 -At -c "
    SELECT c.relname || ':rls=' || c.relrowsecurity::text || ':policies=' ||
           (SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname)::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('circumvention_attempts', 'identity_firewall_entries',
                         'apollo_reveals', 'sourcing_candidates', 'auction_invitations')
     ORDER BY c.relname"
}
rls_state > /tmp/phase5-rls-before.txt
test -s /tmp/phase5-rls-before.txt || { echo "FAIL: RLS capture produced no output"; exit 1; }
echo "   RLS state captured before: $(tr '\n' ' ' < /tmp/phase5-rls-before.txt)"

echo "== 3. restore Phase 5 and apply it =="
restore_phase5; trap - EXIT
( cd "$APP" && DATABASE_URL="$URL" DIRECT_URL="$URL" pnpm exec prisma migrate deploy >/tmp/phase5-apply.log 2>&1 ) \
  || { echo "FAIL: Phase 5 did not apply"; tail -40 /tmp/phase5-apply.log; exit 1; }
grep -E "20261113000000|migration.* applied" /tmp/phase5-apply.log | tail -3 || true

echo "== 4. verify — physical schema =="
psql "$URL" -v ON_ERROR_STOP=1 -At -f "$HERE/verify.sql" > /tmp/phase5-verify-after.txt
test -s /tmp/phase5-verify-after.txt || { echo "FAIL: verify.sql produced no output (it did not run)"; exit 1; }
awk -F'|' '{ printf "   %-8s %-76s %s\n", $2, $1, $3 }' /tmp/phase5-verify-after.txt
if grep -q '|MISSING|' /tmp/phase5-verify-after.txt; then
  echo; echo "FAIL: at least one expected object is MISSING:"
  grep '|MISSING|' /tmp/phase5-verify-after.txt
  exit 1
fi
echo "   all $(wc -l < /tmp/phase5-verify-after.txt) assertions PRESENT"

echo "== 4b. RLS untouched — the comparison, not an absolute =="
rls_state > /tmp/phase5-rls-after.txt
test -s /tmp/phase5-rls-after.txt || { echo "FAIL: RLS capture produced no output after the migration"; exit 1; }
if diff -u /tmp/phase5-rls-before.txt /tmp/phase5-rls-after.txt; then
  echo "   identical: $(tr '\n' ' ' < /tmp/phase5-rls-after.txt)"
else
  echo "FAIL: the migration changed RLS enable-state or policy count"; exit 1
fi

echo "== 5. verify — _prisma_migrations =="
psql "$URL" -v ON_ERROR_STOP=1 -f "$HERE/ledger.sql" | tee /tmp/phase5-ledger.txt
if grep -q 'REPORT' /tmp/phase5-ledger.txt; then
  echo; echo "FAIL: the ledger reports a problem"; exit 1
fi

echo "== 6. idempotency: re-apply the migration BY HAND and prove the no-op =="
# `migrate deploy` would skip an already-recorded migration, which proves nothing about the
# SQL. Running the file directly is what proves `IF NOT EXISTS` and the backfill are
# genuinely repeatable. A catalog digest either side is the evidence.
digest() {
  psql "$URL" -At -c "
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
psql "$URL" -v ON_ERROR_STOP=1 -q -f "$APP/prisma/migrations/20261113000000_phase5_sourcing_invitations/migration.sql" \
  || { echo "FAIL: re-applying the migration errored — it is not idempotent"; exit 1; }
d2=$(digest)
echo "   digest before re-apply: $d1"
echo "   digest after  re-apply: $d2"
[ "$d1" = "$d2" ] || { echo "FAIL: re-applying the migration CHANGED the schema — not a no-op"; exit 1; }
echo "   identical — the migration is idempotent"

echo "== 7. verify again after the re-apply =="
psql "$URL" -v ON_ERROR_STOP=1 -At -f "$HERE/verify.sql" > /tmp/phase5-verify-reapply.txt
if grep -q '|MISSING|' /tmp/phase5-verify-reapply.txt; then
  echo "FAIL: an object went MISSING after the re-apply"; grep '|MISSING|' /tmp/phase5-verify-reapply.txt; exit 1
fi
diff -q /tmp/phase5-verify-after.txt /tmp/phase5-verify-reapply.txt >/dev/null \
  && echo "   verification output byte-identical across the re-apply" \
  || { echo "FAIL: verification output changed across the re-apply"; diff /tmp/phase5-verify-after.txt /tmp/phase5-verify-reapply.txt || true; exit 1; }

echo "== 8. drift gate — the chain must still match schema.prisma =="
( cd "$APP" && DATABASE_URL="$URL" DIRECT_URL="$URL" pnpm exec tsx scripts/check-migration-drift.ts 2>&1 | tail -12 ) \
  || { echo "FAIL: drift gate"; exit 1; }

echo
echo "== PHASE 5 MIGRATION PROOF: PASS on PostgreSQL $ver =="
echo "   apply -> verify (physical + ledger) -> re-apply -> no-op -> verify -> drift at baseline"
