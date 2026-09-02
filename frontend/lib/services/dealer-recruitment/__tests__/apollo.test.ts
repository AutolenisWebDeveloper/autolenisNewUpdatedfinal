// Block B / Apollo — adapter 3-stage logic + fail-closed + billed/not-billed outcome.
// Injected fake client; live HTTP is isolated in defaultApolloClient (staging-verified).
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { logger } from "@/lib/logger";
import {
  apolloResolveAndReveal,
  defaultApolloClient,
  type ApolloClient,
  type ApolloEmptyStage,
} from "../apollo.service";

function client(over: Partial<ApolloClient> = {}): ApolloClient {
  return {
    organizationsLookup: async () => ({ id: "org1", domain: "toyotaofdallas.com" }),
    peopleSearch: async () => [
      { id: "p1", name: "Ann", title: "Internet Sales Manager", hasEmail: true },
    ],
    peopleMatch: async () => ({ email: "ann@toyotaofdallas.com", name: "Ann", title: "Internet Sales Manager" }),
    ...over,
  };
}
const input = { name: "Toyota of Dallas", website: "https://toyotaofdallas.com", city: "Dallas", state: "TX" };

test("no client (no key / disabled) → empty, NOT billed", async () => {
  const r = await apolloResolveAndReveal(input, { client: null });
  assert.deepEqual(r, { kind: "empty", billed: false, stage: "disabled" });
});

test("3-stage happy path → revealed with the contact", async () => {
  const r = await apolloResolveAndReveal(input, { client: client() });
  assert.equal(r.kind, "revealed");
  assert.equal(r.kind === "revealed" && r.email, "ann@toyotaofdallas.com");
});

test("org not resolved → empty, NOT billed (never reached the paid call)", async () => {
  const r = await apolloResolveAndReveal(input, { client: client({ organizationsLookup: async () => null }) });
  assert.deepEqual(r, { kind: "empty", billed: false, stage: "no_org" });
});

test("zero people → empty, NOT billed", async () => {
  const r = await apolloResolveAndReveal(input, { client: client({ peopleSearch: async () => [] }) });
  assert.deepEqual(r, { kind: "empty", billed: false, stage: "no_people" });
});

test("reveals the best-title person even when search reports has_email:false (plan masks it)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({
      peopleSearch: async () => [{ id: "p1", name: "Ann", title: "Internet Sales Manager", hasEmail: false }],
      peopleMatch: async (id) => ({ email: `${id}@toyotaofdallas.com`, name: "Ann", title: "ISM" }),
    }),
  });
  assert.equal(r.kind === "revealed" && r.email, "p1@toyotaofdallas.com");
});

test("matched but NO email → empty and BILLED (Apollo charged for the match — do not refund)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => ({ email: null }) }),
  });
  assert.deepEqual(r, { kind: "empty", billed: true, stage: "match_no_email" });
});

test("people/match returns NO person (no match) → empty, NOT billed (refundable)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => null }),
  });
  assert.deepEqual(r, { kind: "empty", billed: false, stage: "no_match" });
});

test("people/match throws → empty and BILLED (cannot know if charged → conservative)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => { throw new Error("apollo 500 on match"); } }),
  });
  assert.deepEqual(r, { kind: "empty", billed: true, stage: "match_error" });
});

test("a FREE-stage throw (people search) → empty, NOT billed", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleSearch: async () => { throw new Error("apollo 500 on search"); } }),
  });
  assert.deepEqual(r, { kind: "empty", billed: false, stage: "free_stage_error" });
});

test("picks the best-title-ranked person (not Apollo's return order)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({
      peopleSearch: async () => [
        { id: "sales", name: "S", title: "Sales", hasEmail: true },
        { id: "ism", name: "I", title: "Internet Sales Manager", hasEmail: true },
      ],
      peopleMatch: async (id) => ({ email: `${id}@toyotaofdallas.com`, name: id, title: id }),
    }),
  });
  assert.equal(r.kind === "revealed" && r.email, "ism@toyotaofdallas.com");
});

