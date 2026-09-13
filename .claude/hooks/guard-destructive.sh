#!/bin/bash
# AutoLenis PreToolUse guard — destructive and production-reaching shell commands.
#
# WHY THIS EXISTS ON TOP OF permissions.deny:
#   `permissions.deny` in .claude/settings.json is the first layer and it is good:
#   Claude Code parses shell operators, so `cd /tmp && git reset --hard` is split
#   into subcommands and matched independently. But the documented matcher has
#   gaps this hook closes:
#     • "Extra spaces" — `git   reset --hard` is named in the docs as a variation
#       an argument-constraining Bash rule will not match.
#     • Options before the subcommand — everything before the first `*` is matched
#       "as written", so `git -C . reset --hard` slips a `Bash(git reset --hard *)`
#       rule.
#     • Environment runners — the docs state `npx`, `pnpm exec`, `docker exec`,
#       `devbox run` and friends are NOT stripped before matching, so
#       `npx supabase db push` is matched as an `npx` command.
#     • Leading environment assignments — `PGOPTIONS=... psql` is matched as a
#       `PGOPTIONS=...` command, so a `Bash(psql:*)` rule never sees it.
#   Hooks also run in permission modes where allow rules do not apply, run before
#   workspace trust, and run inside subagents — so this layer is not bypassable by
#   delegating the work to a subagent.
#
# CONTRACT: ../../CLAUDE.md -> "Protected paths & forbidden actions" and
#           ../../CLAUDE.md -> "Production database access — the per-run protocol".
#
# THREE DECISIONS, NOT TWO. Most rules DENY. The three production-database
# operations the owner authorized on 2026-09-07 — `prisma migrate deploy`,
# `prisma migrate resolve --applied|--rolled-back`, and read-only verification
# (`prisma migrate status`, `psql` in a server-enforced read-only transaction) —
# return ASK instead: the call is never silently allowed, the prompt carries the
# protocol, and the owner approves that one run. A deny anywhere in a compound
# command still wins over an ask.
#
# DEPLOY SESSION. When a non-loopback DATABASE_URL / DIRECT_URL / PROD_READONLY_URL
# is present in this process environment, the session can reach production from
# ANY JavaScript, TypeScript, Python or shell script — 19 files under
# frontend/scripts/ instantiate a database client, and `pnpm test` would run with
# the credential. So in such a session everything that can open a client is refused
# except the three operations, the sanitized target report, and non-connecting
# tooling (typecheck, lint, prisma generate/validate, git, read-only file tools).
# The value is never read beyond a loopback test and never printed.
#
# FAIL BEHAVIOUR: a guard that traps the agent is worse than no guard. Anything
# this script cannot parse exits 0 (the call proceeds to the normal permission
# flow, where permissions.deny still applies). Only a positive match denies.
# Set AUTOLENIS_GUARD=off to disable.

set -u

[ "${AUTOLENIS_GUARD:-}" = "off" ] && exit 0

payload="$(cat 2>/dev/null || true)"
[ -z "$payload" ] && exit 0

# --- extract .tool_input.command -------------------------------------------
extract() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null && return 0
  fi
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$payload" | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        try{const j=JSON.parse(s);process.stdout.write(String(j?.tool_input?.command??""))}catch{}
      })' 2>/dev/null && return 0
  fi
  return 1
}

cmd="$(extract)" || exit 0
# jq -r prints the literal string "null" for a JSON null; treat it as absent.
[ -z "$cmd" ] && exit 0
[ "$cmd" = "null" ] && exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)}"
DEPTH="${AUTOLENIS_GUARD_DEPTH:-0}"

# --- the decision JSON, built in exactly ONE place --------------------------
# Both documented block paths at once for a deny: the schema-exact JSON on stdout
# (the supported mechanism; `{"decision":"block"}` is deprecated for PreToolUse)
# and exit 2, which blocks even if the JSON is not read. An ask is the same JSON
# with "ask" and exit 0. A typo in a field name would be a silently OPEN gate, so
# this string is written once, here.
decision() { # decision <deny|ask> <reason>
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":%s}}' \
    "$1" "$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g' | tr '\n' ' ' | sed 's/^/"/; s/$/"/')"
  printf '%s\n' "$2" >&2
}
deny() { decision deny "$1"; exit 2; }
# An ask is deferred to the end of the scan: a later segment of the same command
# may still deny, and deny must win. The first ask reason is the one shown.
ask_reason=""
ask() { [ -z "$ask_reason" ] && ask_reason="$1"; return 0; }

# --- production database access (CLAUDE.md -> Production database access) ---
PROD_REF="aieybibvewmvrubcpthm"
PROTO='CLAUDE.md -> Production database access'
# Variables that hold, or could hold, a production credential in a deploy session.
SECRET_VARS='DATABASE_URL|DIRECT_URL|PROD_READONLY_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_PASSWORD|PGPASSWORD'
# SQL that writes. Matched at statement start (after start-of-text, `;`, `(` or a
# quote), followed by whitespace, after `--` comments are stripped — preflight.sql
# legitimately says "never ... with an UPDATE" in a comment.
WRITE_SQL='update|insert|delete|alter|create|drop|truncate|grant|revoke|merge|copy|vacuum|reindex|cluster|refresh|lock|call|do'
RO_SHAPE='psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction -c "SET TRANSACTION READ ONLY" -f <file.sql>'
INTERPRETERS='bash|sh|zsh|ksh|dash|python|python3|node|nodejs|tsx|ts-node|bun|deno|perl|ruby|php|psql|pgcli|mysql|sqlite3'
# process.env.X / process.env["X"] / os.environ["X"] / os.environ.get("X") / getenv("X") / ENV["X"] / $ENV{X}
ENV_READ_RE="process\.env(\.|\[\\\\?[\"'])(${SECRET_VARS})|environ(\.get\(|\[)\\\\?[\"'](${SECRET_VARS})|getenv\(\\\\?[\"'](${SECRET_VARS})|ENV\[\\\\?[\"'](${SECRET_VARS})|\\\$ENV\{(${SECRET_VARS})"

