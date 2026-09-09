#!/usr/bin/env bash
# Phase 3 migration proof, run against a PostgreSQL 17.6 restore of production's PHYSICAL schema.
#
# WHAT THIS PROVES: that 20261111000000_deposit_status_disputed applies cleanly on top of the real
# chain, adds exactly the one label it claims, is idempotent, and changes nothing else.
#
# WHAT IT DOES NOT PROVE: anything about `_prisma_migrations`. The restore carries no ledger, by
# design -- ledger correctness is a separate question and is NOT addressed here.
#
# WHY IT IS NOT phase-1-proof/run-proof.sh: that script hard-codes the two Phase 1 directory names in
# both of its apply loops and floors its CHECK captures at Phase 1's counts. It is Phase 1's evidence
# and is left alone. This one applies the Phase 1 wave FROM THE REPOSITORY (not from the copies under
# phase-1-proof/) so that what is proved is the chain as committed.
#
# SAFETY: destructive (DROPs and CREATEs a database), so it refuses anything but a loopback server and
# a database name it created itself. It never touches production and never reads a production DSN.
set -euo pipefail

PGHOST_="${PROOF_HOST:-127.0.0.1}"
PGPORT_="${PROOF_PORT:-55432}"
PGUSER_="${PROOF_USER:-pgtest}"
DB="${PROOF_DB:-autolenis_p3proof}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
BASE="$HERE/../phase-1-proof/production-baseline"
MIGS="$REPO/frontend/prisma/migrations"

case "$PGHOST_" in
  127.0.0.1|::1|localhost) ;;
  *) echo "REFUSED: proof host must be loopback, got '$PGHOST_'" >&2; exit 2 ;;
esac
case "$DB" in
  autolenis_p3proof|autolenis_e2e*) ;;
  *) echo "REFUSED: proof database must be autolenis_p3proof or autolenis_e2e*, got '$DB'" >&2; exit 2 ;;
esac

ADMIN="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/postgres"
URL="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/${DB}"

ver=$(psql "$ADMIN" -At -c "select current_setting('server_version')")
case "$ver" in
  17.*) ;;
  *) echo "REFUSED: production runs PostgreSQL 17.x; this server is $ver. Do not substitute another major version." >&2; exit 2 ;;
esac
echo "server_version=$ver"
echo "migrations   =$MIGS"

WAVE1="20261106000000_transaction_spine_enums 20261106000100_transaction_spine_foundation"
CHAIN="20261110000000_claim_token_purpose 20261111000000_deposit_status_disputed"

labels() { psql "$URL" -v ON_ERROR_STOP=1 -At -c \
  "select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='DepositStatus';"; }
digest() { psql "$URL" -v ON_ERROR_STOP=1 -At -f "$BASE/digests.sql"; }
labelcount() { psql "$URL" -v ON_ERROR_STOP=1 -At -c "select count(*) from pg_enum;"; }
# Everything digests.sql measures EXCEPT the enum digest. `enums_d` is the one field this migration
# is supposed to move, and step 4 already proves it moved by exactly one label; comparing it here
# would fail every correct run. Stripping it is what keeps step 5 a real assertion about tables,
# columns, indexes, constraints, triggers, policies and functions rather than a tautology.
nonenum() { digest | sed -E 's/\|?enums_d=[0-9a-f]*//'; }

apply() { # apply <dir>  -- one transaction, exactly as Prisma does
  { echo "BEGIN;"; cat "$MIGS/$1/migration.sql"; echo "COMMIT;"; } | psql "$URL" -v ON_ERROR_STOP=1 -q
}

echo "== 1. restore production physical schema =="
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$DB\";" -c "CREATE DATABASE \"$DB\";"
for f in "$BASE"/[0-9]*.sql; do psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"; done

BEFORE_LABELS="$(labels)"
echo "  DepositStatus at baseline: $BEFORE_LABELS"
[ -n "$BEFORE_LABELS" ] || { echo "FAIL: baseline label capture returned nothing -- it did not run" >&2; exit 1; }
case "$BEFORE_LABELS" in
  *DISPUTED*) echo "FAIL: baseline already carries DISPUTED. This migration would be a no-op and the premise for writing it is wrong." >&2; exit 1 ;;
esac

