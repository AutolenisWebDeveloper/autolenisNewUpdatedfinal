// Block B / Apollo — adapter 3-stage logic + fail-closed + billed/not-billed outcome.
// Injected fake client; live HTTP is isolated in defaultApolloClient (staging-verified).
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { apolloResolveAndReveal, defaultApolloClient, type ApolloClient } from "../apollo.service";

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
  assert.deepEqual(r, { kind: "empty", billed: false });
});

test("3-stage happy path → revealed with the contact", async () => {
  const r = await apolloResolveAndReveal(input, { client: client() });
  assert.equal(r.kind, "revealed");
  assert.equal(r.kind === "revealed" && r.email, "ann@toyotaofdallas.com");
});

test("org not resolved → empty, NOT billed (never reached the paid call)", async () => {
  const r = await apolloResolveAndReveal(input, { client: client({ organizationsLookup: async () => null }) });
  assert.deepEqual(r, { kind: "empty", billed: false });
});

test("zero people → empty, NOT billed", async () => {
  const r = await apolloResolveAndReveal(input, { client: client({ peopleSearch: async () => [] }) });
  assert.deepEqual(r, { kind: "empty", billed: false });
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
  assert.deepEqual(r, { kind: "empty", billed: true });
});

test("people/match returns NO person (no match) → empty, NOT billed (refundable)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => null }),
  });
  assert.deepEqual(r, { kind: "empty", billed: false });
});

test("people/match throws → empty and BILLED (cannot know if charged → conservative)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => { throw new Error("apollo 500 on match"); } }),
  });
  assert.deepEqual(r, { kind: "empty", billed: true });
});

test("a FREE-stage throw (people search) → empty, NOT billed", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleSearch: async () => { throw new Error("apollo 500 on search"); } }),
  });
  assert.deepEqual(r, { kind: "empty", billed: false });
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