# A deploy session: a production DSN is present and does not name a loopback host.
# The value is tested against three patterns and nothing else — never echoed.
deploy_mode=0
for v in DATABASE_URL DIRECT_URL PROD_READONLY_URL; do
  val="${!v:-}"; [ -z "$val" ] && continue
  case "$val" in
    *@127.0.0.1[:/]*|*@localhost[:/]*|*@\[::1\][:/]*) ;;
    *) deploy_mode=1 ;;
  esac
done
unset val

collapse() { printf '%s' "$1" | tr '\n\t' '  ' | sed 's/  */ /g; s/^ //; s/ $//'; }
trim() { local t="$1"; t="${t#"${t%%[![:space:]]*}"}"; printf '%s' "${t%"${t##*[![:space:]]}"}"; }

sql_has_write() { # sql_has_write <sql text>
  printf '%s' "$1" | sed 's/--.*$//' | tr '[:upper:]' '[:lower:]' | tr -s ' \n\t' ' ' \
    | grep -Eq "(^|[;(\"' ])(${WRITE_SQL}) "
}
# psql meta-commands that read/write files or run a shell: \copy \! \i \ir \include \o \out \w \write
sql_has_meta() {
  printf '%s' "$1" | grep -Eq '(^|[[:space:]"'"'"'])\\(copy|!|i|ir|include|o|out|w|write)([[:space:]]|$)'
}
# Anything that would switch the read-only transaction back to read-write, or change
# who the session is. SET TRANSACTION READ WRITE is legal before the first query.
sql_has_rw_escape() {
  printf '%s' "$1" | sed 's/--.*$//' | tr '[:upper:]' '[:lower:]' | tr -s ' \n\t' ' ' \
    | grep -Eq 'read write|transaction_read_only|session characteristics|set role|session authorization|reset all|set_config'
}

# A target is LOCAL only when it positively names a loopback host. A DSN held in a
# variable names nothing, so it is treated as production — the allowlist pattern of
# frontend/lib/testing/isolated-database.ts, applied to the command line.
is_local_target() {
  printf '%s' "$1" | grep -Eiq '@(127\.0\.0\.1|localhost|\[::1\]|::1)([:/]|$)|(^|[ ;])PGHOST=(127\.0\.0\.1|localhost|::1)([ ;]|$)|(^| )(-h|--host)[= ](127\.0\.0\.1|localhost|::1)( |$)|host=(127\.0\.0\.1|localhost|::1)([ &]|$)'
}

# --- the loopback carve-out (owner ruling, 2026-09-09) ----------------------
# A throwaway Postgres on 127.0.0.1 is the sanctioned place to exercise anything
# that writes (CLAUDE.md -> Test data belongs in the isolated environment), and
# reaching one means naming its DSN on the command line. That is the ONLY reason a
# credential-shaped assignment is ever allowed, and it is allowed only when the
# DSN's host -- PARSED OUT of the authority, never matched as a substring -- is
# exactly a loopback literal. A substring match would walk
# postgresql://user@localhost.evil.com/db straight through, which is precisely the
# class of bug this guard exists to prevent.
is_loopback_dsn() { # is_loopback_dsn <dsn value>
  local dsn auth host ats
  # DNS is case-insensitive, so fold once and match exactly afterwards.
  dsn="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  # The production project is never loopback, however the string is shaped -- a
  # pooler username carrying the ref, or an SSH tunnel forwarding to it, both refuse.
  case "$dsn" in *"$PROD_REF"*) return 1 ;; esac
  # Only a postgres URL has an authority to parse. Anything else has no host.
  case "$dsn" in postgres://*|postgresql://*) ;; *) return 1 ;; esac
  # libpq lets host= / hostaddr= in the query string override the authority, so a
  # DSN that carries one is not the target its authority claims.
  case "$dsn" in *[?\&]host=*|*[?\&]hostaddr=*) return 1 ;; esac
  auth="${dsn#*://}"        # drop the scheme
  auth="${auth%%[/?]*}"     # authority only: [userinfo@]host[:port]
  # A password in the userinfo is a credential typed on the command line, which is
  # forbidden whatever the host -- a tunnel can put production behind 127.0.0.1.
  case "$auth" in *:*@*) return 1 ;; esac
  # Two `@` in one authority is malformed and its split is parser-dependent.
  # Refuse rather than pick a rule libpq might not share.
  ats="$(printf '%s' "$auth" | tr -cd '@' | wc -c)"
  [ "$ats" -gt 1 ] && return 1
  host="${auth##*@}"
  case "$host" in
    \[*\]:*) host="${host%%]*}]" ;;   # bracketed IPv6 with a port
    \[*\])   : ;;                     # bracketed IPv6, no port
    *)       host="${host%%:*}" ;;
  esac
  case "$host" in
    127.0.0.1|localhost|'[::1]') return 0 ;;
    *) return 1 ;;
  esac
}

# Does EVERY credential-shaped assignment on this command line qualify for the
# carve-out? One that does not sinks the whole line: a loopback DSN standing next
# to a real secret does not launder it. PGPASSWORD and the Supabase keys never
# qualify -- a bare secret has no host to parse, so there is nothing to prove.
all_secret_assignments_loopback() { # all_secret_assignments_loopback <collapsed raw segment>
  local a name val seen=0 ok=1
  while IFS= read -r a; do
    [ -z "$a" ] && continue
    a="${a# }"
    name="${a%%=*}"; val="${a#*=}"
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    seen=1
    case "$name" in
      DATABASE_URL|DIRECT_URL|PROD_READONLY_URL) is_loopback_dsn "$val" || ok=0 ;;
      *) ok=0 ;;
    esac
  done <<EOF
