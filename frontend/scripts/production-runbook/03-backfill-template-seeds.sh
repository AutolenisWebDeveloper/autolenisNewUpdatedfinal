#!/usr/bin/env bash
# ############################################################################
# ⛔ DO NOT RUN — part of a runbook whose premise is INVALID (2026-08-29)
# ############################################################################
# See scripts/production-runbook/RUNBOOK.md for the full findings.
#
# This step is UNNECESSARY. Verified on 2026-08-29: all nine seeds already
# exist in production (abandonment_touch_1..3, exit_intent_recovery,
# welcome_d0/d1/d3/d5/d7; 52 templates total). The premise that files 05/08 never
# applied to production is false. Running it is idempotent and would very likely
# be a no-op, but the runbook it belongs to is disabled — correct the runbook
# first.
# ############################################################################

if [[ "${AUTOLENIS_RUNBOOK_OVERRIDE:-}" != "i-have-corrected-this" ]]; then
  cat >&2 <<'STOP'
REFUSING TO RUN: 03-backfill-template-seeds.sh is disabled.

The production runbook's premise was disproven on 2026-08-29 — production is
already baselined (67 migrations recorded). Read
scripts/production-runbook/RUNBOOK.md before doing anything else.
STOP
  exit 2
fi

# STEP 3 — backfill the email-template seeds production never received.
#
# WHY: migrations/05 (four lp_* LP-recovery templates) carried an ON CONFLICT
# arbiter that can never match its own partial unique index, so it aborted and
# rolled back on EVERY database it ever ran against, production included; 08's
# five welcome_d* templates failed downstream of it. Both files were repaired in
# Batch 7 (PR #360) and are idempotent — ON CONFLICT DO NOTHING against the
# template_key partial index — so on any database that somehow has the rows this
# is a no-op, and elsewhere it inserts exactly the missing nine.
#
# Usage:  scripts/production-runbook/03-backfill-template-seeds.sh <database-url> --yes
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${1:?usage: 03-backfill-template-seeds.sh <database-url> --yes}"
FILES=(migrations/05_lp_recovery_templates.sql migrations/08_nurture_templates_welcome.sql)

before=$(psql "$DB" -tAc "select count(*) from email_templates")
echo "== email_templates before: $before"

if [[ "${2:-}" != "--yes" ]]; then
  echo "DRY RUN (no --yes): would apply, in order:"; printf '  %s\n' "${FILES[@]}"
  exit 0
fi

for f in "${FILES[@]}"; do
  echo "-- applying $f"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
after=$(psql "$DB" -tAc "select count(*) from email_templates")
echo "== email_templates after: $after (delta $((after-before)); expected +9 on first run, +0 on re-run)"
