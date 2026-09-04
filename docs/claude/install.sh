#!/usr/bin/env bash
# AutoLenis Claude Operating System — installer
#
# Kept in the repository for provenance and reproducibility: this is the script
# that produced `CLAUDE.md`, `.claude/**` and `docs/claude/**`. It is AutoLenis
# only — the multi-project profile switch was removed, so there is nothing to
# choose and nothing to get wrong.
#
# It runs from inside the unzipped bundle, whose payload lives beside it in
# `autolenis/` (and `global/` for the user-memory mode).
#
# Usage:
#   ./install.sh --repo /path/to/autolenisNewUpdatedfinal
#   ./install.sh --user-memory
#   (add --dry-run to either to see the plan without writing)
#
# SAFETY CONTRACT — this script will never destroy your work:
#   * An existing file is NEVER overwritten. If it differs from ours, we write a
#     sibling <file>.claude-os.proposed and leave yours untouched.
#   * settings.json is the one exception: it is MERGED (never replaced), after a
#     timestamped backup. Merging only ADDS permission rules and hooks; nothing is
#     removed. CAUTION: rules added to `allow` WIDEN what runs without a prompt.
#     Read the bundle's allow list before installing; only `deny` additions tighten.
#   * Nothing is committed, pushed, merged, or deployed. No git command is run
#     except read-only detection.

set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD="autolenis"
REPO=""; DRY=0; USER_MEMORY=0
INSTALLED=(); PROPOSED=(); UNCHANGED=(); MERGED=()

die() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)        REPO="${2:-}"; shift 2 ;;
    # Accepted so the documented command still works; autolenis is the only payload.
    --profile)
      case "${2:-}" in
        autolenis|"") ;;
        *) die "this installer is AutoLenis only; --profile ${2} is not available." ;;
      esac
      shift 2 ;;
    --dry-run)     DRY=1; shift ;;
    --user-memory) USER_MEMORY=1; shift ;;
    -h|--help)     sed -n '2,26p' "$0"; exit 0 ;;
    *)             die "unknown argument: $1" ;;
  esac
done

command -v python3 >/dev/null 2>&1 || die "python3 is required (used for safe JSON merging)."

# ---------------------------------------------------------------- helpers
plan() { [ "$DRY" = "1" ] && printf '  [dry-run] %s\n' "$1" || true; }

