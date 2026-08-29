// D3b — proven-alive spot check. D3b wired the remaining scheduled crons through
// withCronRun. This proves, on representative routes across the mechanism (a
// service-call cron, a prisma-deleteMany cron, and a prisma-updateMany cron), that
// hitting the route WRITES a CronJobLog run (RUNNING → COMPLETED) with the right
// cronName, and that an unauthenticated call writes nothing. A regression that
// unwires a route (or drops/renames the cronName) fails here.
//
// Run: pnpm test:cron

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const cronLog = { create: [] as Array<Record<string, unknown>>, update: [] as Array<Record<string, unknown>> };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      cronJobLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          cronLog.create.push(data);
          return { id: "log_1", startedAt: new Date() };
        },
        findUnique: async () => ({ id: "log_1", startedAt: new Date(Date.now() - 250) }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          cronLog.update.push(data);
          return { id: "log_1" };
        },
      },
      session: { deleteMany: async () => ({ count: 3 }) },
      commission: { updateMany: async () => ({ count: 2 }) },
    },
  },
});

// sla-check delegates to checkSLAs; stub it so the only DB touch is the run record.
mock.module("@/lib/services/monitoring/health.service", {
  namedExports: { checkSLAs: async () => ({ breached: 0, warnings: 0 }) },
});

// affiliates delegates to approveMaturePendingCommissions (M2 — payment-state
// gated approval); stub it for the same reason. The real service transitively
// imports lib/events/emit (`server-only`), which cannot load under the test
// runner — its behaviour is covered by commission-approval-safety.test.ts.
mock.module("@/lib/services/affiliate/commission.service", {
  namedExports: { approveMaturePendingCommissions: async () => ({ approved: 2, held: 0, checked: 2 }) },
});

function cronReq(path: string) {
  return new NextRequest(`http://localhost${path}`, { headers: { authorization: "Bearer test-secret" } });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  cronLog.create = [];
  cronLog.update = [];
});

const CASES = [
  { name: "sla-check", mod: "@/app/api/cron/sla-check/route", path: "/api/cron/sla-check" },
  { name: "sessions", mod: "@/app/api/cron/sessions/route", path: "/api/cron/sessions" },
  { name: "affiliates", mod: "@/app/api/cron/affiliates/route", path: "/api/cron/affiliates" },
];

for (const c of CASES) {
  test(`${c.name} writes a CronJobLog run when invoked (proven alive)`, async () => {
    const mod = await import(c.mod);
    const res = await mod.GET(cronReq(c.path));
    assert.equal(res.status, 200);
    assert.equal(cronLog.create.length, 1, "a RUNNING record is written");
    assert.equal(cronLog.create[0]!.cronName, c.name, "cronName matches the directory");
    assert.equal(cronLog.create[0]!.status, "RUNNING");
    assert.equal(cronLog.update.at(-1)!.status, "COMPLETED", "and completes");
  });
}

test("an unauthenticated D3b cron call writes NO run record", async () => {
  const mod = await import("@/app/api/cron/sla-check/route");
  const res = await mod.GET(new NextRequest("http://localhost/api/cron/sla-check"));
  assert.equal(res.status, 401);
  assert.equal(cronLog.create.length, 0, "auth is checked before any run is recorded");
});