$(printf '%s' "$1" | grep -oE "(^| )(${SECRET_VARS})=[^ ]*")
EOF
  [ "$seen" -eq 1 ] && [ "$ok" -eq 1 ]
}

# Does this psql invocation actually open a connection or carry SQL? `psql --version`
# and `psql --help` do neither and must stay runnable.
opens_connection() {
  printf '%s' "$1" | grep -Eq -- '(^| )(-c|--command|-f|--file|-d|--dbname|-h|--host|-U|--username|-l|--list)([ =]|$)|<|postgres(ql)?://|\$\{?[A-Za-z_]*(URL|DSN)|service=|host=|dbname=|(^|[ ;])PG[A-Z]+='
}

# Server-enforced read-only: either a startup parameter (works on a direct
# connection) or SET TRANSACTION READ ONLY inside psql's --single-transaction wrapper
# (works through the pooler too). Nothing else counts — a SELECT can call a writing
# function, so the transaction, not the verb, is the control.
has_readonly_marker() {
  local l
  l="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  printf '%s' "$l" | grep -Eq 'default_transaction_read_only(=|%3d)on' && return 0
  printf '%s' "$l" | grep -Eq -- '--single-transaction' && printf '%s' "$l" | grep -Eq 'set transaction read only' && return 0
  return 1
}

# `--schema` on a prisma migrate command must name the repository chain. Any other
# schema/migrations directory is DDL outside the chain, whatever the ledger says.
schema_is_chain() {
  printf '%s' "$1" | grep -Eq -- '--schema([ =]|$)' || return 0
  printf '%s' "$1" | grep -Eq -- "--schema[ =][\"']?(\./)?(frontend/)?prisma/schema\.prisma[\"']?( |$)"
}

# The SQL (C:) and files (F:) a psql line would execute, tokenised the way the shell
# would, so a `;` inside a quoted -c argument stays inside it. Falls back to a
# regex scan of the whole line when python3 is unavailable.
psql_parts_of() {
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -c '
import shlex, sys
try:
    toks = shlex.split(sys.stdin.read(), posix=True)
except Exception:
    sys.exit(0)
i = 0
while i < len(toks):
    t = toks[i]
    if t in ("-c", "--command", "-f", "--file") and i + 1 < len(toks):
        print(("C:" if t in ("-c", "--command") else "F:") + toks[i + 1].replace("\n", " ")); i += 2; continue
    if t.startswith("--command="): print("C:" + t[10:].replace("\n", " "))
    elif t.startswith("--file="):  print("F:" + t[7:])
    elif t == "<" and i + 1 < len(toks): print("F:" + toks[i + 1]); i += 2; continue
    elif t.startswith("<") and not t.startswith("<<") and len(t) > 1: print("F:" + t[1:])
    i += 1
' 2>/dev/null
    return 0
  fi
  printf 'C:%s\n' "$1"
  printf '%s' "$1" | grep -oE -- '(^| )(-f|--file)[ =]+[^ ]+|(^| )< *[^< ][^ ]*' 2>/dev/null \
    | sed -E 's/^ *(-f|--file)[ =]+//; s/^ *< *//' | sed -E "s/^[\"']//; s/[\"']\$//" | sed 's/^/F:/'
}

# The command string a `bash -c`, `sh -c` or `eval` on this LINE would run, or nothing.
# Works on the whole line, shell-tokenised, because the naive segment split breaks a
# quoted `bash -c "a && b"` at the `&&` and the inner command would never be seen.
inner_command_of() {
  command -v python3 >/dev/null 2>&1 || return 0
  printf '%s' "$1" | python3 -c '
import shlex, sys
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
OPS = {"&&", "||", "|", ";", "&", "|&"}
try:
    toks = shlex.split(sys.stdin.read(), posix=True)
except Exception:
    sys.exit(0)
i = 0
while i < len(toks) and toks[i].rsplit("/", 1)[-1] not in SHELLS and toks[i] != "eval":
    i += 1
if i >= len(toks): sys.exit(0)
if toks[i] == "eval":
    rest = []
    for t in toks[i + 1:]:
        if t in OPS: break
        rest.append(t)
    print(" ".join(rest)); sys.exit(0)
i += 1
while i < len(toks):
    t = toks[i]
    if t.startswith("-") and not t.startswith("--") and "c" in t[1:]:
        if i + 1 < len(toks): print(toks[i + 1])
        sys.exit(0)
    if not t.startswith("-"): sys.exit(0)
    i += 1
' 2>/dev/null
}

json_payload() { # json_payload <command>  -> {"tool_input":{"command":...}}
  if command -v jq >/dev/null 2>&1; then jq -cn --arg c "$1" '{tool_input:{command:$c}}' 2>/dev/null; return 0; fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps({"tool_input":{"command":sys.stdin.read()}}))' 2>/dev/null; return 0
  fi
  return 1
}

# Judge a quoted inner command by running this guard on it. Its deny is our deny;
# its ask becomes our ask. Bounded depth; fails open when nothing can build the payload.
judge_inner() {
  local inner="$1" pj out rc
  [ "$DEPTH" -ge 3 ] && return 0
  pj="$(json_payload "$inner")" || return 0
  [ -z "$pj" ] && return 0
  out="$(printf '%s' "$pj" | AUTOLENIS_GUARD_DEPTH=$((DEPTH + 1)) CLAUDE_PROJECT_DIR="$root" bash "$0" 2>/dev/null)"; rc=$?
  if [ "$rc" -eq 2 ]; then printf '%s' "$out"; exit 2; fi
  if printf '%s' "$out" | grep -q '"permissionDecision":"ask"'; then
    local why
    why="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null)"
    ask "${why:-the quoted inner command requires per-run owner approval ($PROTO).}"
  fi
}

