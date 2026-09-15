#!/usr/bin/env bash
# Phase 8 migration proof.
#
# WHAT THIS PROVES: that 20261117000000_phase8_esign_signer_cutover and
# 20261117000100_phase8_funding_clearance apply cleanly on top of the full repository
# migration chain, produce every object verify.sql expects, REMOVE the absolute unique the
# cutover replaces, are IDEMPOTENT, and — the part that matters most for a DESTRUCTIVE
# migration — that the RESTORE PATH actually works.
#
# A guarded "drop what we created" cannot revert a phase that REMOVED a constraint. The
# revert has to RECREATE it, and recreating a UNIQUE index is the one rollback that can fail
# on real data. So step 9 runs it, asserts the index is back, re-applies the forward
# migration on top, and compares schema digests: rollback -> re-apply must return the schema
# byte-for-byte to where it was. Writing that statement and not running it would be the
# silent zero-row result preflight.sql exists to warn about, one level up.
#
# IT ALSO PROVES THE BEHAVIOUR THE RULING TURNS ON, which no schema assertion can: that a
# second BUYER envelope on one deal is still refused after the drop, and that a CO_BUYER
# envelope on that same deal is now accepted. That is the whole point of §13-D30, and an
# index existing is not the same as it enforcing the right thing.
#
# WHAT IT DOES NOT PROVE:
#   - Anything about production's own physical state. This starts from an EMPTY database
#     replayed through the chain, which is what CI's `migrations` job does.
#   - Anything on PostgreSQL 17.6 unless you run it there. The version banner below records
#     the server it ACTUALLY ran on and does not pretend to one it did not see. Owner ruling
#     2026-09-13: run on what is available, record it, mark it DEGRADED, do not approximate.
#     CI's `migrations` job is the authority for 17.x.
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
CUTOVER="20261117000000_phase8_esign_signer_cutover"
CLEARANCE="20261117000100_phase8_funding_clearance"

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
        echo "   the behaviour, the idempotency and the restore path but NOT 17.x-specific behaviour."
        echo "   Every statement here (DROP INDEX IF EXISTS, ADD COLUMN IF NOT EXISTS, CREATE UNIQUE"
        echo "   INDEX IF NOT EXISTS, and the DO-block guards) is invariant across 11-17 — but the"
        echo "   17.6 run is CI's \`migrations\` job on the pull request, not this script."
        echo "   PostgreSQL 17.6 was not obtainable in the authoring session: only 16.x is installed,"
        echo "   the Docker daemon is unavailable (/var/run/docker.sock absent), and apt.postgresql.org"
        echo "   is policy-denied by the egress proxy (403). Recorded rather than approximated." ;;
esac

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

echo
echo "== 1. empty database =="
psql "$ADMIN" -X -P pager=off -q -c "DROP DATABASE IF EXISTS \"$DB\";" -c "CREATE DATABASE \"$DB\";"

echo "== 2. apply the chain UP TO BUT NOT INCLUDING Phase 8 =="
STAGE="$(mktemp -d)"
mv "$APP/prisma/migrations/$CUTOVER" "$STAGE/"
mv "$APP/prisma/migrations/$CLEARANCE" "$STAGE/"
restore() {
  mv "$STAGE/$CUTOVER" "$APP/prisma/migrations/" 2>/dev/null || true
  mv "$STAGE/$CLEARANCE" "$APP/prisma/migrations/" 2>/dev/null || true
}
trap restore EXIT

( cd "$APP" && DATABASE_URL="$URL" DIRECT_URL="$URL" pnpm exec prisma migrate deploy >/tmp/phase8-chain-before.log 2>&1 ) \
  || { echo "FAIL: the chain did not apply before Phase 8"; tail -30 /tmp/phase8-chain-before.log; exit 1; }
echo "   chain applied: $(psql "$URL" -X -P pager=off -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null") migrations"

echo "== 2b. PREFLIGHT — every row must read CHECKED =="
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET TRANSACTION READ ONLY" -f "$HERE/preflight.sql" | tee /tmp/phase8-preflight.txt
test -s /tmp/phase8-preflight.txt || { echo "FAIL: preflight produced no output (it did not run)"; exit 1; }
# The verdict COLUMN is parsed, not the human-readable table grepped for a word. The first
# version of this guard grepped the whole output for "BLOCK" and matched its own explanatory
# text: an assertion LABELLED "(reported, never a BLOCK)" failed the run while every verdict
# read CHECKED. A guard that can fail on its own prose will eventually pass a real fault for
# the same reason, so the column is read rather than the page.
if ! awk -F'|' '{ gsub(/ /, "", $NF); if ($NF == "CHECKED") n++ } END { exit !(n >= 10) }' /tmp/phase8-preflight.txt; then
  echo; echo "FAIL: preflight did not report 10 CHECKED verdicts — it did not run to completion"; exit 1