test("among equal-title people, the flagged (has_email) one is the tiebreak winner", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({
      peopleSearch: async () => [
        { id: "noflag", name: "N", title: "Sales Manager", hasEmail: false },
        { id: "flagged", name: "F", title: "Sales Manager", hasEmail: true },
      ],
      peopleMatch: async (id) => ({ email: `${id}@toyotaofdallas.com`, name: id, title: id }),
    }),
  });
  assert.equal(r.kind === "revealed" && r.email, "flagged@toyotaofdallas.com");
});

test("live client people/match sends deterministic-cost params and NO waterfall keys", async () => {
  const prevKey = process.env.APOLLO_API_KEY;
  const prevEnabled = process.env.APOLLO_REVEAL_ENABLED;
  const prevFetch = globalThis.fetch;
  process.env.APOLLO_API_KEY = "test-key";
  process.env.APOLLO_REVEAL_ENABLED = "true";
  let sentBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sentBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ person: { email: "x@y.com" } }) } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    const c = defaultApolloClient();
    assert.ok(c, "client should exist when enabled + key present");
    await c!.peopleMatch("person-1");
    assert.equal(sentBody.id, "person-1");
    assert.equal(sentBody.reveal_personal_emails, false);
    assert.equal(sentBody.reveal_phone_number, false); // never trigger the 8-credit phone reveal
    assert.equal("waterfall" in sentBody, false);
    assert.equal(Object.keys(sentBody).some((k) => k.toLowerCase().includes("waterfall")), false);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = prevKey;
    if (prevEnabled === undefined) delete process.env.APOLLO_REVEAL_ENABLED; else process.env.APOLLO_REVEAL_ENABLED = prevEnabled;
  }
});

test("live client people/match THROWS on an HTTP error (billable-call error must not collapse to null)", async () => {
  const prevKey = process.env.APOLLO_API_KEY;
  const prevEnabled = process.env.APOLLO_REVEAL_ENABLED;
  const prevFetch = globalThis.fetch;
  process.env.APOLLO_API_KEY = "test-key";
  process.env.APOLLO_REVEAL_ENABLED = "true";
  try {
    // HTTP 500 on the paid call.
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const c500 = defaultApolloClient();
    await assert.rejects(() => c500!.peopleMatch("p1"), /HTTP 500/);

    // Network/timeout throw on the paid call.
    globalThis.fetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const cNet = defaultApolloClient();
    await assert.rejects(() => cNet!.peopleMatch("p1"));

    // A clean 200 with no person still returns null (real no-match → not billed).
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const cOk = defaultApolloClient();
    assert.equal(await cOk!.peopleMatch("p1"), null);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = prevKey;
    if (prevEnabled === undefined) delete process.env.APOLLO_REVEAL_ENABLED; else process.env.APOLLO_REVEAL_ENABLED = prevEnabled;
  }
});

// ─── empty-stage diagnosis ───────────────────────────────────────────────────
//
// An empty reveal used to be one undifferentiated outcome, so a cycle that
// never resolved an organization looked exactly like a cycle whose paid matches
// all came back without a work email — opposite problems, identical evidence.
// `stage` names the drop-off point. These tests hold two things:
//
//   1. each stage value is produced by the adapter condition it names, and
//   2. the `billed` flag paired with each stage is EXACTLY what that branch
//      returned before `stage` existed.
//
// (2) is the load-bearing half. `billed` is what decides whether the ledger
// refunds a credit, so a stage that quietly flipped its pairing would change
// real spend. The table below is that contract in one place, typed as a total
// Record so a new stage cannot be added to the union without landing here.

const BILLED_BY_STAGE: Record<ApolloEmptyStage, boolean> = {
  disabled: false, // never called Apollo at all
  no_org: false, // stage 1 miss — free
  no_people: false, // stage 2 miss — free
  free_stage_error: false, // threw before the paid call — free
  no_match: false, // clean 200, no person — Apollo does not charge
  match_no_email: true, // Apollo charges for the match, email or not
  match_error: true, // unknowable → assume charged, never undercount
};

