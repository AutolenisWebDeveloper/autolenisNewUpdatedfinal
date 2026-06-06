#!/bin/bash
# Smoke test for the migration drift guard (P0-1).
# Requires a reachable shadow Postgres (see scripts/check-migration-drift.ts).
set -e
echo "Smoke-testing drift guard..."
pnpm check:drift
echo "✅ Drift guard passes on current state."
