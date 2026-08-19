// Block B / Apollo — adapter 3-stage logic + fail-closed. Injected fake client;
// live HTTP is isolated in defaultApolloClient (staging-verified).
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

test("fails closed when no client is configured (no key / disabled)", async () => {
  const r = await apolloResolveAndReveal(input, { client: null });
  assert.equal(r, null);
});

test("3-stage happy path returns the revealed contact", async () => {
  const r = await apolloResolveAndReveal(input, { client: client() });
  assert.equal(r?.email, "ann@toyotaofdallas.com");
});

test("fails closed when the org cannot be resolved", async () => {
  const r = await apolloResolveAndReveal(input, { client: client({ organizationsLookup: async () => null }) });
  assert.equal(r, null);
});

test("reveals the best-title person even when search reports has_email:false (plan masks it)", async () => {
  // Some Apollo plans return has_email:false in Search for real, revealable contacts.
  // The adapter must NOT gate on the flag — it reveals the best-title person anyway.
  const r = await apolloResolveAndReveal(input, {
    client: client({
      peopleSearch: async () => [{ id: "p1", name: "Ann", title: "Internet Sales Manager", hasEmail: false }],
      peopleMatch: async (id) => ({ email: `${id}@toyotaofdallas.com`, name: "Ann", title: "ISM" }),
    }),
  });
  assert.equal(r?.email, "p1@toyotaofdallas.com");
});

test("returns null ONLY when the org has no people at all", async () => {
  const r = await apolloResolveAndReveal(input, { client: client({ peopleSearch: async () => [] }) });
  assert.equal(r, null);
});

test("an empty reveal on the best-title person (no email found) returns null", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({
      peopleSearch: async () => [{ id: "p1", name: "Ann", title: "Internet Sales Manager", hasEmail: false }],
      peopleMatch: async () => ({ email: null }),
    }),
  });
  assert.equal(r, null);
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
  assert.equal(r?.email, "flagged@toyotaofdallas.com");
});

test("fails closed when the reveal returns no email", async () => {
  const r = await apolloResolveAndReveal(input, { client: client({ peopleMatch: async () => ({ email: null }) }) });
  assert.equal(r, null);
});

test("picks the best-title-ranked flag-positive person (not Apollo's return order)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({
      peopleSearch: async () => [
        { id: "sales", name: "S", title: "Sales", hasEmail: true },
        { id: "ism", name: "I", title: "Internet Sales Manager", hasEmail: true },
      ],
      peopleMatch: async (id) => ({ email: `${id}@toyotaofdallas.com`, name: id, title: id }),
    }),
  });
  assert.equal(r?.email, "ism@toyotaofdallas.com"); // internet-sales outranks plain sales
});

test("fails closed (returns null) when a stage throws", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleSearch: async () => { throw new Error("apollo 500"); } }),
  });
  assert.equal(r, null);
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
    // No waterfall params → Apollo returns synchronous work email only, never cascades.
    assert.equal("waterfall" in sentBody, false);
    assert.equal(Object.keys(sentBody).some((k) => k.toLowerCase().includes("waterfall")), false);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = prevKey;
    if (prevEnabled === undefined) delete process.env.APOLLO_REVEAL_ENABLED; else process.env.APOLLO_REVEAL_ENABLED = prevEnabled;
  }
});