interface StageCase {
  stage: ApolloEmptyStage;
  why: string;
  run: () => ReturnType<typeof apolloResolveAndReveal>;
}

const STAGE_CASES: StageCase[] = [
  {
    stage: "disabled",
    why: "no client — no API key or APOLLO_REVEAL_ENABLED is not \"true\"",
    run: () => apolloResolveAndReveal(input, { client: null }),
  },
  {
    stage: "no_org",
    why: "organizations/lookup resolved no canonical org",
    run: () => apolloResolveAndReveal(input, { client: client({ organizationsLookup: async () => null }) }),
  },
  {
    stage: "no_people",
    why: "people search returned zero people for the org",
    run: () => apolloResolveAndReveal(input, { client: client({ peopleSearch: async () => [] }) }),
  },
  {
    stage: "free_stage_error",
    why: "stage 1 (organizations/lookup) threw",
    run: () =>
      apolloResolveAndReveal(input, {
        client: client({ organizationsLookup: async () => { throw new Error("apollo 500 on lookup"); } }),
      }),
  },
  {
    stage: "free_stage_error",
    why: "stage 2 (people search) threw",
    run: () =>
      apolloResolveAndReveal(input, {
        client: client({ peopleSearch: async () => { throw new Error("apollo 500 on search"); } }),
      }),
  },
  {
    stage: "no_match",
    why: "people/match matched no person (clean 200)",
    run: () => apolloResolveAndReveal(input, { client: client({ peopleMatch: async () => null }) }),
  },
  {
    stage: "match_no_email",
    why: "people/match matched a person carrying no work email",
    run: () => apolloResolveAndReveal(input, { client: client({ peopleMatch: async () => ({ email: null }) }) }),
  },
  {
    stage: "match_error",
    why: "people/match threw — charged or not is unknowable",
    run: () =>
      apolloResolveAndReveal(input, {
        client: client({ peopleMatch: async () => { throw new Error("apollo 500 on match"); } }),
      }),
  },
];

for (const c of STAGE_CASES) {
  test(`stage "${c.stage}" is produced by: ${c.why}`, async () => {
    const r = await c.run();
    assert.equal(r.kind, "empty", "this condition must not reveal a contact");
    assert.deepEqual(r, { kind: "empty", billed: BILLED_BY_STAGE[c.stage], stage: c.stage });
  });
}

test("every stage in the union has a producing condition covered above", () => {
  const declared = Object.keys(BILLED_BY_STAGE).sort();
  const covered = [...new Set(STAGE_CASES.map((c) => c.stage))].sort();
  assert.deepEqual(
    covered,
    declared,
    "a stage exists that no test produces (or a test produces a stage the union no longer declares) — " +
      "add the case to STAGE_CASES rather than deleting the stage",
  );
});

test("the revealed outcome carries no stage — stage is an EMPTY-only diagnosis", async () => {
  const r = await apolloResolveAndReveal(input, { client: client() });
  assert.equal(r.kind, "revealed");
  assert.equal("stage" in r, false);
  assert.equal("billed" in r, false);
});

test("billed pairings are unchanged: exactly the two paid-stage outcomes bill", () => {
  // Frozen deliberately. Before `stage` existed the adapter billed on exactly
  // two branches — a match with no email, and an errored match — and refunded
  // on the other five. Anything that widens the billing set here overspends the
  // cap; anything that narrows it undercounts real Apollo spend.
  const billed = Object.entries(BILLED_BY_STAGE).filter(([, b]) => b).map(([s]) => s).sort();
  assert.deepEqual(billed, ["match_error", "match_no_email"]);
  const refunded = Object.entries(BILLED_BY_STAGE).filter(([, b]) => !b).map(([s]) => s).sort();
  assert.deepEqual(refunded, ["disabled", "free_stage_error", "no_match", "no_org", "no_people"]);
});

// ─── the free-stage funnel logs ──────────────────────────────────────────────
//
// The stage field explains a SINGLE empty; these two lines explain a RUN. They
// are the only way to see, from logs alone, that (say) 900 rooftops resolved an
// org and 870 of them then returned zero people. Deleting them is silent
// otherwise — so they are asserted here rather than left to inspection.

