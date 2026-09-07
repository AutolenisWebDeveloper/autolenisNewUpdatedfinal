#!/bin/bash
# Regression tests for the AutoLenis PreToolUse guards.
#
#   bash .claude/hooks/__tests__/guards.test.sh
#
# Three directions matter, not two. A guard that blocks everything is as broken as
# one that blocks nothing, so every DENY case has ALLOW cases around it — and since
# 2026-09-07 the three owner-authorized production operations must come back as
# ASK: never silently allowed, never denied. Run this after any change to either
# guard script.

set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BASH_GUARD="$ROOT/.claude/hooks/guard-destructive.sh"
PATH_GUARD="$ROOT/.claude/hooks/guard-protected-paths.sh"
pass=0; fail=0
GUARD_ENV=""   # extra VAR=value pairs for the guard's environment (deploy-session tests)

payload() { # payload <tool> <key> <value>
  python3 -c 'import json,sys; print(json.dumps({"hook_event_name":"PreToolUse","tool_name":sys.argv[1],"tool_input":{sys.argv[2]:sys.argv[3]}}))' "$1" "$2" "$3"
}

check() { # check <guard> <deny|ask|allow> <payload-json> <label>
  local guard="$1" expect="$2" json="$3" label="$4" out rc got
  # shellcheck disable=SC2086  # GUARD_ENV is a deliberately word-split VAR=value list
  out="$(printf '%s' "$json" | env $GUARD_ENV CLAUDE_PROJECT_DIR="$ROOT" bash "$guard" 2>/dev/null)"
  rc=$?
  if [ "$rc" -eq 2 ]; then got="deny"
  elif printf '%s' "$out" | grep -q '"permissionDecision":"ask"'; then got="ask"
  else got="allow"; fi
  if [ "$got" != "$expect" ]; then
    fail=$((fail+1)); printf 'FAIL  expected=%-5s got=%-5s :: %s\n' "$expect" "$got" "$label"; return
  fi
  if [ "$got" = "allow" ]; then
    # An allow must be SILENT: stray stdout on exit 0 is parsed as a decision.
    if [ -n "$out" ]; then
      fail=$((fail+1)); printf 'FAIL  allow printed output :: %s\n' "$label"; return
    fi
  else
    # A malformed deny/ask is a silently OPEN gate: exit 0 with unreadable JSON lets
    # the call through. Assert the schema, not just the exit code.
    if ! printf '%s' "$out" | python3 -c '
import json,sys
want = sys.argv[1]
h = json.load(sys.stdin)["hookSpecificOutput"]
assert h["hookEventName"] == "PreToolUse"
assert h["permissionDecision"] == want, h["permissionDecision"]
assert isinstance(h["permissionDecisionReason"], str) and h["permissionDecisionReason"]
' "$got" 2>/dev/null; then
      fail=$((fail+1)); printf 'FAIL  malformed %s JSON :: %s\n' "$got" "$label"; return
    fi
  fi
  pass=$((pass+1))
}

cmd()  { check "$BASH_GUARD" "$1" "$(payload Bash command "$2")" "${2:0:96}"; }
file() { check "$PATH_GUARD" "$1" "$(payload Edit file_path "$2")" "$2"; }
nb()   { check "$PATH_GUARD" "$1" "$(payload NotebookEdit notebook_path "$2")" "notebook:$2"; }

# The canonical read-only shape from CLAUDE.md -> Production database access.
RO='psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 --single-transaction -c "SET TRANSACTION READ ONLY"'
PROOF='docs/transaction-flow/phase-1-proof'

