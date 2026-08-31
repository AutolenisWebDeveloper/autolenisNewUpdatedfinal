// Route contract tests for POST /api/admin/content/articles/bulk — the endpoint
// behind every bulk publish / archive / move-to-draft on the Content worktable.
//
// This endpoint mutates an unbounded number of rows from a FILTER, so the thing
// worth pinning is not the happy path but the blast radius: exactly which rows
// a given payload resolves to. Two regressions are covered.
//
//  1. EXCLUSIONS. "Select all matching, except these" is now a real operator
//     intent. If excludeIds were ignored, un-ticking a row before confirming
//     would publish it anyway — silently, with no way to tell from the UI.
//
//  2. LENS PARITY. The scheduled/failed lenses narrow the visible list. If the
//     bulk endpoint does not apply them, the operator confirms against 4 rows
//     and the server rewrites 4,812.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/content/__tests__/bulk-route.test.ts"

import test, { beforeEach, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

// ── Captured Prisma calls ────────────────────────────────────────────────────
interface UpdateManyCall {
  where: unknown;
  data: Record<string, unknown>;
}
let updateManyCalls: UpdateManyCall[] = [];
let auditCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      contentArticle: {
        updateMany: async (args: UpdateManyCall) => {
          updateManyCalls.push(args);
          return { count: 1 };
        },
      },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { info: () => {}, error: () => {}, warn: () => {} } },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({
      adminId: "admin_1",
      email: "ops@autolenis.com",
      role: "SUPER_ADMIN",
      mfaVerified: true,
    }),
    adminSuccess: (data: unknown, status = 200) =>
      NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
    createAuditLog: async (_a: unknown, _r: unknown, entry: Record<string, unknown>) => {
      auditCalls.push(entry);
    },
  },
});

async function loadPOST() {
  const mod = await import("../articles/bulk/route");
  return mod.POST;
}

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/content/articles/bulk", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Flatten a Prisma where tree into the leaf conditions it actually applies. */
function leaves(where: unknown, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!where || typeof where !== "object") return acc;
  const w = where as Record<string, unknown>;
  for (const [key, value] of Object.entries(w)) {
    if (key === "AND" || key === "OR") {
      const arr = Array.isArray(value) ? value : [value];
      for (const child of arr) leaves(child, acc);
    } else {
      acc.push({ [key]: value });
    }
  }
  return acc;
}

/**
 * The OR array, wherever it sits. `publish` wraps baseWhere in an AND (the
 * publishedAt split), so the search clause is nested for that action and
 * top-level for the others — the test should not care which.
 */
function findOr(where: unknown): Record<string, { contains: string; mode: string }>[] | undefined {
  if (!where || typeof where !== "object") return undefined;
  const w = where as Record<string, unknown>;
  if (Array.isArray(w.OR)) return w.OR as Record<string, { contains: string; mode: string }>[];
  for (const value of Object.values(w)) {
    const arr = Array.isArray(value) ? value : [value];
    for (const child of arr) {
      const hit = findOr(child);
      if (hit) return hit;
    }
  }
  return undefined;
}

function findLeaf(where: unknown, key: string): unknown {
  const hit = leaves(where).find((l) => key in l);
  return hit ? (hit as Record<string, unknown>)[key] : undefined;
}

beforeEach(() => {
  updateManyCalls = [];
  auditCalls = [];
});

describe("target resolution — which rows the action actually touches", () => {
  test("an explicit id list targets exactly those ids", async () => {
    const POST = await loadPOST();
    const res = await POST(req({ action: "reject", ids: ["a", "b"] }));
    assert.equal(res.status, 200);

    assert.equal(updateManyCalls.length, 1);
    assert.deepEqual(findLeaf(updateManyCalls[0].where, "id"), { in: ["a", "b"] });
  });

  test("excludeIds subtracts from a filter target", async () => {
    const POST = await loadPOST();
    const res = await POST(
      req({ action: "reject", filter: { status: "REVIEW_NEEDED" }, excludeIds: ["skip_me"] }),
    );
    assert.equal(res.status, 200);

    const where = updateManyCalls[0].where;
    assert.deepEqual(
      findLeaf(where, "id"),
      { notIn: ["skip_me"] },
      "an un-ticked row must be excluded from the write, not published anyway",
    );
    assert.equal(findLeaf(where, "status"), "REVIEW_NEEDED", "the filter still applies");
  });

  test("excludeIds is ignored on the id path — the list is already exact", async () => {
    const POST = await loadPOST();
    await POST(req({ action: "reject", ids: ["a", "b"], excludeIds: ["a"] }));
    assert.deepEqual(findLeaf(updateManyCalls[0].where, "id"), { in: ["a", "b"] });
  });

  test("an empty excludeIds array does not add a vacuous condition", async () => {
    const POST = await loadPOST();
    await POST(req({ action: "reject", filter: { status: "DRAFT" }, excludeIds: [] }));
    assert.equal(findLeaf(updateManyCalls[0].where, "id"), undefined);
  });
});

