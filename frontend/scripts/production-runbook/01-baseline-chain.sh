#!/usr/bin/env bash
# ############################################################################
# ⛔ DO NOT RUN — PREMISE INVALID as of 2026-08-29
# ############################################################################
#
# A read-only inspection of the live database disproved this script's premise.
# It is disabled below and will refuse to execute until the runbook is corrected.
# See scripts/production-runbook/RUNBOOK.md for the full findings.
#
#   * PREMISE INVALID. This script assumes production is UNBASELINED — no
#     _prisma_migrations table, `migrate deploy` refusing with P3005. Production
#     in fact HAS _prisma_migrations with 67 migrations recorded (67 finished,
#     0 rolled back), most recent applied 2026-08-29 22:01. `migrate deploy`
#     does NOT refuse with P3005. The analogue this was rehearsed against did
#     not represent production, so the rehearsal validated the wrong thing.
#
#   * STEP 1 WOULD ERASE AN OWNER-GATED COMPLIANCE BOUNDARY. The cutoff below
#     (< 20261017000000) sweeps in 20261014000000_esign_envelope_history and
#     20261015000000_esign_consent_and_executed_artifact. Both are verified NOT
#     recorded in production AND their objects verified ABSENT: the
#     e_sign_envelope_history table does not exist, and
#     e_sign_envelopes.executed_document_key does not exist. They are
#     DELIBERATELY unapplied pending attorney/compliance review — see
#     lib/services/esign/esign-schema-gate.ts (ESIGN/UETA legal sufficiency NOT
#     VERIFIED; consent policy blocked). Marking them applied would assert a
#     compliance-blocked migration had shipped and strand the runtime gate that
#     currently keeps esign-artifact-reconcile green.
#
#   * STEP 3 (template seeds) IS UNNECESSARY — all nine seeds exist in
#     production (52 templates total).
#
#   * STEP 5 (impersonations) IS MOOT — admin_impersonations has 0 rows.
#
#   * ENVIRONMENT MISMATCH — the analogue was PostgreSQL 16.4; production is 17.6.
#
#   * DO NOT RUN ANY WRITE STEP until the runbook is corrected: baseline only
#     migrations genuinely applied (verify per-migration, not by timestamp
#     cutoff), explicitly exclude 20261014/20261015 and assert they stay
#     excluded, drop steps 3 and 5, and decide separately whether
#     ai_action_intents is applied or gated the way e-sign is.
#
# ############################################################################

# Hard stop. Removing this block is not enough to make the script correct —
# fix the runbook first. Set AUTOLENIS_RUNBOOK_OVERRIDE=i-have-corrected-this
# only after the premise above has actually been addressed.
if [[ "${AUTOLENIS_RUNBOOK_OVERRIDE:-}" != "i-have-corrected-this" ]]; then
  cat >&2 <<'STOP'
REFUSING TO RUN: 01-baseline-chain.sh is disabled.

Its premise (production is unbaselined) was disproven on 2026-08-29: production
already has _prisma_migrations with 67 migrations recorded. Running this would
falsely record the owner-gated e-sign migrations 20261014 and 20261015 as
applied, erasing a compliance boundary that is pending attorney review.

Read scripts/production-runbook/RUNBOOK.md before doing anything else.
STOP
  exit 2
fi

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