echo "== destructive commands: DENY =="
cmd deny 'git reset --hard HEAD~3'
cmd deny 'cd /tmp && git reset --hard HEAD~3'          # compound
cmd deny 'git   reset --hard HEAD~3'                   # extra whitespace
cmd deny 'git -C . reset --hard'                       # option before subcommand
cmd deny 'git -c core.pager=cat reset --hard'
cmd deny 'timeout 30 git reset --hard'                 # wrapper
cmd deny 'echo hi; git merge main'
cmd deny 'git merge main'
cmd deny 'git merge'
cmd deny 'git push --force origin feat'
cmd deny 'git push -f origin feat'
cmd deny 'git push --force-with-lease origin feat'
cmd deny 'git push origin main'                        # protected branch
cmd deny 'git push -u origin HEAD:main'
cmd deny 'supabase db push'
cmd deny 'npx supabase db push'                        # environment runner
cmd deny 'pnpm exec supabase db push'
cmd deny 'npx -y supabase db reset'
cmd deny 'vercel deploy'
cmd deny 'vercel --prod'
cmd deny 'vercel deploy --prod'
cmd deny 'rm -rf /tmp/x'
cmd deny 'rm -fr build'
cmd deny 'FOO=bar rm -rf tmp/'                         # leading assignment
cmd deny 'sudo rm -rf /'
cmd deny 'pnpm exec prisma migrate reset'
cmd deny 'prisma migrate dev --name x'
cmd deny 'npx prisma db push'
cmd deny 'pnpm exec prisma db execute --file x.sql'
cmd deny 'pnpm exec prisma db seed'
cmd deny 'dropdb autolenis'
cmd deny 'psql "$DATABASE_URL" -c "drop database autolenis"'

echo "== production ledger commands: ASK (never silent, never denied) =="
cmd ask 'prisma migrate deploy'
cmd ask 'cd frontend && pnpm exec prisma migrate deploy'
cmd ask 'npx prisma migrate deploy --schema prisma/schema.prisma'
cmd ask './node_modules/.bin/prisma migrate deploy'                       # binary by path
cmd ask 'frontend/node_modules/.bin/prisma migrate deploy'
cmd ask 'pnpm exec prisma migrate resolve --applied 20261106000000_transaction_spine_enums'
cmd ask 'pnpm exec prisma migrate resolve --rolled-back 20261106000100_transaction_spine_foundation'
cmd ask 'pnpm exec prisma migrate status'
cmd ask 'pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datasource prisma/schema.prisma --shadow-database-url "$SHADOW_URL"'
cmd deny 'pnpm exec prisma migrate resolve'                                # neither form
cmd deny 'pnpm exec prisma migrate resolve --help'
cmd deny 'pnpm exec prisma migrate deploy && pnpm exec prisma db seed'     # deny wins over ask

echo "== production reads through psql: ASK only in the read-only shape =="
cmd ask  "$RO -f $PROOF/preflight.sql"
cmd ask  "$RO -f $PROOF/verify.sql"
cmd ask  "$RO -f $PROOF/production-baseline/census.sql"
cmd ask  "$RO -f $PROOF/production-baseline/digests.sql"
cmd ask  "$RO -c \"select migration_name, finished_at from _prisma_migrations order by finished_at desc\""
cmd ask  'PGOPTIONS="-c default_transaction_read_only=on" psql "$DIRECT_URL" -c "select count(*) from users"'
cmd ask  "cd frontend && $RO -f ../$PROOF/preflight.sql"
cmd deny 'psql "$DATABASE_URL" -c "select count(*) from users"'            # no read-only transaction
cmd deny 'psql "$DIRECT_URL" -f docs/transaction-flow/phase-1-proof/preflight.sql'
cmd deny 'psql "$DIRECT_URL" -c "SET TRANSACTION READ ONLY" -f x.sql'    # SET without --single-transaction is a no-op
cmd deny "$RO -c \"update vehicle_requests set status = 'CANCELLED' where id = 'x'\""
cmd deny "$RO -c \"UPDATE vehicle_requests SET status = 'CANCELLED'\""
cmd deny "$RO -c \"select 1; update vehicle_requests set status = 'CANCELLED'\""   # a ; inside the -c argument hides nothing
cmd deny "$RO -c \"insert into deposits (id) values ('x')\""
cmd deny "$RO -c \"delete from vehicle_requests where id = 'x'\""
cmd deny "$RO -c \"alter type \\\"VehicleRequestStatus\\\" add value 'DRAFT'\""
cmd deny "$RO -c \"create index concurrently x on vehicle_requests (buyer_id)\""
cmd deny "$RO -c \"do \\\$\\\$ begin update deposits set status='REFUNDED'; end \\\$\\\$\""
cmd deny "$RO -c \"with u as (update deposits set status='PAID' returning id) select count(*) from u\""
cmd deny "$RO -c \"\\copy (select email from users) to '/tmp/u.csv'\""
cmd deny "$RO -c \"\\! cat /etc/passwd\""
cmd deny "$RO -f $PROOF/rollback.sql"                                       # committed, but it writes
cmd deny 'pg_dump "$DIRECT_URL" > /tmp/prod.sql'
cmd deny 'psql "$DIRECT_URL" -l'