resolve_file() { # prints the first existing path among the candidates, or nothing
  local f="$1"
  case "$f" in
    /*) [ -f "$f" ] && printf '%s' "$f" ;;
    *)  for base in "$PWD" "$root" "$root/frontend"; do
          [ -f "$base/$f" ] && { printf '%s' "$base/$f"; return 0; }
        done ;;
  esac
  return 0
}

# --- normalise one segment --------------------------------------------------
# Collapses whitespace, then peels leading env assignments, wrappers, environment
# runners and binary path prefixes until nothing more can be stripped.
norm() {
  local s
  s="$(collapse "$1")"
  local prev=""
  while [ "$s" != "$prev" ]; do
    prev="$s"
    s="$(printf '%s' "$s" | sed -E 's/^[A-Za-z_][A-Za-z0-9_]*=[^ ]* //')"
    s="$(printf '%s' "$s" | sed -E 's/^(sudo|env|command|builtin|noglob|nohup|time|xargs)( -[^ ]+)* //')"
    s="$(printf '%s' "$s" | sed -E 's/^(timeout|nice|stdbuf)( -[^ ]+)*( [0-9]+[smhd]?)? //')"
    # Runners that execute their arguments. The docs confirm Claude Code does not
    # strip these before matching a Bash rule, which is the whole point.
    s="$(printf '%s' "$s" | sed -E 's/^(npx|bunx)( -[-A-Za-z]+)* //')"
    s="$(printf '%s' "$s" | sed -E 's/^(pnpm|npm|yarn|bun)( -[-A-Za-z]+)* (exec|dlx|run) //')"
    s="$(printf '%s' "$s" | sed -E 's/^(docker|podman) exec( -[-A-Za-z]+| [^ ]+)* //')"
    # A binary called by path: ./node_modules/.bin/prisma, /usr/bin/psql, frontend/node_modules/.bin/prisma.
    s="$(printf '%s' "$s" | sed -E 's#^(\./|/)?([^ ]+/)(prisma|psql|pgcli|pg_dump|pg_dumpall|pg_restore|supabase|vercel|dropdb|git|rm|printenv|env|node|nodejs|tsx|ts-node|bun|deno|python|python3|perl|ruby|php|bash|sh|zsh|dash|ksh|curl|wget) #\3 #')"
    # git global options that sit before the subcommand.
    s="$(printf '%s' "$s" | sed -E 's/^git (-C [^ ]+|-c [^ ]+|--git-dir=[^ ]+|--work-tree=[^ ]+|--no-pager|-P) /git /')"
  done
  printf '%s' "$s"
}

# --- strip heredoc bodies ---------------------------------------------------
# A heredoc body is DATA, not commands. Writing documentation or a test that
# quotes a forbidden command (`cat > doc.md <<EOF ... EOF`) must not be blocked
# for mentioning it -- this file itself is such a document. The exception is a
# heredoc fed to an interpreter, where the body really is code and is inspected.
strip_heredocs() {
  local out="" inhd=0 marker="" line t pre m
  while IFS= read -r line; do
    if [ "$inhd" -eq 1 ]; then
      t="$(trim "$line")"
      [ "$t" = "$marker" ] && inhd=0
      continue
    fi
    out="$out$line
"
    if printf '%s' "$line" | grep -Eq "<<-?[[:space:]]*['\"]?[A-Za-z_][A-Za-z0-9_]*"; then
      pre="${line%%<<*}"
      if printf '%s' "$pre" | grep -Eq "(^|[[:space:];|(])(${INTERPRETERS})([[:space:]]|$)"; then
        : # interpreter heredoc: the body is code, so leave it to be inspected
      else
        m="$(printf '%s' "$line" | sed -E "s/.*<<-?[[:space:]]*//; s/^['\"]//; s/[^A-Za-z0-9_].*//")"
        [ -n "$m" ] && { inhd=1; marker="$m"; }
      fi
    fi
  done
  printf '%s' "$out"
}

scrubbed="$(printf '%s\n' "$cmd" | strip_heredocs)"
[ -z "$scrubbed" ] && exit 0

# Separators stay attached to the segment they end, so the segment's offset in its
# line can be tracked and a segment that BEGINS inside an open quote can be told
# apart from a real command. `grep -E "a|env|b"` must never read as `env`.
split_segments() { printf '%s' "$1" | sed -E 's/(\|\||&&|\|&|[;|&])/&\n/g'; }
strip_sep() { printf '%s' "$1" | sed -E 's/(\|\||&&|\|&|[;|&])$//'; }

# --- credentials read by an inline script -----------------------------------
# Judged over the WHOLE command once the line walk below has decided whether any
# real (unquoted) segment is an interpreter, because `python3 -c "import os;
# print(...)"` is split at the `;` and the read would land in a segment that no
# longer starts with the interpreter. A `grep` for `process.env.DATABASE_URL` over
# the codebase stays runnable: grep is not an interpreter.
any_interp=0

# --- a psql line against anything not positively loopback -------------------
# Read-only by construction (server-enforced), no writing SQL, no file/shell
# meta-command — and it ASKS so the owner approves that one run.
psql_line_check() { # psql_line_check <line>
  local line="$1" ll part kind body p
  ll="$(collapse "$line")"
  is_local_target "$ll" && return 0
  opens_connection "$ll" || return 0
  while IFS= read -r part; do
    [ -z "$part" ] && continue
    kind="${part%%:*}"; body="${part#*:}"
    case "$kind" in
      C)
        if sql_has_write "$body"; then
          deny "BLOCKED: this psql command carries UPDATE/INSERT/DELETE/DDL against a database that is not positively loopback. $PROTO: no DML on business tables and no DDL outside a Prisma migration — schema changes ship as a NEW migration through \`prisma migrate deploy\`; §13-D2 cancellations and anything touching deposits are owner-run."
        fi
        if sql_has_meta "$body"; then
          deny "BLOCKED: this psql command uses a meta-command (\\copy, \\!, \\i, \\o, \\w) that writes or reads files or runs a shell outside the read-only transaction. $PROTO: verification output is shown in chat, never written to a file."
        fi
        if sql_has_rw_escape "$body"; then
          deny "BLOCKED: this psql command would switch the read-only transaction back to read-write or change the session's identity (READ WRITE, transaction_read_only, SET ROLE, set_config …). $PROTO: read-only is the control; nothing may loosen it inside the run."
        fi ;;
      F)
        p="$(resolve_file "$body")"
        if [ -n "$p" ]; then
          if sql_has_write "$(cat "$p" 2>/dev/null)"; then
            deny "BLOCKED: psql would execute $body, which contains UPDATE/INSERT/DELETE/DDL, against a database that is not positively loopback. $PROTO: only read-only verification SQL (preflight.sql, verify.sql, census.sql, digests.sql, SELECTs over _prisma_migrations and the catalogs) may run; schema changes go through a NEW Prisma migration."
          fi
          if sql_has_meta "$(cat "$p" 2>/dev/null)"; then
            deny "BLOCKED: psql would execute $body, which contains a file/shell meta-command (\\copy, \\!, \\i, \\o, \\w). $PROTO: verification output is shown in chat, never written to a file."
          fi
          if sql_has_rw_escape "$(cat "$p" 2>/dev/null)"; then
            deny "BLOCKED: psql would execute $body, which switches the transaction back to read-write or changes the session's identity. $PROTO: read-only is the control; nothing may loosen it inside the run."
          fi
        fi ;;
    esac
  done <<PARTS
