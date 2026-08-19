#!/bin/bash
# AutoLenis SessionStart hook — installs frontend dependencies so tests,
# linters, and typecheck work in Claude Code on the web sessions.
# Idempotent and non-interactive. Runs synchronously by default.
set -euo pipefail

# Only run in the remote (Claude Code on the web) environment. Local sessions
# manage their own dependencies.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$PROJECT_DIR/frontend"

# The repo pins pnpm via package.json "packageManager". Prefer corepack so the
# exact pinned version is used; fall back to any pnpm already on PATH.
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare --activate >/dev/null 2>&1 || true
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found and could not be provisioned via corepack" >&2
  exit 1
fi

# Install dependencies. `pnpm install` (not `--frozen-lockfile`/ci) lets the
# cached container state be reused across sessions. The repo's postinstall
# runs `prisma generate`, which needs no live DB connection.
pnpm install

echo "AutoLenis frontend dependencies installed."