fi
if awk -F'|' '{ gsub(/ /, "", $NF); if ($NF == "BLOCK") found = 1 } END { exit !found }' /tmp/phase8-preflight.txt; then
  echo; echo "FAIL: preflight reports a BLOCK:"; awk -F'|' '{ v=$NF; gsub(/ /,"",v); if (v=="BLOCK") print }' /tmp/phase8-preflight.txt; exit 1
fi
echo "   preflight clean"

echo "== 2c. BEFORE snapshot: the inverted assertion must read MISSING, and it must be LIVE =="
psql "$URL" -X -P pager=off -At -f "$HERE/verify.sql" > /tmp/phase8-verify-before.txt
test -s /tmp/phase8-verify-before.txt || { echo "FAIL: verify.sql produced no output before the migration"; exit 1; }
# Asserting the inverted row reads MISSING here proves the assertion is LIVE rather than
# vacuously passing — the failure mode a "is it gone?" check has and a "is it there?" does not.
grep -F 'index e_sign_envelopes_deal_id_key is REMOVED|' /tmp/phase8-verify-before.txt | grep -q '|MISSING|' \
  || { echo "FAIL: the absolute unique was already gone before the migration — the before state is not clean"; exit 1; }
for obj in 'financing.lender_conditions_cleared_at' 'financing.down_payment_method' \
           'financing.dealer_funding_confirmed_at' 'financing.funding_recorded_by'; do
  if grep -F "$obj|" /tmp/phase8-verify-before.txt | grep -q '|PRESENT|'; then
    echo "FAIL: '$obj' is already PRESENT before the migration"; exit 1
  fi
done
echo "   before state clean: the index to drop is present, the columns to add are absent"

echo "== 3. apply Phase 8 =="
restore; trap - EXIT
( cd "$APP" && DATABASE_URL="$URL" DIRECT_URL="$URL" pnpm exec prisma migrate deploy >/tmp/phase8-apply.log 2>&1 ) \
  || { echo "FAIL: Phase 8 did not apply"; tail -40 /tmp/phase8-apply.log; exit 1; }
grep -E "$CUTOVER|$CLEARANCE" /tmp/phase8-apply.log | tail -4 || true

echo "== 4. verify — BOTH halves =="
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -At -f "$HERE/verify.sql" > /tmp/phase8-verify-after.txt
test -s /tmp/phase8-verify-after.txt || { echo "FAIL: verify.sql produced no output"; exit 1; }
grep -q 'verify complete' /tmp/phase8-verify-after.txt || { echo "FAIL: verify did not reach its terminal row"; exit 1; }
awk -F'|' '{ printf "   %-8s %-58s %s\n", $2, $1, substr($3,1,70) }' /tmp/phase8-verify-after.txt
if grep -q '|MISSING|' /tmp/phase8-verify-after.txt; then
  echo; echo "FAIL: at least one expected object is MISSING:"; grep '|MISSING|' /tmp/phase8-verify-after.txt; exit 1
fi
echo "   all $(wc -l < /tmp/phase8-verify-after.txt) assertions PRESENT"

echo "== 5. BEHAVIOUR — the ruling, not just the DDL =="
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -f "$HERE/behaviour.sql" | tee /tmp/phase8-behaviour.txt
test -s /tmp/phase8-behaviour.txt || { echo "FAIL: behaviour.sql produced no output"; exit 1; }
if grep -qE '(^|[|[:space:]])FAIL ' /tmp/phase8-behaviour.txt; then
  echo; echo "FAIL: a behaviour assertion did not hold"; exit 1
fi
# COUNT what ran. The first version of this guard trusted the terminal row, and the terminal
# row asserted its own success — so when the fixture's first INSERT violated a NOT NULL and
# aborted the transaction, every assertion was skipped, the terminal row still printed "6
# assertions, all rolled back", and this guard reported "every behaviour assertion held".
# A proof that announces success having proven nothing is worse than no proof at all.
ran=$(grep -cE '(^|[|[:space:]])OK ' /tmp/phase8-behaviour.txt || true)
if [ "$ran" -lt 7 ]; then
  echo; echo "FAIL: only $ran behaviour assertions reported OK (expected 6 + the terminal row)."
  echo "      An aborted transaction skips every assertion and still reaches the end of the file."
  grep -E 'ERROR' /tmp/phase8-behaviour.txt | head -5
  exit 1