/** Capture logger output at a given level for the duration of one call. */
async function captureLogs<T>(level: "info" | "warn", fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = logger[level];
  logger[level] = ((message: string, ...rest: unknown[]) => {
    lines.push(message);
    void rest;
  }) as typeof original;
  try {
    return { result: await fn(), lines };
  } finally {
    logger[level] = original;
  }
}

const keyed = { ...input, rooftopId: "rt-42" };

test("free stage 1 logs the resolved org id at INFO, keyed by rooftop", async () => {
  const { lines } = await captureLogs("info", () => apolloResolveAndReveal(keyed, { client: client() }));
  const stage1 = lines.find((l) => l.includes("stage 1 org lookup"));
  assert.ok(stage1, `no stage-1 info line; got: ${JSON.stringify(lines)}`);
  assert.match(stage1!, /rooftop=rt-42/);
  assert.match(stage1!, /org=org1/); // the id Apollo resolved, not a placeholder
});

test("free stage 2 logs the people count at INFO, keyed by rooftop and org", async () => {
  const { lines } = await captureLogs("info", () =>
    apolloResolveAndReveal(keyed, {
      client: client({
        peopleSearch: async () => [
          { id: "a", name: "A", title: "Sales Manager", hasEmail: true },
          { id: "b", name: "B", title: "Sales Manager", hasEmail: false },
        ],
        peopleMatch: async () => ({ email: "a@b.com" }),
      }),
    }),
  );
  const stage2 = lines.find((l) => l.includes("stage 2 people search"));
  assert.ok(stage2, `no stage-2 info line; got: ${JSON.stringify(lines)}`);
  assert.match(stage2!, /rooftop=rt-42/);
  assert.match(stage2!, /org=org1/);
  assert.match(stage2!, /people=2/); // the real count, not a boolean
});

test("the drop-off is visible on a MISS too — an unresolved org still logs org=none", async () => {
  // The funnel is worthless if it only records the rooftops that got through.
  const { lines } = await captureLogs("info", () =>
    apolloResolveAndReveal(keyed, { client: client({ organizationsLookup: async () => null }) }),
  );
  const stage1 = lines.find((l) => l.includes("stage 1 org lookup"));
  assert.ok(stage1, "an org miss must still emit the stage-1 line");
  assert.match(stage1!, /rooftop=rt-42 org=none/);
  assert.equal(lines.some((l) => l.includes("stage 2 people search")), false); // never reached
});

test("a zero-people org logs people=0 — the drop-off between stage 1 and 2", async () => {
  const { lines } = await captureLogs("info", () =>
    apolloResolveAndReveal(keyed, { client: client({ peopleSearch: async () => [] }) }),
  );
  assert.ok(lines.some((l) => /stage 1 org lookup .*org=org1/.test(l)));
  assert.ok(lines.some((l) => /stage 2 people search .*people=0/.test(l)));
});

test("the funnel lines are INFO, not warn — an ordinary miss is not a fault", async () => {
  const { lines: warnLines } = await captureLogs("warn", () =>
    apolloResolveAndReveal(keyed, { client: client({ organizationsLookup: async () => null }) }),
  );
  assert.deepEqual(warnLines, [], "an org miss must not warn — it is an ordinary outcome");
});

test("a free-stage THROW still warns (that one IS a fault) and names the rooftop", async () => {
  const { lines } = await captureLogs("warn", () =>
    apolloResolveAndReveal(keyed, {
      client: client({ peopleSearch: async () => { throw new Error("apollo 500 on search"); } }),
    }),
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /free stages\) failed — rooftop=rt-42/);
});

test("without a rooftop id the funnel line still emits, keyed \"unknown\"", async () => {
  // A grep for the funnel must never silently skip a row just because a caller
  // outside the reveal orchestration drove the adapter.
  const { lines } = await captureLogs("info", () => apolloResolveAndReveal(input, { client: client() }));
  assert.ok(lines.some((l) => l.includes("rooftop=unknown")));
});
