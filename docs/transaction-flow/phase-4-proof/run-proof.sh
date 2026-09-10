#!/usr/bin/env bash
# Phase 4 migration proof, run against a restore of production's PHYSICAL schema.
#
# WHAT THIS PROVES: that 20261112000000_stage4_trade_election applies cleanly on top of the real
# committed chain, adds exactly the one column it claims to `vehicle_requests`, adds it as
# NULLABLE with no default, is idempotent, and changes nothing else in the database.
#
# WHAT IT DOES NOT PROVE: anything about `_prisma_migrations`. The restore carries no ledger, by
# design. Nor does it prove the deploy ORDER; that is a property of the running application, and
# migration.sql states it in prose with the six unnarrowed reads enumerated.
#
# ON THE SERVER MAJOR -- READ THIS BEFORE TRUSTING THE RESULT.
#
# The runbook requires PostgreSQL 17.6, production's own version, and phase-3-proof/run-proof.sh
# hard-refuses anything else. That refusal is correct and is NOT relaxed here: this is a separate
# harness for a separate migration, and Phase 3's is untouched.
#
# This session cannot obtain a 17.x server. The environment's network policy denies every
# postgresql.org host (apt./www./ftp. all fail CONNECT with 403 through the agent proxy), so the
# PGDG repository is unreachable and only the preinstalled 16.13 exists. Rather than skip the
# proof or edit a guard to get past it, this harness accepts 16 or 17, PRINTS which it ran on, and
# marks the run DEGRADED when it is not 17.
#
# Why 16 is defensible EVIDENCE for THIS migration, and where it would not be:
#
#   The whole file is `ALTER TABLE ... ADD COLUMN IF NOT EXISTS <name> BOOLEAN`. That statement's
#   semantics -- nullable, no default, no rewrite, no lock beyond ACCESS EXCLUSIVE for the catalog
#   update, IF NOT EXISTS as a NOTICE-only no-op -- are identical from 9.6 through 17. There is no
#   17-only behaviour for it to depend on. The production baseline itself was synthesised with a
#   16.13 client (production-baseline/00-header.sql:3-5), so 16 is the version that generated the
#   file being restored.
#
#   It would NOT be defensible for the Phase 1 wave: enum labels inside a transaction (55P04),
#   partial unique indexes validated against data, and plpgsql triggers are all places where a
#   major-version difference could plausibly bite. This migration contains none of them.
#
# So: a PASS on 16.13 is real evidence about this statement and is reported as such. It is NOT the
# 17.6 run the runbook asks for, and the STOP 2 report says so in those words.
#
# SAFETY: destructive (DROPs and CREATEs a database), so it refuses anything but a loopback server
# and a database name it created itself. It never touches production and never reads a production
# DSN.
set -euo pipefail

PGHOST_="${PROOF_HOST:-127.0.0.1}"
PGPORT_="${PROOF_PORT:-55432}"
PGUSER_="${PROOF_USER:-pgtest}"
DB="${PROOF_DB:-autolenis_p4proof}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
BASE="$HERE/../phase-1-proof/production-baseline"
MIGS="$REPO/frontend/prisma/migrations"
THIS="20261112000000_stage4_trade_election"

case "$PGHOST_" in
  127.0.0.1|::1|localhost) ;;
  *) echo "REFUSED: proof host must be loopback, got '$PGHOST_'" >&2; exit 2 ;;
esac
case "$DB" in
  autolenis_p4proof|autolenis_e2e*) ;;
  *) echo "REFUSED: proof database must be autolenis_p4proof or autolenis_e2e*, got '$DB'" >&2; exit 2 ;;
esac

ADMIN="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/postgres"
URL="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/${DB}"

ver=$(psql "$ADMIN" -At -c "select current_setting('server_version')")
DEGRADED=0
case "$ver" in
  17.*) echo "server_version=$ver  (matches production)" ;;
  16.*) DEGRADED=1
        echo "server_version=$ver  ** DEGRADED: production runs 17.x. See the header for why a 16.x"
        echo "                        run is evidence for THIS migration and what it does not cover. **" ;;
  *)    echo "REFUSED: expected PostgreSQL 16.x or 17.x, got $ver." >&2; exit 2 ;;
