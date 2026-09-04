#!/bin/bash
# Regression tests for the AutoLenis PreToolUse guards.
#
#   bash .claude/hooks/__tests__/guards.test.sh
#
# Both directions matter. A guard that blocks everything is as broken as one that
# blocks nothing, so every DENY case has ALLOW cases around it. Run this after any
# change to either guard script.

set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BASH_GUARD="$ROOT/.claude/hooks/guard-destructive.sh"
PATH_GUARD="$ROOT/.claude/hooks/guard-protected-paths.sh"
pass=0; fail=0

payload() { # payload <tool> <key> <value>
  python3 -c 'import json,sys; print(json.dumps({"hook_event_name":"PreToolUse","tool_name":sys.argv[1],"tool_input":{sys.argv[2]:sys.argv[3]}}))' "$1" "$2" "$3"
}

check() { # check <guard> <deny|allow> <payload-json> <label>
  local guard="$1" expect="$2" json="$3" label="$4" out rc got
  out="$(printf '%s' "$json" | CLAUDE_PROJECT_DIR="$ROOT" bash "$guard" 2>/dev/null)"
  rc=$?; got="allow"; [ "$rc" -eq 2 ] && got="deny"
  if [ "$got" != "$expect" ]; then
    fail=$((fail+1)); printf 'FAIL  expected=%-5s got=%-5s :: %s\n' "$expect" "$got" "$label"; return
  fi
  if [ "$got" = "deny" ]; then
    # A malformed deny is a silently OPEN gate: exit 0 with unreadable JSON lets the
    # call through. Assert the schema, not just the exit code.
    if ! printf '%s' "$out" | python3 -c '
import json,sys
h = json.load(sys.stdin)["hookSpecificOutput"]
assert h["hookEventName"] == "PreToolUse"
assert h["permissionDecision"] == "deny"
assert isinstance(h["permissionDecisionReason"], str) and h["permissionDecisionReason"]
' 2>/dev/null; then
      fail=$((fail+1)); printf 'FAIL  malformed deny JSON :: %s\n' "$label"; return
    fi
  fi
  pass=$((pass+1))
}

cmd()  { check "$BASH_GUARD" "$1" "$(payload Bash command "$2")" "${2:0:76}"; }
file() { check "$PATH_GUARD" "$1" "$(payload Edit file_path "$2")" "$2"; }
nb()   { check "$PATH_GUARD" "$1" "$(payload NotebookEdit notebook_path "$2")" "notebook:$2"; }

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
cmd deny 'prisma migrate deploy'
cmd deny 'pnpm exec prisma migrate reset'
cmd deny 'npx prisma db push'
cmd deny 'dropdb autolenis'
cmd deny 'psql "$DATABASE_URL" -c "drop database autolenis"'
cmd deny 'cd frontend && pnpm exec prisma migrate deploy'

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
cmd allow 'echo "git reset --hard is denied"'
cmd allow 'jq . .claude/settings.json'
cmd allow 'npx prisma generate'
cmd allow 'pnpm exec prisma validate'
cmd allow 'psql "$DATABASE_URL" -c "select count(*) from users"'
cmd allow 'ls -la'
cmd allow 'cat CLAUDE.md'

echo "== heredocs: bodies are data, unless fed to an interpreter =="
cmd allow "$(printf 'cat > doc.md <<%sEOF%s\n| `cd /tmp && git reset --hard HEAD~3` | blocked |\n| `npx supabase db push` | blocked |\n| `rm -rf build` | blocked |\nEOF\n' "'" "'")"
cmd allow "$(printf 'cat > x.md <<EOF\ngit push --force is denied\nvercel deploy is denied\nEOF\n')"
cmd allow "$(printf 'cat <<-%sM%s > y.txt\n\tprisma migrate deploy\nM\n' "'" "'")"
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
echo "OK — both guards behave in both directions."