dml="$(mktemp)"; printf -- "-- looks harmless\nUPDATE vehicle_requests SET status = 'CANCELLED' WHERE id = 'x';\n" > "$dml"
ro="$(mktemp)";  printf -- "-- never repair with an UPDATE\nWITH v AS (SELECT 1) SELECT * FROM v;\n" > "$ro"
trap 'rm -f "$dml" "$ro"' EXIT
cmd deny "$RO -f $dml"                                                      # file body inspected
cmd ask  "$RO -f $ro"                                                       # comment mentioning UPDATE is fine
cmd deny "$RO < $dml"                                                       # stdin redirect inspected
cmd deny "$(printf '%s <<EOF\nUPDATE vehicle_requests SET status = %sCANCELLED%s;\nEOF\n' "$RO" "'" "'")"   # heredoc body inspected
cmd ask  "$(printf '%s <<EOF\nSELECT count(*) FROM _prisma_migrations;\nEOF\n' "$RO")"

echo "== local disposable databases: unchanged =="
cmd allow 'psql "postgresql://pgtest@127.0.0.1:55432/autolenis_e2e" -c "insert into t values (1)"'
cmd allow 'PGHOST=localhost psql -d autolenis_e2e -c "update t set x = 1"'
cmd allow 'psql -h 127.0.0.1 -p 55432 -U pgtest -d autolenis_prodbase -f docs/transaction-flow/phase-1-proof/rollback.sql'
cmd allow 'pg_dump "postgresql://pgtest@localhost:55432/autolenis_e2e" > /tmp/e2e.sql'
cmd deny  'psql "postgresql://pgtest@127.0.0.1:55432/postgres" -c "drop database autolenis_e2e"'   # drop is always denied

echo "== credentials: never typed, printed, dumped or written =="
cmd deny 'echo $DATABASE_URL'
cmd deny 'echo "$DIRECT_URL" | cut -d@ -f2'
cmd deny 'printf "%s\n" "${DATABASE_URL}" > /tmp/dsn.txt'
cmd deny 'printenv'
cmd deny 'printenv DATABASE_URL'
cmd deny 'sudo printenv'
cmd deny 'env'
cmd deny 'env | grep -i supabase'
cmd deny 'env > /tmp/env.txt'
cmd deny 'set | grep URL'
cmd deny 'export -p'
cmd deny 'declare -x'
cmd deny 'cat /proc/self/environ | tr "\0" "\n"'
cmd deny 'node -e "console.log(process.env.DATABASE_URL)"'
cmd deny 'node -p process.env.DIRECT_URL'
cmd deny 'python3 -c "import os; print(os.environ[\"DIRECT_URL\"])"'
cmd deny "$(printf 'node <<EOF\nconsole.log(process.env.DATABASE_URL)\nEOF\n')"
# Fixtures use `.invalid` hosts and a placeholder password on purpose: a placeholder
# password against a REAL hostname still reads as a credential to secret scanners
# (GitGuardian flagged an earlier revision of these lines), and the rules under test
# key on the DSN shape, not on the host.
cmd deny 'DATABASE_URL=postgresql://app:placeholder-not-a-secret@db.example.invalid:5432/postgres pnpm exec prisma migrate deploy'
cmd deny 'export DIRECT_URL="postgresql://app:placeholder-not-a-secret@db.example.invalid:5432/postgres"'
cmd deny 'psql postgresql://app:placeholder-not-a-secret@db.example.invalid:5432/postgres -c "select 1"'
cmd deny 'PGPASSWORD=placeholder-not-a-secret psql -h db.example.invalid -U app -c "select 1"'
cmd deny 'supabase migration up'
cmd deny 'supabase migration repair --status applied 20260901000000'
cmd deny 'supabase db dump -f prod.sql'