$(psql_parts_of "$ll")
PARTS
  if ! has_readonly_marker "$ll"; then
    deny "BLOCKED: this psql command reaches a database that is not positively loopback without a server-enforced read-only transaction. $PROTO — the only accepted shape is: $RO_SHAPE (or -c \"<one SELECT>\" in place of -f). Any write inside it fails with 25006 read_only_sql_transaction, so read-only is a property of the connection, not a promise."
  fi
  ask "PRODUCTION READ: psql runs read-only SQL against the production database inside a server-enforced read-only transaction. $PROTO: per-run owner approval in chat and the sanitized target report (pnpm db:report-target DIRECT_URL → PRODUCTION / $PROD_REF) come first; show the complete result in chat; a BLOCK or MISSING row stops the run; no CHECKED/TOTAL row means it did not run."
}

# --- inspect each line, then each subcommand of the line ---------------------
# Lines first: a psql `-c "select 1; update …"` must be judged from its own line,
# shell-tokenised — splitting the SQL on `;` would hide the UPDATE. A psql heredoc
# body arrives on the lines that follow and is judged as a whole at its marker.
hd_marker=""; hd_body=""; hd_local=0

while IFS= read -r line; do
  [ -z "$line" ] && continue

  if [ -n "$hd_marker" ]; then
    if [ "$(trim "$line")" = "$hd_marker" ]; then
      if [ "$hd_local" -eq 0 ]; then
        if sql_has_write "$hd_body"; then
          deny "BLOCKED: the SQL fed to psql carries UPDATE/INSERT/DELETE/DDL against a database that is not positively loopback. $PROTO: no DML on business tables, no DDL outside a Prisma migration — schema changes ship as a NEW migration through \`prisma migrate deploy\`; §13-D2 cancellations and anything touching deposits are owner-run."
        fi
        if sql_has_meta "$hd_body"; then
          deny "BLOCKED: the SQL fed to psql uses a meta-command (\\copy, \\!, \\i, \\o, \\w) that writes or reads files or runs a shell. $PROTO: verification output is shown in chat, never written to a file."
        fi
        if sql_has_rw_escape "$hd_body"; then
          deny "BLOCKED: the SQL fed to psql switches the transaction back to read-write or changes the session's identity. $PROTO: read-only is the control; nothing may loosen it inside the run."
        fi
      fi
      hd_marker=""; hd_body=""; hd_local=0
    else
      hd_body="$hd_body $line"
    fi
    continue
  fi

  linec="$(collapse "$line")"
  psql_in_line=0
  shell_in_line=0
  pos=0

  while IFS= read -r segsep; do
    prefix="${line:0:$pos}"; pos=$((pos + ${#segsep}))
    raw="$(strip_sep "$segsep")"
    [ -z "$(collapse "$raw")" ] && continue
    # Does this segment begin inside an open quote? Then the separator before it was
    # text, not shell, and the prefix rules below do not apply to it. The legacy
    # multi-word destructive rules stay literal on purpose — over-matching a quoted
    # `git reset --hard` costs a false positive, missing one costs a branch — and a
    # quoted string handed to a shell (`bash -c "…"`, `eval`) is judged by recursion.
    # Escaped characters are dropped first so `\"` and `\'` do not flip the parity.
    unesc="$(printf '%s' "$prefix" | sed 's/\\./ /g')"
    dq="$(printf '%s' "$unesc" | tr -cd '"')"; sq="$(printf '%s' "$unesc" | tr -cd "'")"
    inq=0; { [ $(( ${#dq} % 2 )) -eq 1 ] || [ $(( ${#sq} % 2 )) -eq 1 ]; } && inq=1
    rawc="$(collapse "$raw")"
    c="$(norm "$raw")"
    [ -z "$c" ] && continue
    lc="$(printf '%s' "$c" | tr '[:upper:]' '[:lower:]')"

    if [ "$inq" -eq 0 ]; then
      case "$lc" in
        node|node\ *|nodejs*|tsx|tsx\ *|ts-node*|bun|bun\ *|deno*|python*|perl*|ruby*|php*) any_interp=1 ;;
      esac
      # A quoted command handed to a shell IS a command: judged after the segment walk,
      # from the whole line, so a quoted `&&` cannot split it out of sight.
      case "$lc" in
        bash\ *|sh\ *|zsh\ *|dash\ *|ksh\ *|eval\ *) shell_in_line=1 ;;
      esac
    fi

    # --- credentials: never typed, printed, dumped or written ---------------
    # A password-bearing DSN or a literal secret on the command line of a database
    # client or interpreter. Investigation (grep/sed/cat over the docs) is untouched.
    if [ "$inq" -eq 0 ]; then
      case "$lc" in
        psql*|pgcli*|prisma*|pg_dump*|pg_dumpall*|pg_restore*|supabase*|node*|nodejs*|tsx*|ts-node*|bun*|deno*|python*|perl*|ruby*|php*|curl*|wget*)
          if printf '%s' "$rawc" | grep -Eq "postgres(ql)?://[^ \"']*:[^ @\"']+@"; then
            deny "BLOCKED: a connection string with a password is written into the command line. $PROTO: credentials are read from the environment at runtime and never typed, printed, logged or written to a file. Reference the variable (\"\$DIRECT_URL\") instead."
          fi
          ;;
      esac
      if printf '%s' "$rawc" | grep -Eq "^(export )?([A-Za-z_][A-Za-z0-9_]*=[^ ]* )*(${SECRET_VARS})=['\"]?[^\$'\" ]" \
         && { [ "$deploy_mode" -eq 1 ] || ! all_secret_assignments_loopback "$rawc"; }; then
        deny "BLOCKED: a literal production credential is assigned on the command line. $PROTO: read it from the environment at runtime; never inline a DSN, password or key. Provisioning the variable is the owner's, in the environment — not yours, in a command. The one carve-out is a throwaway loopback database, in a session that carries no production credential: DATABASE_URL, DIRECT_URL or PROD_READONLY_URL whose parsed host is exactly 127.0.0.1, localhost or [::1], with no password and never the production project ref."
      fi
      if printf '%s' "$rawc" | grep -Eq '^(env|printenv)( *$| +(>|>>|-))' \
         || printf '%s' "$lc" | grep -Eq '^printenv( |$)|^env$|^env +(>|>>|-)|^set$|^set +(>|>>)|^export( +-p)?$|^declare( +-[a-z]*[xp][a-z]*)?$|^typeset( +-x)?$' \
         || printf '%s' "$rawc" | grep -Eq '/proc/[^ ]*/environ'; then
        deny "BLOCKED: \`$c\` dumps the process environment, which holds production credentials in a deploy session. $PROTO: never print, log or write them. Presence check: [ -n \"\$DATABASE_URL\" ] && echo set. Sanitized description: pnpm db:report-target <VAR>."
      fi
      case "$lc" in
        curl*|wget*|http|http\ *|https\ *|xh\ *)
          if printf '%s' "$rawc" | grep -Eq "\.supabase\.(co|in)|api\.supabase\.com|pooler\.supabase\.com|\\\$\{?(${SECRET_VARS})([^A-Za-z0-9_]|$)"; then
            deny "BLOCKED: \`$c\` reaches the production project over HTTP (REST / management API) or carries a production credential. $PROTO: production is reached only through the three authorized operations; the Supabase REST surface with a service key is a write path outside every control here."
          fi ;;
      esac
    fi
    case "$lc" in
      echo\ *|printf\ *)
        if printf '%s' "$rawc" | grep -Eq "\\\$\{?(${SECRET_VARS})([^A-Za-z0-9_]|$)"; then
          deny "BLOCKED: \`$c\` would print a production credential. $PROTO: never echo, log or write DATABASE_URL / DIRECT_URL / PROD_READONLY_URL / service keys. Presence check: [ -n \"\$DATABASE_URL\" ] && echo set. Sanitized description: pnpm db:report-target <VAR>."
        fi
        ;;
    esac

    case "$lc" in
      rm\ *)
        if printf '%s' "$lc" | grep -Eq '(^| )-[a-z]*r[a-z]*f|(^| )-[a-z]*f[a-z]*r|--recursive.*--force|--force.*--recursive|(^| )-r( |$).*(^| )-f( |$)'; then
          deny "BLOCKED: recursive force-delete (\`$c\`). CLAUDE.md -> Protected paths: 'Never run: rm -rf'. Anything that looks obsolete, duplicated, unfinished or dead gets REPORTED for an owner decision, never deleted. Remove one named path with a plain \`rm\`, or report it."
        fi
        ;;
    esac

    case "$lc" in
      git\ reset\ --hard*|git\ reset\ -\ -hard*)
        deny "BLOCKED: \`$c\`. CLAUDE.md -> Protected paths: 'Never run: git reset --hard'. It destroys uncommitted work and rewrites the branch. Use \`git stash\`, \`git restore <path>\`, or \`git revert\`." ;;
      git\ merge|git\ merge\ *|git\ mergetool*)
        deny "BLOCKED: \`$c\`. This repository is BRANCH ONLY — merging is denied outright (CLAUDE.md -> Protected paths). Merges are the owner's, through a reviewed pull request. To bring the base branch into your work for a conflict, ask the owner first." ;;
      git\ push*)
        if printf '%s' "$lc" | grep -Eq '(^| )(-f|--force|--force-with-lease)( |=|$)'; then
          deny "BLOCKED: \`$c\`. CLAUDE.md -> Protected paths: 'Never run: git push --force'. Force-pushing rewrites published history and invalidates every teammate's checkout. Push a new commit instead."
        fi
        if printf '%s' "$lc" | grep -Eq '(^| )(main|master|develop|production)( |:|$)|:(main|master|develop|production)( |$)'; then
          deny "BLOCKED: \`$c\` targets a protected branch. This repository is BRANCH ONLY (CLAUDE.md -> Protected paths). Push your feature branch and open a pull request."
        fi
        ;;
    esac

    case "$lc" in
      supabase\ db\ push*|supabase\ db\ reset*|supabase\ db\ remote\ commit*)
        deny "BLOCKED: \`$c\`. CLAUDE.md -> Protected paths: 'Never run: supabase db push/reset'. THERE IS NO NON-PRODUCTION AUTHENTICATED ENVIRONMENT — branch previews share the PRODUCTION Supabase project. This command would mutate production data. Migrations require separate explicit owner authorization." ;;
      supabase\ link*|supabase\ projects\ delete*|supabase\ branches\ delete*)
        deny "BLOCKED: \`$c\` changes or destroys Supabase project state. Requires separate explicit owner authorization (CLAUDE.md -> Protected paths)." ;;
    esac
    if [ "$inq" -eq 0 ]; then
      case "$lc" in
        supabase\ migration\ up*|supabase\ migration\ repair*|supabase\ migration\ squash*|supabase\ db\ dump*)
          deny "BLOCKED: \`$c\`. $PROTO: every schema change goes through frontend/prisma/migrations so _prisma_migrations stays truthful — the Supabase CLI's own ledger (supabase_migrations) is out-of-band DDL, and a dump pulls production data into the session." ;;
      esac
    fi

    # This repository's ORM is Prisma, and DATABASE_URL / DIRECT_URL point at the
    # production project. The owner authorized exactly three operations against it
    # on 2026-09-07 (CLAUDE.md -> Production database access); those ASK. The rest
    # of the family — anything that resets, drifts or seeds — stays DENIED.
    case "$lc" in
      prisma\ migrate\ reset*|prisma\ migrate\ dev*|prisma\ db\ push*|prisma\ db\ execute*|prisma\ db\ seed*)
        deny "BLOCKED: \`$c\`. DATABASE_URL resolves to the PRODUCTION Supabase project — there is no isolated branch database (CLAUDE.md -> CRITICAL ENVIRONMENT BOUNDARY). This command resets, drifts or seeds the schema outside the migration chain. Only \`prisma migrate deploy\`, \`prisma migrate resolve --applied|--rolled-back <name>\` and read-only verification are authorized, each per owner-approved run ($PROTO)." ;;
    esac
    if [ "$inq" -eq 0 ]; then
      case "$lc" in
        prisma\ migrate\ deploy*|prisma\ migrate\ resolve*|prisma\ migrate\ status*|prisma\ migrate\ diff*)
          if ! schema_is_chain "$lc"; then
            deny "BLOCKED: \`$c\` points --schema outside the repository chain. $PROTO: the only schema production is ever migrated from is frontend/prisma/schema.prisma with its frontend/prisma/migrations/ directory; any other schema or migrations directory is DDL outside the chain."
          fi ;;
      esac
      case "$lc" in
        prisma\ migrate\ deploy|prisma\ migrate\ deploy\ *)
          ask "PRODUCTION LEDGER COMMAND: \`$c\` applies every pending migration to the production Supabase project ($PROD_REF). $PROTO — approve ONLY if all four hold for THIS run: (1) the owner approved this exact command in chat; (2) \`pnpm db:report-target DATABASE_URL\` and \`pnpm db:report-target DIRECT_URL\` both read classification PRODUCTION with project ref $PROD_REF; (3) preflight.sql was run read-only in this window and showed a CHECKED row and no BLOCK row; (4) afterwards BOTH the physical schema and _prisma_migrations will be verified and reported. Approve for this run only — never 'don't ask again'." ;;
        prisma\ migrate\ resolve*)
          if printf '%s' "$lc" | grep -Eq -- '--(applied|rolled-back)[ =][^ ]+'; then
            ask "PRODUCTION LEDGER COMMAND: \`$c\` records or unrecords ONE migration in _prisma_migrations without running its SQL. $PROTO — approve ONLY for THIS run: the owner approved this exact command and migration name in chat; the target report reads PRODUCTION / $PROD_REF; the migration's objects were verified present (--applied) or absent (--rolled-back) read-only first; the ledger is re-read and reported afterwards. Never 'don't ask again'."
          else
            deny "BLOCKED: \`$c\`. $PROTO authorizes exactly two resolve forms — \`prisma migrate resolve --applied <name>\` and \`prisma migrate resolve --rolled-back <name>\` — each per owner-approved run."
          fi ;;
        prisma\ migrate\ status*)
          ask "PRODUCTION READ: \`$c\` opens a connection to the production database and reads _prisma_migrations (read-only by design). $PROTO: per-run owner approval and the sanitized target report (pnpm db:report-target) come first; show the full output in chat." ;;
        prisma\ migrate\ diff*)
          if printf '%s' "$lc" | grep -Eq -- '--(from|to)-(url|schema-datasource|migrations)|--shadow-database-url'; then
            ask "PRODUCTION READ: \`$c\` connects to a database to diff it. $PROTO: per-run owner approval and the sanitized target report come first; show the full output in chat."
          fi ;;
      esac
    fi

    case "$lc" in
      vercel\ deploy*|vercel\ --prod*|vercel\ deploy\ --prod*|vercel\ rollback*|vercel\ promote*|vercel\ env\ rm*|vercel\ env\ add*)
        deny "BLOCKED: \`$c\`. CLAUDE.md -> Protected paths: 'Never run: vercel deploy'. Deploying is an owner action. Push the branch and let the pull request preview build." ;;
      vercel\ *)
        if printf '%s' "$lc" | grep -Eq '(^| )--prod( |$)'; then
          deny "BLOCKED: \`$c\` targets production. Deploying is an owner action (CLAUDE.md -> Protected paths)."
        fi
        ;;
    esac

    # Scoped to commands that actually execute SQL. A bare `grep -rn "drop table"`
    # must stay runnable — investigation is never the thing being blocked.
    case "$lc" in
      dropdb*|dropdb)
        deny "BLOCKED: \`$c\`. CLAUDE.md -> Protected paths: 'Never run: drop database'. The only database reachable from this repository is PRODUCTION." ;;
      psql*|pgcli*|mysql*|sqlite3*|prisma\ db\ execute*|pg_restore*)
        if printf '%s' "$lc" | grep -Eq 'drop +(database|schema|table)|truncate +(table )?[a-z_"]'; then
          deny "BLOCKED: \`$c\` executes destructive SQL. CLAUDE.md -> Protected paths: 'Never run: drop database'. The only database reachable from this repository is PRODUCTION; schema changes are owner/CI actions."
        fi
        ;;
    esac

    if [ "$inq" -eq 0 ]; then
      case "$lc" in
        pg_dump*|pg_dumpall*)
          if ! is_local_target "$linec"; then
            deny "BLOCKED: \`$c\` dumps production data (buyer PII included) into the session. $PROTO authorizes read-only verification queries, not dumps."
          fi ;;
        pg_restore*)
          if ! is_local_target "$linec"; then
            deny "BLOCKED: \`$c\` writes a dump into a database that is not positively loopback. $PROTO: no DML and no DDL outside a Prisma migration."
          fi ;;
        psql*|pgcli*) psql_in_line=1 ;;
      esac

      # --- deploy session: only what cannot open a client, plus the three operations
      if [ "$deploy_mode" -eq 1 ]; then
        case "$lc" in
          pnpm\ db:report-target*|pnpm\ typecheck*|pnpm\ lint*|pnpm\ install*|pnpm\ -v|pnpm\ --version|pnpm\ --help|\
          prisma\ generate*|prisma\ validate*|prisma\ format*|prisma\ -v|prisma\ --version|prisma\ --help|\
          prisma\ migrate\ deploy*|prisma\ migrate\ resolve*|prisma\ migrate\ status*|prisma\ migrate\ diff*|\
          node\ .claude/validate-skills.mjs*|bash\ .claude/hooks/__tests__/guards.test.sh*|bash\ -n\ *|tsc*|psql*|pgcli*) : ;;
          node|node\ *|nodejs*|tsx|tsx\ *|ts-node*|bun|bun\ *|bunx*|deno*|python*|perl*|ruby*|php*|pnpm*|npm*|yarn*|npx*|next*|prisma*|vercel*|supabase*|curl*|wget*|bash\ *|sh\ *|zsh\ *|dash\ *|ksh\ *|source\ *|.\ *|eval\ *)
            deny "BLOCKED in a DEPLOY SESSION: \`$c\`. A production connection string (DATABASE_URL / DIRECT_URL / PROD_READONLY_URL) is present in this environment and does not resolve to loopback, so anything that can open a database client — JS/TS runtimes, package scripts, shells running scripts, interpreters, HTTP clients — is refused ($PROTO). 19 files under frontend/scripts/ instantiate a client and \`pnpm test\` would run with the credential. Allowed here: pnpm db:report-target, the three operations (prisma migrate deploy | resolve --applied/--rolled-back | status, read-only psql), pnpm typecheck / lint, prisma generate / validate, git and read-only file tools. Development and tests belong in a session without the credential." ;;
        esac
      fi
    fi
  done <<SEGS
