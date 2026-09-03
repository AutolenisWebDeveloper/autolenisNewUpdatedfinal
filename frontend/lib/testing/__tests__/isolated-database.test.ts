// Focused proof that the destructive-test database guard does what it claims.
//
// Each test names one property. The guard is a pure function of the connection string, so the
// "zero writes when rejected" property is provable here rather than asserted: the refusal path is
// exercised with a client that counts every call, and the count must be zero.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  assertIsolatedDatabase,
  parseDatabaseTarget,
  isolatedDatabaseOrNull,
  describeTarget,
  ProductionDatabaseRefusedError,
  PRODUCTION_PROJECT_REF,
  ISOLATED_DATABASE_PATTERN,
  newRunTag,
  taggedWhere,
  cleanupRunTag,
  countRunTag,
  withTaggedRun,
  CleanupFailedError,
  CLEANUP_ORDER,
  type CleanupClient,
} from "../isolated-database";

/** A client that records every call and performs no I/O. */
function spyClient(remainingAfterDelete = 0, dealIds: string[] = []) {
  const calls: string[] = [];
  const wheres: Array<{ model: string; op: string; where: Record<string, unknown> }> = [];
  const client = {} as CleanupClient;
  for (const model of CLEANUP_ORDER) {
    (client as Record<string, unknown>)[model] = {
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        calls.push(`${model}.deleteMany`);
        wheres.push({ model, op: "deleteMany", where: args.where });
        return { count: 1 };
      },
      count: async (args: { where: Record<string, unknown> }) => {
        calls.push(`${model}.count`);
        wheres.push({ model, op: "count", where: args.where });
        return remainingAfterDelete;
      },
    };
  }
  // `deal.findMany` resolves the ids the unlinked history rows are selected by.
  (client.deal as unknown as Record<string, unknown>).findMany = async (args: unknown) => {
    calls.push("deal.findMany");
    void args;
    return dealIds.map((id) => ({ id }));
  };
  return { client, calls, wheres };
}

const refusalOf = (dsn: string | undefined | null) => {
  try {
    assertIsolatedDatabase(dsn);
    return null;
  } catch (err) {
    assert.ok(err instanceof ProductionDatabaseRefusedError, `expected a refusal, got ${err}`);
    return err as ProductionDatabaseRefusedError;
  }
};

describe("guard: refuses production", () => {
  test("rejects the production project reference in the host", () => {
    const r = refusalOf(`postgresql://u:p@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`);
    assert.ok(r, "must refuse");
    assert.match(r.message, new RegExp(PRODUCTION_PROJECT_REF));
  });

  test("rejects the production project reference in the pooler username", () => {
    // The pooler form hides the ref in the user: postgres.<ref>@aws-0-us-east-1.pooler.supabase.com
    const r = refusalOf(
      `postgresql://postgres.${PRODUCTION_PROJECT_REF}:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
    );
    assert.ok(r, "must refuse");
    assert.equal(r.target?.projectRef, PRODUCTION_PROJECT_REF);
  });

  test("rejects the production host family even without a recognisable ref", () => {
    const r = refusalOf("postgresql://u:p@db.someotherprojectref00.supabase.co:5432/autolenis_e2e");
    assert.ok(r, "must refuse");
    assert.match(r.message, /Supabase endpoint/);
  });

  test("rejects production database names even on a loopback host", () => {
    for (const name of ["postgres", "autolenis", "autolenis_prod", "autolenis_production"]) {
      const r = refusalOf(`postgresql://u:p@127.0.0.1:5432/${name}`);
      assert.ok(r, `must refuse database ${name}`);
      assert.match(r.message, /production name/);
    }
  });

  test("rejects a non-loopback host even with a disposable-looking database name", () => {
    const r = refusalOf("postgresql://u:p@10.0.0.7:5432/autolenis_e2e");
    assert.ok(r, "must refuse");
    assert.match(r.message, /not loopback/);
  });
});

describe("guard: refuses unusable configuration", () => {
  test("rejects missing configuration", () => {
    for (const dsn of [undefined, null, "", "   "]) {
      const r = refusalOf(dsn);
      assert.ok(r, `must refuse ${JSON.stringify(dsn)}`);
      assert.match(r.message, /no connection string/);
    }
  });

  test("rejects unparseable configuration", () => {
    for (const dsn of ["not a url", "://missing-scheme/x", "postgres://"]) {
      const r = refusalOf(dsn);
      assert.ok(r, `must refuse ${JSON.stringify(dsn)}`);
    }
  });

  test("rejects a non-postgres scheme", () => {
    const r = refusalOf("mysql://u:p@127.0.0.1:3306/autolenis_e2e");
    assert.ok(r, "must refuse");
    assert.match(r.message, /not postgres/);
  });

  test("rejects a connection string that names no database", () => {
    const r = refusalOf("postgresql://u:p@127.0.0.1:5432/");
    assert.ok(r, "must refuse");
    assert.match(r.message, /names no database/);
  });

  test("the placeholder DSN CI falls back to is refused", () => {
    const r = refusalOf("postgresql://placeholder:placeholder@localhost:5432/placeholder");
    assert.ok(r, "must refuse");
  });
});

