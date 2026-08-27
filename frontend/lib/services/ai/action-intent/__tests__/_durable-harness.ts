// A fake AiActionIntent delegate that faithfully models the DB semantics the
// durable store relies on:
//   • a unique constraint on idempotency_key (duplicate insert → P2002);
//   • conditional updateMany(where {id, status:from}) that updates a row ONLY
//     when it currently matches, returning the affected count.
// Because each updateMany body runs to completion with no internal await, two
// awaited updateMany calls cannot interleave — exactly one sees count 1 and the
// rest see 0, which is precisely the single-winner atomicity Postgres row
// locking provides for the claim. This lets the exactly-once property be proven
// hermetically; a real-Postgres test (postgres-concurrency.test.ts) covers the
// true-parallel DB guarantee.

import type { AiActionIntentDelegate, AiActionIntentRow } from "../prisma-store";

type Row = AiActionIntentRow;

function defaults(): Partial<Row> {
  return {
    subjectId: null,
    rationale: null,
    policyResult: null,
    approverId: null,
    approverRole: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionCode: null,
    executionClaimedAt: null,
    executionAttempts: 0,
    result: null,
    failureReason: null,
    completedAt: null,
    idempotencyKey: null,
  };
}

function whereMatches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v);
}

function applyData(row: Row, data: Record<string, unknown>): void {
  const r = row as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as Record<string, unknown>)) {
      r[k] = ((r[k] as number) ?? 0) + ((v as { increment: number }).increment ?? 0);
    } else {
      r[k] = v;
    }
  }
  r.updatedAt = new Date();
}

export class FakeAiActionIntentDb {
  readonly rows = new Map<string, Row>();

  /** A fresh delegate over the SAME underlying rows — simulates a separate
   *  request/process hitting the same database. */
  delegate(): AiActionIntentDelegate {
    const rows = this.rows;
    return {
      async create({ data }) {
        const key = data.idempotencyKey as string | null | undefined;
        if (key && [...rows.values()].some((r) => r.idempotencyKey === key)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const now = new Date();
        const row = { ...defaults(), ...data, createdAt: now, updatedAt: now } as unknown as Row;
        rows.set(row.id, row);
        return { ...row };
      },
      async findUnique({ where }) {
        if (typeof where.id === "string") return rows.get(where.id) ? { ...rows.get(where.id)! } : null;
        if (typeof where.idempotencyKey === "string") {
          const found = [...rows.values()].find((r) => r.idempotencyKey === where.idempotencyKey);
          return found ? { ...found } : null;
        }
        return null;
      },
      async findFirst({ where }) {
        const found = [...rows.values()].find((r) => whereMatches(r, where));
        return found ? { ...found } : null;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of rows.values()) {
          if (whereMatches(row, where)) {
            applyData(row, data);
            count += 1;
          }
        }
        return { count };
      },
      async findMany({ where }) {
        return [...rows.values()].filter((r) => whereMatches(r, where)).map((r) => ({ ...r }));
      },
    };
  }
}