echo "== quoted text is text: separators inside quotes never make a command =="
cmd allow 'grep -E "prisma|printenv|mcp__" .claude/settings.json'
cmd allow 'grep -n "pg_dump\*|pg_dumpall\*)" .claude/hooks/guard-destructive.sh'
cmd allow 'grep -rn "supabase migration up|migration repair" docs/'
cmd allow 'grep -E "x|prisma migrate deploy|y" docs/ -r'
cmd allow 'grep -E "env|set|export|declare" .claude/hooks/guard-destructive.sh'
cmd allow 'grep -rn "DATABASE_URL=postgresql" docs/'
cmd allow 'sed -n "s/psql|pg_dump|curl/x/p" README.md'
cmd allow 'echo "psql;printenv;env" > /dev/null'
cmd deny  'echo "a\"b"; printenv'                                                  # an escaped quote does not hide a real command

echo "== quoted commands handed to a shell ARE commands: judged by recursion =="
cmd deny 'bash -c "cd /tmp && git reset --hard HEAD~3"'
cmd deny 'sh -c "rm -rf /tmp/x"'
cmd deny 'eval "git merge main"'
cmd deny 'timeout 30 bash -c "pnpm exec prisma migrate reset"'
cmd deny "bash -c 'psql \"\$DIRECT_URL\" -c \"update vehicle_requests set status = 1\"'"
cmd deny 'bash -lc "echo $DATABASE_URL"'
cmd deny 'xargs -I{} sh -c "printenv {}" < list.txt'
cmd ask  'bash -c "cd frontend && pnpm exec prisma migrate deploy"'
cmd allow 'bash -c "pnpm typecheck"'
cmd allow 'bash -n .claude/hooks/guard-destructive.sh'                            # syntax check runs nothing

echo "== --schema must name the repository chain =="
cmd deny 'pnpm exec prisma migrate deploy --schema /tmp/evil/schema.prisma'
cmd deny 'pnpm exec prisma migrate resolve --applied 20261106000000_transaction_spine_enums --schema ../other/schema.prisma'
cmd deny 'pnpm exec prisma migrate status --schema=other/schema.prisma'
cmd ask  'pnpm exec prisma migrate deploy --schema prisma/schema.prisma'
cmd ask  'pnpm exec prisma migrate deploy --schema=frontend/prisma/schema.prisma'
cmd ask  'pnpm exec prisma migrate deploy --schema ./prisma/schema.prisma'

echo "== nothing may loosen the read-only transaction from inside =="
cmd deny "$RO -c \"SET TRANSACTION READ WRITE\" -c \"select pg_sleep(0)\""
cmd deny "$RO -c \"select set_config('transaction_read_only','off',false)\""
cmd deny "$RO -c \"set role postgres\" -c \"select 1\""
cmd deny "$RO -c \"SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE\""

echo "== production over HTTP is outside the protocol =="
cmd deny 'curl -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" https://aieybibvewmvrubcpthm.supabase.co/rest/v1/vehicle_requests'
cmd deny 'curl -X PATCH "https://aieybibvewmvrubcpthm.supabase.co/rest/v1/vehicle_requests?id=eq.x" -d "{}"'
cmd deny 'wget -qO- https://api.supabase.com/v1/projects'
cmd allow 'curl -sS "$HTTPS_PROXY/__agentproxy/status"'
cmd allow 'curl -sI https://autolenis.com/'
cmd allow 'curl -sI https://supabase.com/docs/guides/database'                     # docs, not the project