describe("lens parity — the bulk target must match the list the operator saw", () => {
  test("the failed lens reaches the where clause", async () => {
    const POST = await loadPOST();
    await POST(req({ action: "draft", filter: { failed: "1" } }));
    assert.deepEqual(
      findLeaf(updateManyCalls[0].where, "publishFailureReason"),
      { not: null },
      "without this the action would hit every article, not the failed ones",
    );
  });

  test("the scheduled lens reaches the where clause", async () => {
    const POST = await loadPOST();
    await POST(req({ action: "draft", filter: { scheduled: "1" } }));
    assert.deepEqual(findLeaf(updateManyCalls[0].where, "scheduledAt"), { not: null });
  });

  test("the scheduled lens does NOT overwrite an explicit status filter", async () => {
    // Assigning where.status inside the lens would drop the caller's status and
    // widen the write from DRAFT to DRAFT+REVIEW_NEEDED.
    const POST = await loadPOST();
    await POST(req({ action: "draft", filter: { scheduled: "1", status: "DRAFT" } }));

    const statusLeaves = leaves(updateManyCalls[0].where).filter((l) => "status" in l);
    assert.ok(
      statusLeaves.some((l) => l.status === "DRAFT"),
      "the explicit DRAFT constraint must survive the scheduled lens",
    );
  });

  test("free-text search reaches the where clause as an OR over four columns", async () => {
    // Without this, "select all matching" during a search rewrote every row the
    // OTHER filters matched, ignoring the text the operator was looking at.
    const POST = await loadPOST();
    await POST(req({ action: "publish", filter: { search: "camry", status: "REVIEW_NEEDED" } }));

    const where = updateManyCalls[0].where;
    const or = findOr(where);
    assert.ok(or, "search must produce an OR clause on the mutation");
    assert.deepEqual(
      or.map((c) => Object.keys(c)[0]).sort(),
      ["city", "slug", "targetKeyword", "title"],
      "the mutation must search the same columns the list does",
    );
    for (const clause of or) {
      const predicate = Object.values(clause)[0];
      assert.equal(predicate.contains, "camry");
      assert.equal(predicate.mode, "insensitive");
    }
    assert.equal(findLeaf(where, "status"), "REVIEW_NEEDED", "other filters still apply");
  });

  test("a whitespace-only search adds no predicate to the mutation", async () => {
    const POST = await loadPOST();
    await POST(req({ action: "publish", filter: { search: "   ", status: "DRAFT" } }));
    assert.equal(findOr(updateManyCalls[0].where), undefined);
  });

  test("quality bands reach the where clause", async () => {
    const POST = await loadPOST();
    await POST(req({ action: "publish", filter: { quality_score_max: 4 } }));
    assert.deepEqual(findLeaf(updateManyCalls[0].where, "qualityScore"), { lte: 4 });
  });
});

describe("status semantics", () => {
  test("publish stamps publishedAt only on never-published rows", async () => {
    const POST = await loadPOST();
    await POST(req({ action: "publish", ids: ["a"] }));

    assert.equal(updateManyCalls.length, 2, "one write for fresh, one for already-published");
    const fresh = updateManyCalls.find((c) => "publishedAt" in c.data && c.data.publishedAt);
    const existing = updateManyCalls.find((c) => !("publishedAt" in c.data));
    assert.ok(fresh, "new publishes get a publishedAt stamp");
    assert.ok(existing, "re-publishes keep their original go-live date");
  });

  test("moving to draft clears publishedAt so the sitemap stays accurate", async () => {
    const POST = await loadPOST();
    await POST(req({ action: "draft", ids: ["a"] }));
    assert.equal(updateManyCalls[0].data.status, "DRAFT");
    assert.equal(updateManyCalls[0].data.publishedAt, null);
  });

  test("reject maps to ARCHIVED and leaves publishedAt untouched", async () => {
    const POST = await loadPOST();
    await POST(req({ action: "reject", ids: ["a"] }));
    assert.equal(updateManyCalls[0].data.status, "ARCHIVED");
    assert.ok(!("publishedAt" in updateManyCalls[0].data));
  });
});

describe("validation and audit", () => {
  test("a payload with neither ids nor filter is refused", async () => {
    const POST = await loadPOST();
    const res = await POST(req({ action: "publish" }));
    assert.equal(res.status, 400);
    assert.equal(updateManyCalls.length, 0, "nothing may be written on a rejected payload");
  });

  test("an empty ids array with no filter is refused", async () => {
    const POST = await loadPOST();
    const res = await POST(req({ action: "publish", ids: [] }));
    assert.equal(res.status, 400);
    assert.equal(updateManyCalls.length, 0);
  });

  test("an unknown action is refused", async () => {
    const POST = await loadPOST();
    const res = await POST(req({ action: "delete_everything", ids: ["a"] }));
    assert.equal(res.status, 400);
    assert.equal(updateManyCalls.length, 0);
  });

  test("the audit entry records the exclusions, so the blast radius is reconstructable", async () => {
    const POST = await loadPOST();
    await POST(req({ action: "publish", filter: { status: "REVIEW_NEEDED" }, excludeIds: ["x"] }));

    assert.equal(auditCalls.length, 1);
    const meta = auditCalls[0].metadata as Record<string, unknown>;
    assert.equal(meta.mode, "filter");
    assert.deepEqual(meta.excludeIds, ["x"]);
    assert.equal(meta.excludedCount, 1);
  });
});
