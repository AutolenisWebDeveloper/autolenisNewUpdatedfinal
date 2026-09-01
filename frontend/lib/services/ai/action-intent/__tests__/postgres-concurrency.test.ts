// Real-Postgres exactly-once claim. The atomic execution-claim correctness
// ultimately depends on the DATABASE enforcing that exactly one concurrent
// `UPDATE ... WHERE status = 'from'` sees a row. The fake DB models this, but
// only a real Postgres proves it under true parallelism.
//
// This test runs ONLY when ACTION_INTENT_TEST_DATABASE_URL points at a scratch
// Postgres. When it is unset (as in the standard CI/sandbox), the test SKIPS and
// the property is reported as NOT VERIFIED rather than fabricated as a PASS.
//
//   ACTION_INTENT_TEST_DATABASE_URL=postgres://... \
//     npx tsx --test lib/services/ai/action-intent/__tests__/postgres-concurrency.test.ts

import test from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.ACTION_INTENT_TEST_DATABASE_URL;

test("exactly one of N concurrent EXECUTING claims wins on real Postgres", async (t) => {
  if (!TEST_DB) {
    t.skip("NOT VERIFIED — set ACTION_INTENT_TEST_DATABASE_URL to a scratch Postgres to run this");
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
  try {
    // Ensure the table/enum exist (idempotent — matches the migration).
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiActionIntentStatus') THEN
          CREATE TYPE "AiActionIntentStatus" AS ENUM ('PROPOSED','APPROVAL_REQUIRED','APPROVED','REJECTED','EXECUTING','COMPLETED','FAILED');
        END IF;
      END $$;`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ai_action_intents" (
        "id" TEXT PRIMARY KEY, "intent_type" TEXT NOT NULL,
        "status" "AiActionIntentStatus" NOT NULL DEFAULT 'PROPOSED',
        "actor_type" TEXT NOT NULL, "actor_id" TEXT NOT NULL, "authenticated_role" TEXT NOT NULL,
        "subject_id" TEXT, "parameters" JSONB NOT NULL, "consequence" TEXT NOT NULL,
        "requires_human_approval" BOOLEAN NOT NULL, "idempotency_key" TEXT,
        "rationale" TEXT, "policy_result" JSONB, "approver_id" TEXT, "approver_role" TEXT,
        "approved_at" TIMESTAMP(3), "rejected_at" TIMESTAMP(3), "rejection_code" TEXT,
        "execution_claimed_at" TIMESTAMP(3), "execution_attempts" INTEGER NOT NULL DEFAULT 0,
        "result" JSONB, "failure_reason" TEXT, "completed_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`);

    const id = `pg-claim-${Date.now()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ai_action_intents"
       ("id","intent_type","status","actor_type","actor_id","authenticated_role","parameters","consequence","requires_human_approval","updated_at")
       VALUES ($1,'admin.advance_deal_status','APPROVED','ADMIN','a1','OPERATIONS_ADMIN','{}','CONSEQUENTIAL',true,CURRENT_TIMESTAMP)`,
      id,
    );

    const claim = () =>
      prisma.$executeRawUnsafe(
        `UPDATE "ai_action_intents" SET "status"='EXECUTING', "execution_attempts"="execution_attempts"+1, "execution_claimed_at"=CURRENT_TIMESTAMP
         WHERE "id"=$1 AND "status"='APPROVED'`,
        id,
      );
    // $executeRawUnsafe returns the affected row count.
    const counts = await Promise.all([claim(), claim(), claim(), claim(), claim()]);
    const winners = counts.filter((c) => Number(c) === 1);
    assert.equal(winners.length, 1, "exactly one concurrent claim affects the row");

    const [row] = await prisma.$queryRawUnsafe<Array<{ execution_attempts: number }>>(
      `SELECT "execution_attempts" FROM "ai_action_intents" WHERE "id"=$1`,
      id,
    );
    assert.equal(Number(row.execution_attempts), 1, "attempt counter incremented exactly once");

    await prisma.$executeRawUnsafe(`DELETE FROM "ai_action_intents" WHERE "id"=$1`, id);
  } finally {
    await prisma.$disconnect();
  }
});
