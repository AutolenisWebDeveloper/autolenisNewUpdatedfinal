#!/bin/bash
# AutoLenis PreToolUse guard — protected file paths.
#
# WHY THIS EXISTS ON TOP OF permissions.deny:
#   A path rule cannot express "never edit an EXISTING migration, but adding a new
#   one is fine" — `Edit(**/prisma/migrations/**)` in deny would also block writing
#   the new migration the work legitimately needs, and `ask` would wave through an
#   edit to an applied one. That distinction is the actual contract
#   (CLAUDE.md -> Protected paths), so it is enforced here, where the file's
#   existence can be tested.
#   It also covers NotebookEdit, which the docs state a `Read` deny rule does NOT
#   cover, and it names the one route the owner has ring-fenced pending a
#   separately authorized security batch.
#
# FAIL BEHAVIOUR: unparseable input exits 0 (the call proceeds to the normal
# permission flow, where permissions.deny still applies). Only a positive match
# denies. Set AUTOLENIS_GUARD=off to disable.

set -u

[ "${AUTOLENIS_GUARD:-}" = "off" ] && exit 0

payload="$(cat 2>/dev/null || true)"
[ -z "$payload" ] && exit 0

extract() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null && return 0
  fi
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$payload" | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        try{const t=JSON.parse(s)?.tool_input??{};process.stdout.write(String(t.file_path??t.notebook_path??""))}catch{}
      })' 2>/dev/null && return 0
  fi
  return 1
}

fp="$(extract)" || exit 0
[ -z "$fp" ] && exit 0
[ "$fp" = "null" ] && exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)}"
case "$fp" in
  /*) abs="$fp" ;;
  *)  abs="$root/$fp" ;;
esac
# Repo-relative form, for matching and for the message.
rel="${abs#"$root"/}"
base="$(basename -- "$fp")"

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}' \
    "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g' | tr '\n' ' ' | sed 's/^/"/; s/$/"/')"
  printf '%s\n' "$1" >&2
  exit 2
}

# 1. Secrets. `Read` deny already covers Read/Edit/Write; this also covers
#    NotebookEdit, which the docs say a Read rule does not.
case "$base" in
  .env|.env.*)
    deny "BLOCKED: \`$rel\`. CLAUDE.md -> Protected paths: 'never read or edit .env*'. Environment values are owner-managed and are set in Vercel, not in the repository. The variable NAMES the build requires are listed in .github/workflows/ci.yml." ;;
esac

# 2. Migrations: adding a new one is normal work; changing one that already exists
#    is not, because it may already be applied to the PRODUCTION database.
case "$rel" in
  *prisma/migrations/*|*supabase/migrations/*|frontend/migrations/*)
    if [ -e "$abs" ]; then
      deny "BLOCKED: \`$rel\` already exists. CLAUDE.md -> Protected paths: 'Never edit existing files in migrations'. This migration may already be applied to the PRODUCTION database, so editing it silently diverges the chain from what production actually ran — and CI replays the whole chain against an empty database. Add a NEW migration that makes the change forward. Creating a new file in this directory is not blocked."
    fi
    ;;
esac

# 3. The one route the owner has ring-fenced. CLAUDE.md -> Known security finding:
#    it needs a separately authorized security batch, and must not be quietly
#    "fixed in passing", hidden, or removed. A separately authorized batch runs
#    with AUTOLENIS_GUARD=off, or removes this rule as part of that batch.
case "$rel" in
  frontend/app/api/admin/content/attribution/export/route.ts)
    deny "BLOCKED: \`$rel\`. CLAUDE.md -> Known security finding: this route exports CSV containing buyer email and is authenticated-only with no dedicated role gate. Its server authorization requires a SEPARATELY AUTHORIZED security batch — do not fix it in passing, and do not hide or remove the capability. Report it and stop." ;;
esac

exit 0
