#!/usr/bin/env bash
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
