#!/usr/bin/env bash
# Baseline freshness check — is the committed production-baseline still a faithful
# copy of production's physical schema, or has production drifted away from it?
#
# WHY THIS EXISTS: `run-proof.sh` proves the Phase 1 migrations apply cleanly to the
# COMMITTED baseline. That proof is only as good as the baseline's resemblance to the
# real database. Nothing else in this repository notices when production changes
# underneath it, so a stale baseline would keep proving a migration against a schema
# production no longer has — and the proof would stay green while doing it.
#
# WHAT IT COMPARES: the eight full-definition digests and the object census, computed
# by production-baseline/digests.sql and production-baseline/census.sql — the SAME
# files run-proof.sh uses, invoked here rather than reimplemented, so the two can
# never drift apart. A digest is an md5 over sorted object DEFINITIONS, not counts, so
# it catches a changed column default or a rewritten policy that a count would miss.
#
# WHY IT IS NOT A CI GATE: this needs a production credential, and no usable
# DATABASE_URL secret is configured for this repository (`pnpm db:report-target`
# reports `configured: no … classification: UNUSABLE`). Wiring one into CI to automate
# this would put a production credential into the CI environment, which is a worse
# trade than running it by hand. It is therefore a MANUAL PRE-DEPLOY step. See the
# README section "Baseline freshness".
#
# SAFETY
#   * Production is opened READ-ONLY (default_transaction_read_only=on) and only ever
#     queried through the two committed .sql files, both of which are pure SELECTs
#     over pg_catalog / information_schema.
#   * No DSN, user, or password is ever printed. Output is scrubbed before display.
#   * The scratch restore is destructive and so refuses any host but loopback and any
#     database name it did not create itself — the same guards as run-proof.sh.
#
# USAGE
#   PROD_READONLY_URL='postgresql://…' docs/transaction-flow/phase-1-proof/check-baseline-freshness.sh
#
# EXIT CODES
#   0  baseline is fresh — all eight digests match production
#   1  DRIFT — at least one digest diverged; the report names which and by how many objects
#   2  refused / misconfigured — nothing was compared
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PGHOST_="${PROOF_HOST:-127.0.0.1}"
PGPORT_="${PROOF_PORT:-55432}"
PGUSER_="${PROOF_USER:-pgtest}"
DB="${PROOF_DB:-autolenis_freshness}"

# --- refuse before doing anything ------------------------------------------------
if [ -z "${PROD_READONLY_URL:-}" ]; then
  cat >&2 <<'EOF'
REFUSED: PROD_READONLY_URL is not set.

This check needs a READ-ONLY connection string for the production database. It is
deliberately a separate variable from DATABASE_URL so that the application's
read-write DSN is never used here by accident.

Nothing was compared. Set PROD_READONLY_URL and run again.
EOF
  exit 2
fi

# Everything printed goes through this, so a DSN can never reach the terminal or a log
# even if psql decides to quote it back at us in an error.
scrub() { sed -e "s|${PROD_READONLY_URL//|/\\|}|<PROD_DSN_REDACTED>|g" -e 's|postgres\(ql\)\{0,1\}://[^ ]*|<DSN_REDACTED>|g'; }

case "$PGHOST_" in
  127.0.0.1|::1|localhost) ;;
  *) echo "REFUSED: scratch restore host must be loopback, got '$PGHOST_'" >&2; exit 2 ;;
esac
case "$DB" in
  autolenis_freshness|autolenis_prodbase|autolenis_e2e*) ;;
  *) echo "REFUSED: scratch database must be autolenis_freshness, autolenis_prodbase or autolenis_e2e*, got '$DB'" >&2; exit 2 ;;
esac

ADMIN="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/postgres"
SCRATCH="postgresql://${PGUSER_}@${PGHOST_}:${PGPORT_}/${DB}"

# --- 0. fail fast BEFORE touching production -------------------------------------
# Both halves are needed for a comparison, so if the scratch server is missing there is
# nothing to compare against and no reason to open a production connection at all.
scratch_ver="$(psql "$ADMIN" -At -c "select current_setting('server_version')" 2>/dev/null)" || {
  echo "REFUSED: no PostgreSQL server on ${PGHOST_}:${PGPORT_}. The committed baseline must be restored somewhere to compute its digests, so there is nothing to compare against. Start a 17.x server and run again. Production was NOT contacted." >&2
  exit 2; }
case "$scratch_ver" in
  17.*) ;;
  *) echo "REFUSED: the scratch server is $scratch_ver; production is 17.x. Restoring the baseline on a different major would change its digests and report drift that is not drift. Production was NOT contacted." >&2; exit 2 ;;
esac
echo "scratch server_version    = $scratch_ver"

# --- 1. production, read-only ----------------------------------------------------
# statement_timeout keeps a pathological catalog scan from hanging a manual run;
# default_transaction_read_only makes a stray write impossible rather than merely
# unlikely.
export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=120000"

prod_ver="$(psql "$PROD_READONLY_URL" -At -c "select current_setting('server_version')" 2>&1 | scrub)" || {
  echo "FAILED: could not query production (see scrubbed error above)." >&2; exit 2; }
echo "production server_version = $prod_ver"
case "$prod_ver" in
  17.*) ;;
  *) echo "REFUSED: production is expected to be PostgreSQL 17.x, got '$prod_ver'. Digests are major-version sensitive; comparing across majors would report drift that is not drift." >&2; exit 2 ;;
esac

