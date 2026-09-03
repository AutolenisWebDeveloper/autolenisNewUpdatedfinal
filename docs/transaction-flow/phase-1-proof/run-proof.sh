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
psql "$URL" -At -f "$HERE/production-baseline/census.sql" > /tmp/proof-census-after1.txt
psql "$URL" -At -f "$HERE/production-baseline/digests.sql" > /tmp/proof-dig-after1.txt

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

echo
echo "PROOF PASSED — applied twice from production's physical schema, all expected objects present,"
echo "census and object definitions identical across both applications."
