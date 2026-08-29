#!/usr/bin/env bash
# STEP 0 — READ-ONLY inspection. Captures production's actual state before
# anything is changed, and produces the artifacts the later steps and the
# structural-drift decision need. Safe to run any number of times.
#
# Usage:  scripts/production-runbook/00-inspect.sh "$PROD_DATABASE_URL"
# Output: scripts/production-runbook/out/<UTC timestamp>/
set -euo pipefail
cd "$(dirname "$0")/../.."   # frontend/

DB="${1:?usage: 00-inspect.sh <database-url> — refusing to guess a target}"
OUT="scripts/production-runbook/out/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"

echo "== inspecting (read-only) -> $OUT"

psql "$DB" -tA >"$OUT/summary.txt" <<'SQL'
select 'public tables:            ' || count(*) from information_schema.tables where table_schema='public';
select '_prisma_migrations:       ' || coalesce(to_regclass('public._prisma_migrations')::text, 'ABSENT');
select 'recorded migrations:      ' || coalesce((select count(*)::text from _prisma_migrations), 'n/a');
select 'unfinished migration rows:' || coalesce((select count(*)::text from _prisma_migrations where finished_at is null), 'n/a');
select 'email_templates rows:     ' || coalesce((select count(*)::text from email_templates), 'TABLE ABSENT');
select 'file 05 seeds:            ' || coalesce((select count(*)::text from email_templates where template_key in ('abandonment_touch_1','abandonment_touch_2','abandonment_touch_3','exit_intent_recovery')), 'n/a');
select 'welcome_d* seeds (08):    ' || coalesce((select count(*)::text from email_templates where template_key like 'welcome_d%'), 'n/a');
select 'amips snapshots RLS:      ' || coalesce((select relrowsecurity::text from pg_class where relname='amips_intelligence_snapshots'), 'TABLE ABSENT');
select 'conversations shape:      ' || case
  when to_regclass('public.conversations') is null then 'ABSENT'
  when exists (select 1 from information_schema.columns where table_name='conversations' and column_name='contact_id') then 'CRM (expected in production)'
  when exists (select 1 from information_schema.columns where table_name='conversations' and column_name='session_id') then 'MISNAMED ACQUISITION ORPHAN — 20261018 will retire it'
  else 'UNKNOWN — inspect manually before proceeding' end;
select 'ACTIVE impersonations:    ' || coalesce((select count(*)::text from admin_impersonations where status='ACTIVE'), 'n/a');
SQL
cat "$OUT/summary.txt"

# Full schema for the record (objects only, no data).
pg_dump "$DB" --schema-only --no-owner --no-privileges >"$OUT/schema.sql" 2>/dev/null
echo "schema dump: $OUT/schema.sql ($(wc -l <"$OUT/schema.sql") lines)"

# The REAL production drift against schema.prisma — the artifact the
# 352-structural-statement decision has been waiting for. Read-only.
pnpm exec prisma migrate diff --from-url "$DB" --to-schema-datamodel prisma/schema.prisma --script \
  >"$OUT/drift-vs-schema.sql" 2>&1 || true
echo "drift vs schema.prisma: $OUT/drift-vs-schema.sql ($(grep -cE '^(CREATE|ALTER|DROP)' "$OUT/drift-vs-schema.sql" || true) DDL statements)"

# Stale ACTIVE impersonation sessions (Batch 3 tightened the role; sessions
# opened before that merge may be stranded ACTIVE). Listing only — closing is
# an owner decision, see 05-close-stale-impersonations.sql.
psql "$DB" -c "select id, admin_id, target_user_id, started_at, now()-started_at as open_for
               from admin_impersonations where status='ACTIVE' order by started_at" \
  >"$OUT/active-impersonations.txt" 2>&1 || true

echo "== inspection complete; nothing was modified"
