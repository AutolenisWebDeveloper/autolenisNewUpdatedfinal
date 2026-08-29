#!/usr/bin/env bash
# STEP 1 — record the pre-executable migration history as already applied.
#
# WHY: production was built with `prisma db push` + manual SQL; it has no
# _prisma_migrations table. Running `prisma migrate deploy` against it fails
# PRE-FLIGHT with P3005 ("database schema is not empty") — verified, it changes
# nothing when it refuses. Every migration up to and including 20261016... was
# authored against the live database and cannot re-run from scratch there; the
# migrations AFTER that point (20261017 reconciliation onward) are the ones
# written to be applied, and are proven no-op-or-intended on a production-shaped
# database. So: mark everything <= 20261016 as applied, and let step 2 deploy
# the rest for real.
#
# Idempotent and resumable: migrations already recorded are skipped (a repeated
# `resolve --applied` errors, so we check first).
#
# Usage:  scripts/production-runbook/01-baseline-chain.sh <database-url> --yes
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${1:?usage: 01-baseline-chain.sh <database-url> --yes}"
CUTOFF="20261017000000"   # first migration that step 2 should actually RUN

# No mapfile: the operator's machine may run macOS's default bash 3.2.
TO_BASELINE=()
ALL_N=0
while IFS= read -r m; do
  ALL_N=$((ALL_N+1))
  [[ "${m%%_*}" < "$CUTOFF" ]] && TO_BASELINE+=("$m")
done < <(ls prisma/migrations | grep -E '^[0-9]{14}_' | sort)

echo "== ${#TO_BASELINE[@]} of $ALL_N migrations are pre-cutoff (< $CUTOFF) and will be baselined"

if [[ "${2:-}" != "--yes" ]]; then
  echo "DRY RUN (no --yes): would mark these as applied, skipping any already recorded:"
  printf '  %s\n' "${TO_BASELINE[@]}"
  exit 0
fi

# Which are already recorded? (First run: the table may not exist yet —
# resolve creates it on first use.)
RECORDED="$(psql "$DB" -tAc "select migration_name from _prisma_migrations" 2>/dev/null || true)"

done_n=0; skip_n=0
for m in "${TO_BASELINE[@]}"; do
  if grep -qx "$m" <<<"$RECORDED"; then
    skip_n=$((skip_n+1)); continue
  fi
  DATABASE_URL="$DB" DIRECT_URL="$DB" pnpm exec prisma migrate resolve --applied "$m" >/dev/null
  done_n=$((done_n+1))
done
echo "== baselined $done_n, skipped $skip_n already recorded"
psql "$DB" -tAc "select 'recorded total: ' || count(*) from _prisma_migrations"
