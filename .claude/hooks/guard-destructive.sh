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
#   Hooks also run in permission modes where allow rules do not apply, run before
#   workspace trust, and run inside subagents — so this layer is not bypassable by
#   delegating the work to a subagent.
#
# CONTRACT: ../../CLAUDE.md -> "Protected paths & forbidden actions".
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

deny() {
  # Both documented block paths at once: the schema-exact JSON on stdout (the
  # supported mechanism; `{"decision":"block"}` is deprecated for PreToolUse) and
  # exit 2, which blocks even if the JSON is not read. A typo in a field name
  # would be a silently OPEN gate, so this string is written once, here.
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}' \
    "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g' | tr '\n' ' ' | sed 's/^/"/; s/$/"/')"
  printf '%s\n' "$1" >&2
  exit 2
}

# --- normalise one segment --------------------------------------------------
# Collapses whitespace, then peels leading env assignments, wrappers and
# environment runners until nothing more can be stripped.
norm() {
  local s
  s="$(printf '%s' "$1" | tr '\n\t' '  ' | sed 's/  */ /g; s/^ //; s/ $//')"
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
      t="${line#"${line%%[![:space:]]*}"}"; t="${t%"${t##*[![:space:]]}"}"
      [ "$t" = "$marker" ] && inhd=0
      continue
    fi
    out="$out$line
"
    if printf '%s' "$line" | grep -Eq "<<-?[[:space:]]*['\"]?[A-Za-z_][A-Za-z0-9_]*"; then
      pre="${line%%<<*}"
      if printf '%s' "$pre" | grep -Eq "(^|[[:space:];|(])(bash|sh|zsh|ksh|dash|python|python3|node|perl|ruby|psql|mysql|sqlite3)([[:space:]]|$)"; then
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

# --- inspect each subcommand -----------------------------------------------
# Split on every separator Claude Code itself recognises: && || ; | |& & newline.
segments="$(printf '%s' "$scrubbed" | sed -E 's/(\|\||&&|\|&|[;|&])/\n/g')"

while IFS= read -r raw; do
  [ -z "$raw" ] && continue
  c="$(norm "$raw")"
  [ -z "$c" ] && continue
  lc="$(printf '%s' "$c" | tr '[:upper:]' '[:lower:]')"

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

  # This repository's ORM is Prisma, not the Supabase CLI, and DATABASE_URL points
  # at the production project. These are the commands that would actually be typed
  # to mutate it, so they are covered by the same rule.
  case "$lc" in
    prisma\ migrate\ deploy*|prisma\ migrate\ reset*|prisma\ migrate\ dev*|prisma\ db\ push*|prisma\ db\ execute*|prisma\ db\ seed*)
      deny "BLOCKED: \`$c\`. DATABASE_URL resolves to the PRODUCTION Supabase project — there is no isolated branch database (CLAUDE.md -> CRITICAL ENVIRONMENT BOUNDARY). Applying or resetting migrations is an owner/CI action requiring separate explicit authorization. Write the new migration file; do not apply it." ;;
  esac

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
    psql*|mysql*|sqlite3*|prisma\ db\ execute*|pg_restore*)
      if printf '%s' "$lc" | grep -Eq 'drop +(database|schema|table)|truncate +(table )?[a-z_"]'; then
        deny "BLOCKED: \`$c\` executes destructive SQL. CLAUDE.md -> Protected paths: 'Never run: drop database'. The only database reachable from this repository is PRODUCTION; schema changes are owner/CI actions."
      fi
      ;;
  esac
done <<EOF
$segments
EOF

exit 0