esac
echo "migrations   =$MIGS"

# The full committed chain from the baseline forward, in lexical order, ending with this phase's.
CHAIN="20261106000000_transaction_spine_enums \
       20261106000100_transaction_spine_foundation \
       20261110000000_claim_token_purpose \
       20261111000000_deposit_status_disputed"

digest()  { psql "$URL" -v ON_ERROR_STOP=1 -At -f "$BASE/digests.sql"; }
colcount() { psql "$URL" -v ON_ERROR_STOP=1 -At -c \
  "select count(*) from information_schema.columns where table_schema='public' and table_name='vehicle_requests';"; }
# Everything digests.sql measures EXCEPT the column digest. `cols_d` is the one field this
# migration is supposed to move, and step 4 already proves it moved by exactly one column;
# comparing it here would fail every correct run. The other seven -- tables, indexes,
# constraints, enums, triggers, policies, functions -- must be byte-identical.
#
# The field is `cols_d`, not `columns_d`: production-baseline/digests.sql names it that. Getting
# it wrong makes this step compare the full string INCLUDING the field that is supposed to move,
# so it fails every run -- which is how the mistake was caught on the first execution rather than
# silently passing. A filter that strips a field that does not exist is the safer failure of the
# two, but it is still a bug, so the name is pinned by an assertion below.
noncol()  { digest | sed -E 's/\|?cols_d=[0-9a-f]*//'; }
tradecol() { psql "$URL" -v ON_ERROR_STOP=1 -At -c \
  "select coalesce((select is_nullable||'|'||data_type||'|'||coalesce(column_default,'NODEFAULT')
     from information_schema.columns
    where table_schema='public' and table_name='vehicle_requests' and column_name='trade_elected'),'ABSENT');"; }

apply() { # apply <dir>  -- one transaction, exactly as Prisma does
  { echo "BEGIN;"; cat "$MIGS/$1/migration.sql"; echo "COMMIT;"; } | psql "$URL" -v ON_ERROR_STOP=1 -q
}

echo "== 1. restore production physical schema =="
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$DB\";" -c "CREATE DATABASE \"$DB\";"
for f in "$BASE"/[0-9]*.sql; do psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
BASE_TRADE="$(tradecol)"
[ "$BASE_TRADE" = "ABSENT" ] || { echo "FAIL: the baseline already carries trade_elected ($BASE_TRADE). The premise for writing this migration is wrong." >&2; exit 1; }
echo "  PASS: baseline restored, vehicle_requests has no trade_elected"

echo "== 2. apply the committed chain up to, but not including, this phase =="
for d in $CHAIN; do apply "$d"; echo "  applied $d"; done
PRE_TRADE="$(tradecol)"; PRE_DIGEST="$(noncol)"; PRE_COLS="$(colcount)"
# The filter must actually have removed something, or step 6 is comparing the field it is
# supposed to ignore and would fail on every correct run (or, worse under a future edit, compare
# nothing and pass on every run).
case "$(digest)" in
  *cols_d=*) ;;
  *) echo "FAIL: digests.sql no longer emits a 'cols_d' field — step 6's filter is blind." >&2; exit 1 ;;
esac
case "$PRE_DIGEST" in
  *cols_d=*) echo "FAIL: the noncol filter did not strip cols_d — step 6 would compare the field this migration is meant to move." >&2; exit 1 ;;
  "") echo "FAIL: the noncol filter stripped everything." >&2; exit 1 ;;
esac
[ "$PRE_TRADE" = "ABSENT" ] || { echo "FAIL: an earlier migration already added trade_elected -- this directory is a duplicate" >&2; exit 1; }
[ -n "$PRE_DIGEST" ] || { echo "FAIL: pre-apply digest capture returned nothing -- it did not run" >&2; exit 1; }
echo "  vehicle_requests columns before: $PRE_COLS"

echo "== 3. apply $THIS =="
apply "$THIS"
POST_TRADE="$(tradecol)"; POST_COLS="$(colcount)"
echo "  trade_elected after: $POST_TRADE"