install_file() {  # src dst
  local src="$1" dst="$2" rel="${2#"$TARGET"/}"
  if [ -f "$dst" ]; then
    if cmp -s "$src" "$dst"; then
      UNCHANGED+=("$rel"); return
    fi
    PROPOSED+=("$rel")
    if [ "$DRY" = "0" ]; then
      mkdir -p "$(dirname "$dst")"
      cp "$src" "${dst}.claude-os.proposed"
    fi
    plan "would write ${rel}.claude-os.proposed (yours differs, left untouched)"
    return
  fi
  INSTALLED+=("$rel")
  if [ "$DRY" = "0" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
  plan "would install $rel"
}

merge_settings() {  # src dst
  local src="$1" dst="$2"
  if [ ! -f "$dst" ]; then install_file "$src" "$dst"; return; fi
  if cmp -s "$src" "$dst"; then UNCHANGED+=(".claude/settings.json"); return; fi
  MERGED+=(".claude/settings.json")
  [ "$DRY" = "1" ] && { plan "would merge .claude/settings.json (backup kept)"; return; }
  cp "$dst" "${dst}.bak.$(date +%Y%m%d%H%M%S)"
  python3 - "$src" "$dst" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
new  = json.load(open(src))
cur  = json.load(open(dst))

# permissions: union each list, preserve existing order, append what's missing
perms_new, perms_cur = new.get("permissions", {}), cur.setdefault("permissions", {})
for key in ("allow", "ask", "deny"):
    existing = perms_cur.setdefault(key, [])
    for rule in perms_new.get(key, []):
        if rule not in existing:
            existing.append(rule)

# hooks: append matcher groups; skip any hook whose command is already registered
hooks_new, hooks_cur = new.get("hooks", {}), cur.setdefault("hooks", {})
def commands(groups):
    return {h.get("command") for g in groups for h in g.get("hooks", [])}
for event, groups in hooks_new.items():
    existing = hooks_cur.setdefault(event, [])
    have = commands(existing)
    for group in groups:
        keep = [h for h in group.get("hooks", []) if h.get("command") not in have]
        if keep:
            g = dict(group); g["hooks"] = keep
            existing.append(g)

json.dump(cur, open(dst, "w"), indent=2)
open(dst, "a").write("\n")
PY
}

report() {
  printf '\n──────────── %s ────────────\n' "${1}"
  _list() { local label="$1"; shift; [ $# -eq 0 ] && return; printf '\n%s\n' "$label"; printf '  %s\n' "$@"; }
  [ "${#INSTALLED[@]}" -gt 0 ] && _list "INSTALLED (new files):"            "${INSTALLED[@]}"
  [ "${#MERGED[@]}"    -gt 0 ] && _list "MERGED (backup kept alongside):"   "${MERGED[@]}"
  [ "${#UNCHANGED[@]}" -gt 0 ] && _list "ALREADY IDENTICAL (no action):"    "${UNCHANGED[@]}"
  [ "${#PROPOSED[@]}"  -gt 0 ] && _list "NOT TOUCHED — review .claude-os.proposed sibling and merge by hand:" "${PROPOSED[@]}"
  return 0
}

# ---------------------------------------------------------------- user memory
if [ "$USER_MEMORY" = "1" ]; then
  TARGET="$HOME/.claude"
  [ "$DRY" = "0" ] && mkdir -p "$TARGET"
  install_file "$BUNDLE_DIR/global/user-CLAUDE.md" "$TARGET/CLAUDE.md"
  report "user memory: ~/.claude/CLAUDE.md"
  printf '\nDone.\n'
  exit 0
fi

# ---------------------------------------------------------------- repo install
[ -n "$REPO" ] || die "--repo is required (or use --user-memory). See --help."

REPO="${REPO/#\~/$HOME}"
[ -d "$REPO" ] || die "not a directory: $REPO"
SRC="$BUNDLE_DIR/$PAYLOAD"
[ -d "$SRC" ]  || die "bundle payload missing: $SRC (run this script from inside the unzipped bundle)"
TARGET="$(cd "$REPO" && pwd)"

[ -d "$TARGET/.git" ] || printf 'WARNING: %s has no .git — is this the right repo root?\n' "$TARGET"
if [ -d "$TARGET/.git" ] && command -v git >/dev/null 2>&1; then
  BRANCH="$(git -C "$TARGET" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"; BRANCH="${BRANCH:-unknown}"
  DIRTY="$(git -C "$TARGET" status --porcelain 2>/dev/null | wc -l | tr -d ' ' || true)"; DIRTY="${DIRTY:-0}"
  printf 'Repo: %s\nBranch: %s (%s uncommitted change(s))\n' "$TARGET" "$BRANCH" "$DIRTY"
  if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
    printf 'NOTE: you are on %s. AutoLenis is branch-only — branch before installing.\n' "$BRANCH"
  fi
fi

# Preflight: refuse to start if the repo's settings.json is not strict JSON. Without
# this, the merge dies mid-install *after* CLAUDE.md has landed and *before* the hooks
# do — leaving guidance installed with no enforcement, and no report printed.
CUR_SETTINGS="$TARGET/.claude/settings.json"
if [ -f "$CUR_SETTINGS" ] && ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$CUR_SETTINGS" 2>/dev/null; then
  die "$CUR_SETTINGS is not strict JSON (comments and trailing commas are not allowed). Fix it and re-run. Nothing was written."
fi

install_file "$SRC/CLAUDE.md" "$TARGET/CLAUDE.md"
merge_settings "$SRC/.claude/settings.json" "$TARGET/.claude/settings.json"

for sub in hooks commands agents; do
  [ -d "$SRC/.claude/$sub" ] || continue
  for f in "$SRC/.claude/$sub"/*; do
    [ -f "$f" ] || continue
    install_file "$f" "$TARGET/.claude/$sub/$(basename "$f")"
  done
done

# Prompt templates live in docs/ so they are always committed and reachable by the
# @-imports in .claude/commands/prompt-for-claude-code.md.
if [ -d "$SRC/docs/claude" ]; then
  for f in "$SRC/docs/claude"/*; do
    [ -f "$f" ] || continue
    install_file "$f" "$TARGET/docs/claude/$(basename "$f")"
  done
fi

if [ "$DRY" = "0" ]; then
  chmod +x "$TARGET"/.claude/hooks/*.sh 2>/dev/null || true
fi

if [ -f "$TARGET/.claude/hooks/typecheck.sh" ]; then
  printf '\nNOTE: .claude/hooks/typecheck.sh is from an earlier version of this bundle.\n'
  printf '      It ran a full tsc after every edit and is superseded by the guard hooks.\n'
  printf '      Delete it and remove any settings.json hook pointing at it.\n'
fi

report "AutoLenis → $TARGET"

cat <<'NEXT'

NEXT STEPS
  1. If anything is listed under NOT TOUCHED, open the .claude-os.proposed sibling
     and merge the parts you want by hand. Your original was not modified.
  2. Fill any <FILL IN ...> placeholders in CLAUDE.md from frontend/package.json —
     not from memory. This repo uses pnpm 10.33.0:
       Lint   pnpm lint            (eslint . --ext .ts,.tsx)
       Build  pnpm build           (prisma generate && next build)
       Tests  pnpm test:all        (65 test:* invocations; pnpm test is a subset)
     The harness is node:test via tsx, plus Playwright. There is no Jest or Vitest.
  3. Verify:
       jq . .claude/settings.json
       bash -n .claude/hooks/*.sh
       bash .claude/hooks/__tests__/guards.test.sh
       node .claude/validate-skills.mjs
       claude          # then: /context   /permissions   /investigate <small thing>
  4. Prove the enforcement layer works — in a SCRATCH CLONE, ask Claude Code to run
     a hard reset and a `supabase db push`. Both must be blocked. If either is not,
     the hook path or the permission syntax is wrong for your CLI version; fix that
     before trusting it. `.claude/OPERATING_SYSTEM.md` has the full block/allow
     table, and what these layers do NOT protect against.

Nothing was committed or pushed. Review `git status` and `git diff` yourself.
NEXT
