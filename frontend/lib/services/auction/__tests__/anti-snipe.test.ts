// Y6 — anti-snipe auto-extension. Injected fake prisma models the atomic guarded
// updateMany (status ACTIVE + exact endsAt + count < cap) so the no-double-extend
// guarantee is provable offline.
//   npx tsx --test lib/services/auction/__tests__/anti-snipe.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  maybeExtendForAntiSnipe,
  SNIPE_WINDOW_MINUTES,
  EXTENSION_MINUTES,
  MAX_AUTO_EXTENSIONS,
} from "../anti-snipe.service";

const NOW = new Date("2026-08-10T12:00:00Z");
const minsFromNow = (m: number) => new Date(NOW.getTime() + m * 60_000);

interface AuctionRow { id: string; status: string; endsAt: Date | null; autoExtensionCount: number }

function fakePrisma(row: AuctionRow): { prisma: PrismaClient; row: AuctionRow; logs: Array<Record<string, unknown>> } {
  const logs: Array<Record<string, unknown>> = [];
  const prisma = {
    auction: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === row.id ? { ...row } : null),
      updateMany: async ({ where, data }: {
        where: { id: string; status?: string; endsAt?: Date; autoExtensionCount?: { lt: number } };
        data: { endsAt?: Date; autoExtensionCount?: { increment: number } };
      }) => {
        if (where.id !== row.id) return { count: 0 };
        if (where.status && row.status !== where.status) return { count: 0 };
        if (where.endsAt && (!row.endsAt || row.endsAt.getTime() !== where.endsAt.getTime())) return { count: 0 };
        if (where.autoExtensionCount && !(row.autoExtensionCount < where.autoExtensionCount.lt)) return { count: 0 };
        if (data.endsAt) row.endsAt = data.endsAt;
        if (data.autoExtensionCount) row.autoExtensionCount += data.autoExtensionCount.increment;
        return { count: 1 };
      },
    },
    auctionExtensionLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        logs.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, row, logs };
}

test("a bid inside the snipe window extends endsAt by EXTENSION_MINUTES and logs ANTI_SNIPE", async () => {
  const endsAt = minsFromNow(3); // within the 5-min window
  const { prisma, row, logs } = fakePrisma({ id: "a1", status: "ACTIVE", endsAt, autoExtensionCount: 0 });
  const r = await maybeExtendForAntiSnipe("a1", { prisma, now: NOW });
  assert.equal(r.extended, true);
  assert.equal(row.endsAt!.getTime(), endsAt.getTime() + EXTENSION_MINUTES * 60_000);
  assert.equal(row.autoExtensionCount, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].source, "ANTI_SNIPE");
  assert.equal(logs[0].minutesAdded, EXTENSION_MINUTES);
});

test("a bid OUTSIDE the snipe window does not extend", async () => {
  const endsAt = minsFromNow(SNIPE_WINDOW_MINUTES + 10);
  const { prisma, row, logs } = fakePrisma({ id: "a1", status: "ACTIVE", endsAt, autoExtensionCount: 0 });
  const r = await maybeExtendForAntiSnipe("a1", { prisma, now: NOW });
  assert.equal(r.extended, false);
  assert.equal(row.endsAt!.getTime(), endsAt.getTime()); // unchanged
  assert.equal(logs.length, 0);
});

test("does not extend past the cap", async () => {
  const { prisma, row } = fakePrisma({ id: "a1", status: "ACTIVE", endsAt: minsFromNow(2), autoExtensionCount: MAX_AUTO_EXTENSIONS });
  const r = await maybeExtendForAntiSnipe("a1", { prisma, now: NOW });
  assert.equal(r.extended, false);
  assert.equal(row.autoExtensionCount, MAX_AUTO_EXTENSIONS);
});

test("does not extend a non-ACTIVE auction", async () => {
  const { prisma } = fakePrisma({ id: "a1", status: "CLOSED", endsAt: minsFromNow(2), autoExtensionCount: 0 });
  const r = await maybeExtendForAntiSnipe("a1", { prisma, now: NOW });
  assert.equal(r.extended, false);
});

test("does not extend an already-ended auction", async () => {
  const { prisma } = fakePrisma({ id: "a1", status: "ACTIVE", endsAt: minsFromNow(-1), autoExtensionCount: 0 });
  const r = await maybeExtendForAntiSnipe("a1", { prisma, now: NOW });
  assert.equal(r.extended, false);
});

test("concurrent in-window bids extend at most ONCE (atomic guard)", async () => {
  const endsAt = minsFromNow(1);
  const { prisma, row, logs } = fakePrisma({ id: "a1", status: "ACTIVE", endsAt, autoExtensionCount: 0 });
  const [a, b] = await Promise.all([
    maybeExtendForAntiSnipe("a1", { prisma, now: NOW }),
    maybeExtendForAntiSnipe("a1", { prisma, now: NOW }),
  ]);
  assert.equal([a.extended, b.extended].filter(Boolean).length, 1, "exactly one extension");
  assert.equal(row.autoExtensionCount, 1);
  assert.equal(logs.length, 1);
});