# `|| true` so a psql failure does not abort under `set -e` before the explicit
# emptiness check below can report it. The check, not the exit status, is what decides:
# psql's own error text lands in the file, where the grep will not find a digest.
{ psql "$PROD_READONLY_URL" -At -f "$HERE/production-baseline/digests.sql" 2>&1 || true; } | scrub | tr '|' '\n' | sed '/^$/d' | sort > /tmp/freshness-prod-digests.txt
{ psql "$PROD_READONLY_URL" -At -f "$HERE/production-baseline/census.sql"  2>&1 || true; } | scrub | sed '/^$/d' | sort > /tmp/freshness-prod-census.txt
unset PGOPTIONS

grep -q '^tables_d=' /tmp/freshness-prod-digests.txt || {
  echo "FAILED: production returned no digests — the query did not run. Nothing was compared." >&2
  echo "--- scrubbed output ---" >&2; cat /tmp/freshness-prod-digests.txt >&2; exit 2; }
grep -q '^tables=' /tmp/freshness-prod-census.txt || {
  echo "FAILED: production returned no census — the query did not run. Nothing was compared." >&2
  echo "--- scrubbed output ---" >&2; cat /tmp/freshness-prod-census.txt >&2; exit 2; }

# --- 2. the committed baseline, restored into a scratch database -----------------
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$DB\";" -c "CREATE DATABASE \"$DB\";"
for f in "$HERE"/production-baseline/[0-9]*.sql; do
  psql "$SCRATCH" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$SCRATCH" -At -f "$HERE/production-baseline/digests.sql" | tr '|' '\n' | sed '/^$/d' | sort > /tmp/freshness-base-digests.txt
psql "$SCRATCH" -At -f "$HERE/production-baseline/census.sql"  | sed '/^$/d' | sort > /tmp/freshness-base-census.txt

# --- 3. compare ------------------------------------------------------------------
val() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2-; }
# Numeric read. A census key that is absent or non-numeric yields 0 rather than an empty
# operand, which would otherwise make the cons_d sum below a bash syntax error and abort
# the whole run under `set -e` — turning a reportable anomaly into a crash.
nval() { local v; v="$(val "$1" "$2")"; case "$v" in ''|*[!0-9]*) echo 0 ;; *) echo "$v" ;; esac; }
# Census categories behind each digest, so a divergence can be quantified rather than
# merely announced. Constraints are the sum of four census rows.
census_for() {
  local file="$1" key="$2"
  case "$key" in
    tables_d) nval "$file" tables ;;
    cols_d)   nval "$file" columns ;;
    idx_d)    nval "$file" indexes ;;
    enums_d)  nval "$file" enum_labels ;;
    trg_d)    nval "$file" triggers ;;
    pol_d)    nval "$file" policies ;;
    fn_d)     nval "$file" functions ;;
    cons_d)   echo $(( $(nval "$file" pk) + $(nval "$file" unique) + $(nval "$file" check) + $(nval "$file" fk) )) ;;
  esac
}
label_for() {
  case "$1" in
    tables_d) echo "tables" ;;      cols_d) echo "columns" ;;
    idx_d)    echo "indexes" ;;     cons_d) echo "constraints (pk+unique+check+fk)" ;;
    enums_d)  echo "enum labels" ;; trg_d)  echo "triggers" ;;
    pol_d)    echo "policies" ;;    fn_d)   echo "functions" ;;
  esac
}

echo
echo "=== baseline freshness: committed production-baseline vs live production ==="
diverged=0
for k in tables_d cols_d idx_d cons_d enums_d trg_d pol_d fn_d; do
  b="$(val /tmp/freshness-base-digests.txt "$k")"
  p="$(val /tmp/freshness-prod-digests.txt "$k")"
  if [ -z "$b" ] || [ -z "$p" ]; then
    printf '  %-8s INCONCLUSIVE — digest missing on one side\n' "$k"; diverged=$((diverged+1)); continue
  fi
  if [ "$b" = "$p" ]; then
    printf '  %-8s match\n' "$k"
  else
    diverged=$((diverged+1))
    bc="$(census_for /tmp/freshness-base-census.txt "$k")"
    pc="$(census_for /tmp/freshness-prod-census.txt "$k")"
    delta=$(( pc - bc ))
    if [ "$delta" -eq 0 ]; then
      # The important case people misread: same number of objects, different definitions.
      printf '  %-8s DIVERGED — %s: %s in both, so no object was added or removed; a DEFINITION changed.\n' \
        "$k" "$(label_for "$k")" "$pc"
    else
      printf '  %-8s DIVERGED — %s: baseline %s, production %s (%+d)\n' \
        "$k" "$(label_for "$k")" "$bc" "$pc" "$delta"
    fi
  fi
done

echo
if [ "$diverged" -eq 0 ]; then
  echo "BASELINE FRESH — all 8 digests match production. The committed baseline is still a"
  echo "faithful copy of production's physical schema, so the Phase 1 proof is running against"
  echo "the schema production actually has."
  exit 0
fi

cat <<EOF
BASELINE STALE — $diverged of 8 digests diverged.

Production has changed since production-baseline/ was captured. Until the baseline is
recaptured, run-proof.sh proves the Phase 1 migrations against a schema production no
longer has, and its green result does not mean what it appears to mean.

Full census difference (baseline -> production):
EOF
diff /tmp/freshness-base-census.txt /tmp/freshness-prod-census.txt || true
exit 1