echo "== 2. apply the Phase 1 wave and the chain up to, but not including, this phase =="
for d in $WAVE1 20261110000000_claim_token_purpose; do apply "$d"; echo "  applied $d"; done
PRE_LABELS="$(labels)"; PRE_DIGEST="$(nonenum)"; PRE_ENUMS="$(labelcount)"
echo "  DepositStatus before this phase: $PRE_LABELS"
case "$PRE_LABELS" in
  *DISPUTED*) echo "FAIL: an earlier migration already added DISPUTED -- this directory is a duplicate" >&2; exit 1 ;;
esac
[ -n "$PRE_DIGEST" ] || { echo "FAIL: pre-apply digest capture returned nothing" >&2; exit 1; }

echo "== 3. apply 20261111000000_deposit_status_disputed =="
apply 20261111000000_deposit_status_disputed
POST_LABELS="$(labels)"; POST_ENUMS="$(labelcount)"
echo "  DepositStatus after: $POST_LABELS"

echo "== 4. verify: exactly one label added, and it is the right one =="
case "$POST_LABELS" in
  "${PRE_LABELS},DISPUTED") echo "  PASS: DISPUTED appended, prior labels unchanged and in order" ;;
  *) echo "FAIL: expected '${PRE_LABELS},DISPUTED', got '$POST_LABELS'" >&2; exit 1 ;;
esac
[ "$((POST_ENUMS - PRE_ENUMS))" -eq 1 ] || { echo "FAIL: enum label count moved by $((POST_ENUMS - PRE_ENUMS)), expected exactly 1" >&2; exit 1; }
echo "  PASS: exactly one enum label added across the whole database ($PRE_ENUMS -> $POST_ENUMS)"

echo "== 5. verify: nothing else changed (every digest except the enum one) =="
POST_DIGEST="$(nonenum)"
if [ "$PRE_DIGEST" = "$POST_DIGEST" ]; then
  echo "  PASS: table, column, index, constraint, trigger, policy and function digests identical before and after"
else
  echo "FAIL: this migration changed an object other than the enum:" >&2
  diff <(echo "$PRE_DIGEST") <(echo "$POST_DIGEST") >&2 || true
  exit 1
fi

echo "== 6. re-apply; prove the no-op =="
apply 20261111000000_deposit_status_disputed
RE_LABELS="$(labels)"; RE_DIGEST="$(nonenum)"; RE_ENUMS="$(labelcount)"
[ "$RE_LABELS" = "$POST_LABELS" ] || { echo "FAIL: re-apply changed the label set" >&2; exit 1; }
[ "$RE_ENUMS"  = "$POST_ENUMS" ]  || { echo "FAIL: re-apply changed the enum label count" >&2; exit 1; }
[ "$RE_DIGEST" = "$POST_DIGEST" ] || { echo "FAIL: re-apply changed an object" >&2; exit 1; }
echo "  PASS: second apply is a no-op (NOTICE only); labels, counts and digests identical"

echo "== 7. the constraint that forced its own directory =="
# Proof, not assertion: a new label cannot be USED in the transaction that added it. If this ever
# stops being true the comment in migration.sql is wrong and should be corrected, so it is checked.
set +e
OUT=$(psql "$URL" -v ON_ERROR_STOP=1 -q 2>&1 <<'SQL'
BEGIN;
ALTER TYPE "DepositStatus" ADD VALUE IF NOT EXISTS 'PROOF_ONLY_NEVER_COMMITTED';
SELECT 'PROOF_ONLY_NEVER_COMMITTED'::"DepositStatus";
ROLLBACK;
SQL
)
set -e
case "$OUT" in
  *"unsafe use of new value"*) echo "  PASS: 55P04 confirmed -- a new label cannot be used in the transaction that added it, which is why this migration ships alone" ;;
  *) echo "FAIL: expected 55P04 unsafe_use_of_new_value_of_enum_type; got: $OUT" >&2; exit 1 ;;
esac
FINAL="$(labels)"
[ "$FINAL" = "$POST_LABELS" ] || { echo "FAIL: step 7 leaked a label into the type: $FINAL" >&2; exit 1; }
echo "  PASS: step 7 left no residue ($FINAL)"

echo
echo "PROOF PASSED - applied twice on top of the committed chain from production's physical schema."
echo "Exactly one enum label added (DISPUTED), no other object changed, second apply a clean no-op."
