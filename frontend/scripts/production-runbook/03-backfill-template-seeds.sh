#!/usr/bin/env bash
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