describe("guard: performs zero writes when it rejects", () => {
  test("a refusal touches no client method", async () => {
    const { client, calls } = spyClient();
    for (const dsn of [
      undefined,
      "",
      "not a url",
      `postgresql://u:p@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
      "postgresql://u:p@10.0.0.7:5432/autolenis_e2e",
      "postgresql://u:p@127.0.0.1:5432/postgres",
    ]) {
      const target = isolatedDatabaseOrNull(dsn);
      assert.equal(target, null, `must refuse ${String(dsn)}`);
      if (target) await cleanupRunTag(client, "unreachable");
    }
    assert.deepEqual(calls, [], "the refusal path must not call the database at all");
  });

  test("the guard is a pure function — it opens nothing", () => {
    // Proven structurally: assertIsolatedDatabase only parses a string. If it ever imported a
    // client this test would need one, and it does not.
    const target = assertIsolatedDatabase("postgresql://u:p@127.0.0.1:55432/autolenis_e2e");
    assert.equal(target.host, "127.0.0.1");
    assert.equal(target.database, "autolenis_e2e");
  });
});

describe("guard: accepts only a positively identified isolated target", () => {
  test("accepts loopback + the reserved disposable name", () => {
    for (const dsn of [
      "postgresql://u:p@127.0.0.1:55432/autolenis_e2e",
      "postgresql://u:p@localhost:5432/autolenis_e2e",
      "postgresql://u:p@127.0.0.1:5432/autolenis_e2e_ci",
      "postgres://u:p@localhost:5432/autolenis_e2e_run-7",
    ]) {
      const t = assertIsolatedDatabase(dsn);
      assert.ok(ISOLATED_DATABASE_PATTERN.test(t.database), `${t.database} must match the reserved pattern`);
    }
  });

  test("a name that merely contains the reserved word is not enough", () => {
    for (const name of ["prod_autolenis_e2e", "autolenis_e2eX", "autolenis-e2e", "e2e"]) {
      const r = refusalOf(`postgresql://u:p@127.0.0.1:5432/${name}`);
      assert.ok(r, `must refuse database ${name}`);
    }
  });

  test("the sanitized description carries no credentials", () => {
    const t = assertIsolatedDatabase("postgresql://secretuser:secretpass@127.0.0.1:55432/autolenis_e2e");
    const description = describeTarget(t);
    assert.ok(!description.includes("secretuser"), "must not leak the user");
    assert.ok(!description.includes("secretpass"), "must not leak the password");
    assert.match(description, /host=127\.0\.0\.1 port=55432 database=autolenis_e2e/);
  });

  test("parseDatabaseTarget never returns credentials", () => {
    const t = parseDatabaseTarget("postgresql://secretuser:secretpass@127.0.0.1:5432/autolenis_e2e");
    assert.deepEqual(Object.keys(t).sort(), ["database", "host", "port", "projectRef"]);
  });
});

describe("run tagging and cleanup", () => {
  test("every created row is reachable from a unique run tag", () => {
    const a = newRunTag();
    const b = newRunTag();
    assert.notEqual(a, b, "tags must be unique per run");
    for (const model of CLEANUP_ORDER) {
      if (model === "dealStatusHistory") continue; // no relation to Deal — covered by its own test
      const where = JSON.stringify(taggedWhere(model, a));
      assert.ok(where.includes(a), `${model} where-clause must select by the run tag`);
    }
  });

  test("deal_status_history is selected by resolved deal ids, since it has no relation to Deal", async () => {
    // Regression: a nested `{ deal: { offer: ... } }` filter here is rejected by Prisma with
    // "Unknown argument `deal`" — deal_id is a bare column with no foreign key.
    const { client, calls, wheres } = spyClient(0, ["deal-a", "deal-b"]);
    await cleanupRunTag(client, "tag-history");

    assert.equal(calls[0], "deal.findMany", "ids must be read before anything is deleted");
    const historyWhere = wheres.find((w) => w.model === "dealStatusHistory" && w.op === "deleteMany");
    assert.deepEqual(historyWhere?.where, { dealId: { in: ["deal-a", "deal-b"] } });
  });

  test("a run that created no deals selects no history rather than everything", () => {
    assert.deepEqual(taggedWhere("dealStatusHistory", "tag", { dealIds: [] }), { dealId: { in: [] } });
  });

  test("cleanup deletes children before parents", async () => {
    const { client, calls } = spyClient();
    await cleanupRunTag(client, "tag-1");
    const order = calls.filter((c) => c.endsWith(".deleteMany")).map((c) => c.split(".")[0]);
    assert.ok(order.indexOf("dealStatusHistory") === 0, "history is deleted before the deals it names");
    assert.deepEqual(order, [...CLEANUP_ORDER], "delete order must be children-first");
    assert.ok(order.indexOf("offer") < order.indexOf("auction"), "offers before auctions");
    assert.ok(order.indexOf("auction") < order.indexOf("buyer"), "auctions before buyers");
    assert.ok(order.indexOf("buyer") < order.indexOf("user"), "buyers before users");
  });

  test("cleanup runs on SUCCESS and asserts zero tagged rows remain", async () => {
    const { client, calls } = spyClient(0);
    const value = await withTaggedRun(client, async (tag) => {
      assert.ok(tag.startsWith("isotest-"));
      return "ok";
    });
    assert.equal(value, "ok");
    assert.equal(calls.filter((c) => c.endsWith(".deleteMany")).length, CLEANUP_ORDER.length);
    assert.equal(calls.filter((c) => c.endsWith(".count")).length, CLEANUP_ORDER.length);
  });

  test("cleanup runs on FAILURE too — a red test leaves nothing behind", async () => {
    const { client, calls } = spyClient(0);
    await assert.rejects(
      withTaggedRun(client, async () => {
        throw new Error("body failed");
      }),
      /body failed/,
    );
    assert.equal(
      calls.filter((c) => c.endsWith(".deleteMany")).length,
      CLEANUP_ORDER.length,
      "cleanup must run even when the body throws",
    );
  });

  test("a run that cannot clean up fails loudly rather than silently leaking", async () => {
    // The spy reports 3 surviving rows for each of the CLEANUP_ORDER models, so the guard should
    // report the sum across models, not one model's count.
    const { client } = spyClient(3);
    const expected = 3 * CLEANUP_ORDER.length;
    await assert.rejects(
      withTaggedRun(client, async () => "ok"),
      new RegExp(`cleanup left ${expected} tagged row\\(s\\) behind`),
    );
  });

  test("one failing model does not abandon the other seven", async () => {
    // Regression: the first version stopped at the first throw, so a single bad where-clause left a
    // whole run's rows in the database. Every model must still be attempted, and the error must name
    // the one that failed.
    const { client, calls } = spyClient(0);
    (client.offer as unknown as Record<string, unknown>).deleteMany = async () => {
      calls.push("offer.deleteMany"); // record the attempt, then fail like Prisma would
      throw new Error("Unknown argument `deal`");
    };
    await assert.rejects(cleanupRunTag(client, "tag-partial"), (err: unknown) => {
      assert.ok(err instanceof CleanupFailedError, `expected CleanupFailedError, got ${err}`);
      assert.equal(err.failures.length, 1);
      assert.match(err.failures[0], /^offer: Unknown argument/);
      return true;
    });
    const attempted = calls.filter((c) => c.endsWith(".deleteMany")).map((c) => c.split(".")[0]);
    assert.deepEqual(attempted, [...CLEANUP_ORDER], "every model must be attempted despite the failure");
  });

  test("a cleanup failure never hides why the body failed", async () => {
    const { client } = spyClient(0);
    (client.user as unknown as Record<string, unknown>).deleteMany = async () => {
      throw new Error("permission denied");
    };
    await assert.rejects(
      withTaggedRun(client, async () => {
        throw new Error("the real reason the test failed");
      }),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.match(message, /the real reason the test failed/, "the body's error must survive");
        assert.match(
          message,
          /\[cleanup also failed\][\s\S]*permission denied/,
          "and must carry the cleanup detail",
        );
        return true;
      },
    );
  });

  test("a surviving history row is detected, even though deleting its deal cannot cascade", async () => {
    // deal_status_history has no foreign key to deals. If countRunTag re-resolved the deal ids after
    // the deletes it would look for `dealId in []`, find nothing, and call a leak a clean run.
    const dealIds = ["deal-x"];
    const { client } = spyClient(0, dealIds);
    // Only the history rows survive; every other model reports zero.
    (client.dealStatusHistory as unknown as Record<string, unknown>).count = async (args: {
      where: Record<string, unknown>;
    }) => {
      const where = args.where as { dealId?: { in?: string[] } };
      return where.dealId?.in?.length ? 4 : 0; // survivors are only visible via the pre-delete ids
    };
    await assert.rejects(
      withTaggedRun(client, async () => "ok"),
      /cleanup left 4 tagged row\(s\) behind/,
      "the run must fail rather than report a clean database",
    );
  });

  test("a FAILING run also asserts it left nothing behind", async () => {
    // The success path always checked. The failure path did not — and a failing run is the one most
    // likely to leak, so it must carry the same assertion.
    const { client } = spyClient(2, ["deal-y"]);
    await assert.rejects(
      withTaggedRun(client, async () => {
        throw new Error("body blew up");
      }),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.match(message, /body blew up/, "the body's error must survive");
        assert.match(message, /cleanup left \d+ tagged row\(s\) behind/, "and the leak must be reported");
        return true;
      },
    );
  });

  test("countRunTag sums every model", async () => {
    const { client } = spyClient(2);
    assert.equal(await countRunTag(client, "tag"), 2 * CLEANUP_ORDER.length);
  });
});