echo "== pg_restore writes; pg_dump reads PII: both refused off loopback =="
cmd deny 'pg_restore -d "$DIRECT_URL" /tmp/dump.file'
cmd allow 'pg_restore -d "postgresql://pgtest@127.0.0.1:55432/autolenis_e2e" /tmp/dump.file'

echo "== deploy session: a non-loopback production DSN is in the environment =="
GUARD_ENV='DATABASE_URL=postgresql://u:p@db.example.invalid:5432/postgres'     # non-loopback: any remote host
cmd deny 'pnpm test:all'
cmd deny 'cd frontend && pnpm test'
cmd deny 'pnpm build'
cmd deny 'pnpm dev'
cmd deny 'pnpm exec tsx scripts/s4c_status_update.ts f435ca9e CANCELLED'
cmd deny 'npx tsx scripts/find_or_seed_submitted.ts'
cmd deny 'node scripts/x.js'
cmd deny 'pnpm exec prisma studio'
cmd deny 'pnpm db:check-drift'
cmd deny 'bash docs/transaction-flow/phase-1-proof/run-proof.sh'
cmd deny 'python3 -c "print(1)"'
cmd deny 'curl -sS https://example.com/'
cmd deny 'supabase db pull'
cmd deny 'timeout 60 pnpm test:payments'
cmd ask  'cd frontend && pnpm exec prisma migrate deploy'
cmd ask  'pnpm exec prisma migrate status'
cmd ask  'pnpm exec prisma migrate resolve --applied 20261106000000_transaction_spine_enums'
cmd ask  "$RO -f $PROOF/preflight.sql"
cmd allow 'pnpm db:report-target DIRECT_URL'
cmd allow 'cd frontend && pnpm db:report-target DATABASE_URL'
cmd allow 'pnpm typecheck'
cmd allow 'pnpm lint'
cmd allow 'pnpm exec prisma validate'
cmd allow 'pnpm exec prisma generate'
cmd allow 'node .claude/validate-skills.mjs'
cmd allow 'bash .claude/hooks/__tests__/guards.test.sh'
cmd allow 'git status'
cmd allow 'git push -u origin claude/some-branch'
cmd allow '[ -n "$DIRECT_URL" ] && echo set || echo unset'
cmd allow 'cat docs/transaction-flow/phase-1-proof/README.md'
cmd allow 'grep -rn "vehicleRequest.updateMany" frontend/lib'
cmd allow 'jq . .claude/settings.json'
cmd allow 'psql --version'
GUARD_ENV='DIRECT_URL=postgresql://u:p@direct.example.invalid:5432/postgres'
cmd deny 'pnpm test'                                                               # any of the three variables triggers it
GUARD_ENV='DATABASE_URL=postgresql://u:p@127.0.0.1:55432/autolenis_e2e'
cmd allow 'pnpm test:all'                                                          # a loopback DSN is not a deploy session
cmd allow 'pnpm exec tsx scripts/seed-inventory.ts'
GUARD_ENV=""

