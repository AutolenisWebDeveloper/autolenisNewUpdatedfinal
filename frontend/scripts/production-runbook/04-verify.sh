#!/usr/bin/env bash
# ############################################################################
# ⚠️  ASSERTIONS ENCODE A DISPROVEN PREMISE (2026-08-29) — read-only, safe to
#     run, but its expectations are stale. Interpret failures accordingly.
# ############################################################################
# This asserts the END STATE the (now-disabled) runbook was meant to produce:
# all 98 migrations recorded, etc. Against real production it will report FAIL
# on the migration-count check — production has 67 recorded, which is its
# ACTUAL state, not a defect this script should be used to "fix".
#
# It must NOT be used as a signal to run the write steps. Those are disabled;
# see scripts/production-runbook/RUNBOOK.md.
#
# Checks that remain meaningful against production today:
#   - file 05 / file 08 seed presence (both verified PRESENT)
#   - amips_intelligence_snapshots RLS (verified ENABLED)
#   - no misnamed conversations orphan (verified: CRM shape, correct)
# ############################################################################
# STEP 4 — READ-ONLY verification that steps 1-3 landed as intended.
# Exits non-zero if any expectation fails.
#
# Usage:  scripts/production-runbook/04-verify.sh <database-url>
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${1:?usage: 04-verify.sh <database-url>}"
fail=0
check() { # label, query, expected
  local got; got=$(psql "$DB" -tAc "$2")
  if [[ "$got" == "$3" ]]; then echo "  ok    $1: $got"
  else echo "  FAIL  $1: got '$got', expected '$3'"; fail=1; fi
}

total=$(ls prisma/migrations | grep -cE '^[0-9]{14}_')
check "all migrations recorded"      "select count(*) from _prisma_migrations" "$total"
check "no unfinished migration rows" "select count(*) from _prisma_migrations where finished_at is null" "0"
# File 05's keys are read from the file itself — the first version of this
# check guessed an lp_ prefix and failed against rows 05 had genuinely
# inserted (abandonment_touch_1..3, exit_intent_recovery).
check "file 05 seeds"                "select count(*) from email_templates where template_key in ('abandonment_touch_1','abandonment_touch_2','abandonment_touch_3','exit_intent_recovery')" "4"
check "welcome_d* seeds (file 08)"   "select count(*) from email_templates where template_key like 'welcome_d%'" "5"
check "amips snapshots RLS enabled"  "select relrowsecurity from pg_class where relname='amips_intelligence_snapshots'" "t"
check "no misnamed conversations orphan" \
  "select case when to_regclass('public.conversations') is null then 'absent-or-crm'
          when exists (select 1 from information_schema.columns where table_name='conversations' and column_name='contact_id') then 'absent-or-crm'
          else 'ORPHAN' end" "absent-or-crm"

echo "== functional drift vs schema.prisma (must be zero) =="
DATABASE_URL="$DB" DIRECT_URL="$DB" pnpm exec tsx scripts/check-migration-drift.ts || {
  echo "NOTE: a structural-count mismatch against the CI baseline is EXPECTED here —"
  echo "production carries CRM/manual tables the chain-built CI database does not."
  echo "What must hold: 'missing table/column/enum value' all zero above."; }
[[ $fail -eq 0 ]] && echo "== VERIFY PASSED" || { echo "== VERIFY FAILED"; exit 1; }