echo "== 4. verify: exactly one column added, nullable, boolean, no default =="
[ "$POST_TRADE" = "YES|boolean|NODEFAULT" ] || {
  echo "FAIL: expected 'YES|boolean|NODEFAULT' (nullable three-state election), got '$POST_TRADE'." >&2
  echo "      A DEFAULT would record every existing buyer as having answered a question nobody asked them." >&2
  exit 1; }
[ "$((POST_COLS - PRE_COLS))" -eq 1 ] || { echo "FAIL: vehicle_requests column count moved by $((POST_COLS - PRE_COLS)), expected exactly 1" >&2; exit 1; }
echo "  PASS: exactly one column added ($PRE_COLS -> $POST_COLS), nullable boolean with no default"

echo "== 5. verify: every existing row reads NULL, not false =="
NONNULL=$(psql "$URL" -v ON_ERROR_STOP=1 -At -c "select count(*) from \"vehicle_requests\" where \"trade_elected\" is not null;")
[ "$NONNULL" = "0" ] || { echo "FAIL: $NONNULL rows already carry a non-NULL election" >&2; exit 1; }
echo "  PASS: 0 rows carry an election — NULL is 'not asked yet', which is what ELECTIONS_REQUIRED fires on"

echo "== 6. verify: nothing else changed (every digest except the column one) =="
POST_DIGEST="$(noncol)"
if [ "$PRE_DIGEST" = "$POST_DIGEST" ]; then
  echo "  PASS: table, index, constraint, trigger, policy, function and enum digests identical before and after"
else
  echo "FAIL: this migration changed an object other than the column:" >&2
  diff <(echo "$PRE_DIGEST") <(echo "$POST_DIGEST") >&2 || true
  exit 1
fi

echo "== 7. re-apply; prove the no-op =="
apply "$THIS"
RE_TRADE="$(tradecol)"; RE_DIGEST="$(noncol)"; RE_COLS="$(colcount)"
[ "$RE_TRADE"  = "$POST_TRADE" ]  || { echo "FAIL: re-apply changed the column definition" >&2; exit 1; }
[ "$RE_COLS"   = "$POST_COLS" ]   || { echo "FAIL: re-apply changed the column count" >&2; exit 1; }
[ "$RE_DIGEST" = "$POST_DIGEST" ] || { echo "FAIL: re-apply changed an object" >&2; exit 1; }
echo "  PASS: second apply is a no-op (NOTICE only); definition, counts and digests identical"

echo "== 8. the deploy-order hazard, demonstrated rather than asserted =="
# migration.sql claims an application that selects trade_elected against an unmigrated database
# fails with 42703. Prove the error code rather than trusting the prose -- the sibling migration's
# header was wrong about exactly this class of claim.
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"${DB}_pre\";" -c "CREATE DATABASE \"${DB}_pre\";"
PRE_URL="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/${DB}_pre"
for f in "$BASE"/[0-9]*.sql; do psql "$PRE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
for d in $CHAIN; do { echo "BEGIN;"; cat "$MIGS/$d/migration.sql"; echo "COMMIT;"; } | psql "$PRE_URL" -v ON_ERROR_STOP=1 -q; done
set +e
OUT=$(psql "$PRE_URL" -v ON_ERROR_STOP=1 -q -c 'SELECT "id","trade_elected" FROM "vehicle_requests" LIMIT 1;' 2>&1)
set -e
case "$OUT" in
  *'column "trade_elected" does not exist'*) echo "  PASS: 42703 undefined_column confirmed — an application deploy that precedes this migration breaks every unnarrowed read of vehicle_requests, including findOpenRequest and therefore buyer checkout" ;;
  *) echo "FAIL: expected 42703 undefined_column on the unmigrated database; got: $OUT" >&2; exit 1 ;;
esac
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"${DB}_pre\";"

echo
if [ "$DEGRADED" -eq 1 ]; then
  echo "PROOF PASSED (DEGRADED: PostgreSQL $ver, not production's 17.6)"
else
  echo "PROOF PASSED (PostgreSQL $ver)"
fi
echo "Applied twice on top of the committed chain from production's physical schema."
echo "Exactly one nullable boolean column added, no other object changed, second apply a clean no-op,"
echo "and the 42703 deploy-order hazard reproduced on an unmigrated copy."