echo "== ordinary work: ALLOW =="
cmd allow 'git status'
cmd allow 'git log --oneline -5'
cmd allow 'git diff --stat'
cmd allow 'git commit -m "chore: config"'
cmd allow 'git push -u origin claude/some-feature-branch'
cmd allow 'git push -u origin main-fix-typo'           # not the main branch
cmd allow 'git checkout main'
cmd allow 'git merge-base main HEAD'                   # read-only, not a merge
cmd allow 'git stash'
cmd allow 'git revert abc123'
cmd allow 'pnpm typecheck'
cmd allow 'cd frontend && pnpm test:all'
cmd allow 'pnpm lint'
cmd allow 'pnpm build'
cmd allow 'node .claude/validate-skills.mjs'
cmd allow 'rm /tmp/onefile.txt'                        # single named file
cmd allow 'rm -f /tmp/onefile.txt'                     # -f without -r
cmd allow 'grep -rn "drop table" .'                    # searching, not executing
cmd allow 'grep -rn "git merge" docs/'
cmd allow 'grep -rn "process.env.DATABASE_URL" frontend/lib'              # investigation, not disclosure
cmd allow 'grep -rn "postgresql://u:p@" frontend/lib/testing'             # a DSN in a grep pattern is text
cmd allow 'echo "git reset --hard is denied"'
cmd allow 'echo "DATABASE_URL is owner-managed in Vercel"'                # the name, not the value
cmd allow '[ -n "$DATABASE_URL" ] && echo set || echo unset'              # sanctioned presence check
cmd allow 'pnpm db:report-target DATABASE_URL'                            # sanctioned sanitized description
cmd allow 'cd frontend && pnpm db:report-target DIRECT_URL'
cmd allow 'env FOO=bar pnpm test'                                          # env as a wrapper
cmd allow 'set -euo pipefail'
cmd allow 'export PATH="$PATH:/x"'
cmd allow 'declare -a arr=(1 2)'
cmd allow 'jq . .claude/settings.json'
cmd allow 'npx prisma generate'
cmd allow 'pnpm exec prisma validate'
cmd allow 'pnpm exec prisma migrate diff --from-schema-datamodel a.prisma --to-schema-datamodel b.prisma'   # file-only diff, no connection
cmd allow 'psql --version'
cmd allow 'which psql'
cmd allow 'ls -la'
cmd allow 'cat CLAUDE.md'

echo "== heredocs: bodies are data, unless fed to an interpreter =="
cmd allow "$(printf 'cat > doc.md <<%sEOF%s\n| `cd /tmp && git reset --hard HEAD~3` | blocked |\n| `npx supabase db push` | blocked |\n| `rm -rf build` | blocked |\nEOF\n' "'" "'")"
cmd allow "$(printf 'cat > x.md <<EOF\ngit push --force is denied\nvercel deploy is denied\nprisma migrate deploy asks\nEOF\n')"
cmd allow "$(printf 'cat <<-%sM%s > y.txt\n\tprisma migrate reset\nM\n' "'" "'")"
cmd allow "$(printf 'cat > note.md <<EOF\necho $DATABASE_URL is forbidden\nEOF\n')"
cmd deny  "$(printf 'bash <<EOF\ngit reset --hard HEAD~3\nEOF\n')"
cmd deny  "$(printf 'sh <<%sEOF%s\nrm -rf /tmp/x\nEOF\n' "'" "'")"
cmd deny  "$(printf 'cat > z.md <<%sEOF%s\nharmless text\nEOF\ngit merge main\n' "'" "'")"

echo "== malformed / absent input must not block =="
check "$BASH_GUARD" allow '{"tool_name":"Bash","tool_input":{}}'        'no command field'
check "$BASH_GUARD" allow '{"tool_name":"Bash","tool_input":{"command":null}}' 'null command'
check "$BASH_GUARD" allow 'not json at all'                              'unparseable payload'
check "$PATH_GUARD" allow '{"tool_name":"Edit","tool_input":{}}'         'no file_path field'

echo "== protected paths: DENY =="
EXISTING_PRISMA="frontend/prisma/migrations/$(ls "$ROOT/frontend/prisma/migrations" | head -1)/migration.sql"
file deny "frontend/.env"
file deny "frontend/.env.local"
file deny "frontend/.env.example"
file deny "$ROOT/frontend/.env.production"
file deny "$EXISTING_PRISMA"
file deny "$ROOT/$EXISTING_PRISMA"
file deny "frontend/app/api/admin/content/attribution/export/route.ts"
nb   deny "frontend/.env"

echo "== protected paths: ALLOW =="
file allow "frontend/prisma/migrations/29991231000000_new_thing/migration.sql"   # new migration
file allow "frontend/migrations/999_brand_new.sql"
file allow "frontend/lib/services/deal/deal.service.ts"
file allow "CLAUDE.md"
file allow ".claude/settings.json"
file allow "frontend/app/api/admin/content/attribution/route.ts"                 # sibling route
file allow "frontend/app/admin/content/attribution/page.tsx"
file allow "frontend/prisma/schema.prisma"

echo
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
echo "OK — both guards behave in all three directions."
