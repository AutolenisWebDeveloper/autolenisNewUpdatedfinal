// Block B / Apollo — adapter 3-stage logic + fail-closed. Injected fake client;
// live HTTP is isolated in defaultApolloClient (staging-verified).
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { apolloResolveAndReveal, type ApolloClient } from "../apollo.service";

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

test("fails closed when no person has a fetchable email (has_email false)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleSearch: async () => [{ id: "p1", name: "Ann", title: "ISM", hasEmail: false }] }),
  });
  assert.equal(r, null); // never spends a reveal on a flag-negative person
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