fi
echo "   every behaviour assertion RAN and held ($ran OK rows)"

echo "== 6. idempotency: re-apply BOTH migrations BY HAND and prove the no-op =="
d1=$(digest)
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -q -f "$APP/prisma/migrations/$CUTOVER/migration.sql" \
  || { echo "FAIL: re-applying the cutover errored — it is not idempotent"; exit 1; }
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -q -f "$APP/prisma/migrations/$CLEARANCE/migration.sql" \
  || { echo "FAIL: re-applying the clearance columns errored — not idempotent"; exit 1; }
d2=$(digest)
echo "   digest before re-apply: $d1"
echo "   digest after  re-apply: $d2"
[ "$d1" = "$d2" ] || { echo "FAIL: re-applying CHANGED the schema — not a no-op"; exit 1; }
echo "   identical — both migrations are idempotent"

echo "== 7. verify again after the re-apply =="
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -At -f "$HERE/verify.sql" > /tmp/phase8-verify-reapply.txt
diff -q /tmp/phase8-verify-after.txt /tmp/phase8-verify-reapply.txt >/dev/null \
  && echo "   verification output byte-identical across the re-apply" \
  || { echo "FAIL: verification output changed across the re-apply"; diff /tmp/phase8-verify-after.txt /tmp/phase8-verify-reapply.txt || true; exit 1; }

echo "== 8. ROLLBACK REHEARSAL — the part a destructive migration cannot skip =="
# A guarded "drop what we created" cannot revert a phase that REMOVED a constraint. This
# runs the restore, asserts the index is genuinely back, then re-applies the forward
# migration on top and compares digests: the round trip must be exact.
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -q -f "$APP/prisma/migrations/$CUTOVER/rollback.sql" \
  || { echo "FAIL: the cutover rollback errored on a database with no co-buyer envelope"; exit 1; }
psql "$URL" -X -P pager=off -At -c "SELECT CASE WHEN count(*)=1 THEN 'ok' ELSE 'FAIL' END FROM pg_indexes WHERE schemaname='public' AND indexname='e_sign_envelopes_deal_id_key'" | grep -q ok \
  || { echo "FAIL: rollback did not RESTORE e_sign_envelopes_deal_id_key"; exit 1; }
echo "   rollback restored e_sign_envelopes_deal_id_key"

psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -q -f "$APP/prisma/migrations/$CLEARANCE/rollback.sql" \
  || { echo "FAIL: the clearance rollback errored"; exit 1; }
psql "$URL" -X -P pager=off -At -c "SELECT CASE WHEN count(*)=0 THEN 'ok' ELSE 'FAIL' END FROM information_schema.columns WHERE table_schema='public' AND table_name='financing' AND column_name IN ('lender_conditions_cleared_at','down_payment_method','dealer_funding_confirmed_at','funding_recorded_by')" | grep -q ok \
  || { echo "FAIL: the clearance rollback left columns behind"; exit 1; }
echo "   clearance rollback dropped all four columns"

echo "== 9. and the forward migrations re-apply on top of the rollback =="
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -q -f "$APP/prisma/migrations/$CUTOVER/migration.sql" \
  || { echo "FAIL: the cutover does not re-apply after a rollback"; exit 1; }
psql "$URL" -X -P pager=off -v ON_ERROR_STOP=1 -q -f "$APP/prisma/migrations/$CLEARANCE/migration.sql" \
  || { echo "FAIL: the clearance does not re-apply after a rollback"; exit 1; }
d3=$(digest)
[ "$d1" = "$d3" ] || { echo "FAIL: rollback then re-apply did not return the schema to its post-migration state"; exit 1; }
echo "   forward migrations re-applied; schema digest identical — the revert path is round-trip clean"

echo "== 10. drift gate — the chain must still match schema.prisma =="
( cd "$APP" && DATABASE_URL="$URL" DIRECT_URL="$URL" pnpm exec tsx scripts/check-migration-drift.ts 2>&1 | tail -14 ) \
  || { echo "FAIL: drift gate"; exit 1; }

echo
echo "== PHASE 8 MIGRATION PROOF: PASS on PostgreSQL $ver =="
echo "   preflight -> apply -> verify (physical + ledger) -> behaviour -> re-apply -> no-op"
echo "   -> verify -> ROLLBACK -> index restored -> re-apply -> digest identical -> drift at baseline"