$(split_segments "$line")
SEGS

  if [ "$shell_in_line" -eq 1 ]; then
    inner="$(inner_command_of "$linec")"
    [ -n "$inner" ] && judge_inner "$inner"
  fi

  if [ "$psql_in_line" -eq 1 ]; then
    psql_line_check "$line"
    # A heredoc fed to psql: its body follows on the next lines.
    if printf '%s' "$linec" | grep -Eq "<<-?[[:space:]]*['\"]?[A-Za-z_][A-Za-z0-9_]*"; then
      hd_marker="$(printf '%s' "$linec" | sed -E "s/.*<<-?[[:space:]]*//; s/^['\"]//; s/[^A-Za-z0-9_].*//")"
      hd_body=""
      is_local_target "$linec" && hd_local=1 || hd_local=0
    fi
  fi
done <<EOF
$scrubbed
EOF

if [ "$any_interp" -eq 1 ] && printf '%s' "$scrubbed" | grep -Eq "$ENV_READ_RE"; then
  deny "BLOCKED: an inline script reads a production credential (${SECRET_VARS//|/, }) and could print or persist it. $PROTO: credentials are consumed by psql/prisma at runtime and never echoed, logged or written to a file. Presence check: [ -n \"\$DATABASE_URL\" ] && echo set. Sanitized description: pnpm db:report-target <VAR> (frontend/scripts/report-database-target.ts)."
fi

if [ -n "$ask_reason" ]; then
  decision ask "$ask_reason"
  exit 0
fi
exit 0
