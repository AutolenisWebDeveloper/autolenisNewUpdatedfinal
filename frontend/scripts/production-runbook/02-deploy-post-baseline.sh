#!/usr/bin/env bash
# ############################################################################
# ⛔ DO NOT RUN — part of a runbook whose premise is INVALID (2026-08-29)
# ############################################################################
# See scripts/production-runbook/RUNBOOK.md for the full findings.
#
# Its premise was disproven on 2026-08-29. Production is ALREADY baselined
# (67 migrations recorded), so `migrate deploy` no longer refuses with P3005 —
# it would proceed and APPLY the 31 unrecorded migrations, INCLUDING the
# owner-gated 20261014/20261015. Those are deliberately unapplied pending
# attorney/compliance review (lib/services/esign/esign-schema-gate.ts). Applying
# them would create e_sign_envelope_history and
# e_sign_envelopes.executed_document_key against an unreviewed consent policy.
#
# This is now MORE dangerous than when the runbook was written, not less.
# ############################################################################

if [[ "${AUTOLENIS_RUNBOOK_OVERRIDE:-}" != "i-have-corrected-this" ]]; then
  cat >&2 <<'STOP'
REFUSING TO RUN: 02-deploy-post-baseline.sh is disabled.

The production runbook's premise was disproven on 2026-08-29 — production is
already baselined (67 migrations recorded). Read
scripts/production-runbook/RUNBOOK.md before doing anything else.
STOP
  exit 2
fi

# STEP 2 — apply the executable tail of the chain, then prove a no-op re-run.
#
# After step 1, `prisma migrate deploy` applies only the migrations >= the
# cutoff: the functional reconciliation (20261017 — every statement guarded; on
# a schema-correct database its ONLY effect is ENABLE ROW LEVEL SECURITY on
# amips_intelligence_snapshots), the shape-guarded orphan retirement (20261018 —
# a CRM-shaped `conversations` table is untouched, verified branch by branch),
# and everything newer, which was authored under the CI from-zero gate.
#
# Usage:  scripts/production-runbook/02-deploy-post-baseline.sh <database-url> --yes
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${1:?usage: 02-deploy-post-baseline.sh <database-url> --yes}"

if [[ "${2:-}" != "--yes" ]]; then
  echo "DRY RUN (no --yes): would run 'prisma migrate deploy' and would apply:"
  # `migrate status` exits 1 when unapplied migrations exist — that is the
  # normal dry-run situation, not a failure, so don't let pipefail surface it.
  DATABASE_URL="$DB" DIRECT_URL="$DB" pnpm exec prisma migrate status 2>&1 \
    | sed -n '/have not yet been applied/,$p' || true
  exit 0
fi

DATABASE_URL="$DB" DIRECT_URL="$DB" pnpm exec prisma migrate deploy
echo "== re-running deploy: must be a no-op"
DATABASE_URL="$DB" DIRECT_URL="$DB" pnpm exec prisma migrate deploy | grep -E "No pending migrations" \
  || { echo "ERROR: second deploy was not a no-op — STOP and investigate"; exit 1; }
