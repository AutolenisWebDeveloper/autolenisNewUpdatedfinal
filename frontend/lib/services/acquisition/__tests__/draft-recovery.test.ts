// §6.4 — the four-touch recovery sequence and the 14-day abandonment.
//
// Run: pnpm test:intake

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const enqueued: Array<Record<string, unknown>> = [];
const cancelled: Array<{ key: string; reason: string }> = [];
const requests = new Map<string, Record<string, unknown>>();

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Record<string, unknown>) => {
      const key = String(input.idempotencyKey);
      if (enqueued.some((e) => e.idempotencyKey === key)) return { enqueued: false, id: null, dedupKey: key };
      enqueued.push(input);
      return { enqueued: true, id: `row_${enqueued.length}`, dedupKey: key };
    },
    cancelByKey: async (key: string, reason: string) => {
      cancelled.push({ key, reason });
      return { cancelled: 2 };
    },
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      vehicleRequest: {
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          [...requests.values()].filter((r) => {
            const cutoff = (where.createdAt as { lt: Date }).lt;
            return r.status === "DRAFT" && r.abandonedAt === null && (r.createdAt as Date) < cutoff;
          }),
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          Object.assign(requests.get(where.id)!, data);
          return {};
        },
      },
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {} } } });

function svc() {
  return import("@/lib/services/acquisition/draft-recovery.service");
}

beforeEach(() => {
  enqueued.length = 0;
  cancelled.length = 0;
  requests.clear();
});

test("all FOUR touches are enqueued at capture, at §6.4's timings", async () => {
  const { enqueueDraftRecovery } = await svc();
  const from = new Date("2026-03-01T00:00:00Z");
  const r = await enqueueDraftRecovery({ vehicleRequestId: "vr1", email: "b@x.com", firstName: "Sam", from });

  assert.equal(r.enqueued, 4, "the sequence must exist in the database the moment the visitor closes the tab");
  const offsets = enqueued.map((e) => (e.runAt as Date).getTime() - from.getTime());
  assert.deepEqual(offsets, [0, 3_600_000, 86_400_000, 259_200_000], "immediately, 1h, 24h, 72h");
});

test("all four share ONE cancel key, so the sequence stops together", async () => {
  const { enqueueDraftRecovery, draftRecoveryCancelKey } = await svc();
  await enqueueDraftRecovery({ vehicleRequestId: "vr1", email: "b@x.com" });
  const keys = new Set(enqueued.map((e) => e.cancelKey));
  assert.equal(keys.size, 1);
  assert.equal([...keys][0], draftRecoveryCancelKey("vr1"));
});

test("each touch is keyed on the REQUEST, not the address", async () => {
  const { enqueueDraftRecovery } = await svc();
  await enqueueDraftRecovery({ vehicleRequestId: "vr1", email: "b@x.com" });
  for (const e of enqueued) {
    assert.match(String(e.idempotencyKey), /vr1$/, "a key on the address would collide across a shared mailbox");
  }
});

test("re-enqueuing the same sequence adds nothing", async () => {
  const { enqueueDraftRecovery } = await svc();
  await enqueueDraftRecovery({ vehicleRequestId: "vr1", email: "b@x.com" });
  const second = await enqueueDraftRecovery({ vehicleRequestId: "vr1", email: "b@x.com" });
  assert.equal(second.enqueued, 0);
  assert.equal(enqueued.length, 4);
});

test("cancelling stops the whole sequence", async () => {
  const { cancelDraftRecovery, draftRecoveryCancelKey } = await svc();
  const n = await cancelDraftRecovery("vr1", "request submitted");
  assert.equal(n, 2);
  assert.deepEqual(cancelled, [{ key: draftRecoveryCancelKey("vr1"), reason: "request submitted" }]);
});

test("abandonment STAMPS at 14 days and NEVER deletes", async () => {
  const { abandonStaleDrafts, DRAFT_ABANDON_AFTER_DAYS } = await svc();
  const now = new Date("2026-03-20T00:00:00Z");
  const old = new Date("2026-03-01T00:00:00Z"); // 19 days
  const recent = new Date("2026-03-18T00:00:00Z"); // 2 days

  requests.set("vr_old", { id: "vr_old", status: "DRAFT", abandonedAt: null, createdAt: old });
  requests.set("vr_recent", { id: "vr_recent", status: "DRAFT", abandonedAt: null, createdAt: recent });

  const result = await abandonStaleDrafts(now);
  assert.equal(DRAFT_ABANDON_AFTER_DAYS, 14);
  assert.deepEqual(result.abandoned, ["vr_old"]);

  // §6.4 says never delete, twice. The row, its status and its history all stay.
  assert.equal(requests.size, 2);
  assert.equal(requests.get("vr_old")!.abandonedAt, now);
  assert.equal(
    requests.get("vr_old")!.status,
    "DRAFT",
    "the status is unchanged so the buyer resumes the same request rather than starting a second one"
  );
  assert.equal(requests.get("vr_recent")!.abandonedAt, null);

  // And the pending touches are cancelled with it.
  assert.equal(cancelled.length, 1);
  assert.match(cancelled[0]!.reason, /14 days/);
});

test("an already-abandoned draft is not re-abandoned", async () => {
  const { abandonStaleDrafts } = await svc();
  const now = new Date("2026-03-20T00:00:00Z");
  requests.set("vr1", {
    id: "vr1",
    status: "DRAFT",
    abandonedAt: new Date("2026-03-15T00:00:00Z"),
    createdAt: new Date("2026-03-01T00:00:00Z"),
  });
  const result = await abandonStaleDrafts(now);
  assert.deepEqual(result.abandoned, []);
});
