#!/usr/bin/env node
/**
 * Migration drift guard (P0-1).
 *
 * Exits non-zero if the committed migrations under prisma/migrations do NOT
 * reproduce prisma/schema.prisma. Run locally before any PR merge and in CI
 * before deploy. Catches the class of bug that caused production drift: schema
 * changes applied via `prisma db push` without a matching migration.
 *
 * NOTE: `prisma migrate diff --from-migrations` replays the migration history
 * into a shadow database, so this requires a reachable Postgres (a throwaway
 * shadow DB locally, or a Postgres service in CI). It must NEVER be pointed at
 * production — the shadow DB is created and dropped by the migration engine.
 */
import { execSync } from "child_process";
import { exit } from "process";

try {
  execSync(
    "prisma migrate diff " +
      "--from-migrations prisma/migrations " +
      "--to-schema-datamodel prisma/schema.prisma " +
      "--exit-code",
    { stdio: "inherit", cwd: `${__dirname}/..` },
  );
  console.log("✅ No migration drift detected.");
} catch {
  console.error(
    "❌ MIGRATION DRIFT DETECTED.\n" +
      "prisma/schema.prisma diverges from prisma/migrations. " +
      "Do NOT run `prisma db push`. Generate a proper migration:\n" +
      "  pnpm prisma migrate dev --name <descriptive_name>\n" +
      "and add idempotent SQL (CREATE/ADD COLUMN IF NOT EXISTS, " +
      "ALTER TYPE ... ADD VALUE IF NOT EXISTS).",
  );
  exit(1);
}
