// A2 — canonical dealer identity primitives (pure). Run:
//   npx tsx --test lib/services/dealer/__tests__/dealer-identity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWebsiteHost,
  normalizeDealerName,
  nameZipKey,
  nameCityStateKey,
  phoneKey,
  dealerIdentityKeys,
  identitiesMatch,
} from "../dealer-identity.service";

// ─── normalizeWebsiteHost ────────────────────────────────────────────────────

test("normalizeWebsiteHost strips protocol/www/path/query and lowercases", () => {
  assert.equal(normalizeWebsiteHost("https://www.ToyotaOfDallas.com/inventory?x=1"), "toyotaofdallas.com");
  assert.equal(normalizeWebsiteHost("http://toyotaofdallas.com/"), "toyotaofdallas.com");
  assert.equal(normalizeWebsiteHost("toyotaofdallas.com"), "toyotaofdallas.com");
  assert.equal(normalizeWebsiteHost(""), null);
  assert.equal(normalizeWebsiteHost(null), null);
});

// ─── normalizeDealerName ─────────────────────────────────────────────────────

test("normalizeDealerName lowercases, folds punctuation/whitespace, strips legal suffixes", () => {
  assert.equal(normalizeDealerName("Toyota of Dallas, Inc."), "toyota of dallas");
  assert.equal(normalizeDealerName("Toyota of Dallas LLC"), "toyota of dallas");
  assert.equal(normalizeDealerName("  Honda   of  Plano  "), "honda of plano");
  assert.equal(normalizeDealerName("O'Reilly Auto"), "oreilly auto");
  assert.equal(normalizeDealerName("AutoNation Ford"), "autonation ford");
  assert.equal(normalizeDealerName(""), null);
  assert.equal(normalizeDealerName(null), null);
});

test("normalizeDealerName does not over-strip meaningful tokens", () => {
  // 'of' and brand words are preserved; only trailing legal-entity suffixes go.
  assert.equal(normalizeDealerName("Dallas Motors"), "dallas motors");
  assert.equal(normalizeDealerName("City Auto Group"), "city auto group");
});

// ─── composite keys ──────────────────────────────────────────────────────────

test("nameZipKey combines normalized name + zip; null when either missing", () => {
  assert.equal(nameZipKey("Toyota of Dallas Inc", "75201"), "toyota of dallas|75201");
  assert.equal(nameZipKey("Toyota of Dallas", null), null);
  assert.equal(nameZipKey(null, "75201"), null);
});

test("nameCityStateKey combines normalized name + lowercased city/state", () => {
  assert.equal(nameCityStateKey("Toyota of Dallas", "Dallas", "TX"), "toyota of dallas|dallas|tx");
  assert.equal(nameCityStateKey("Toyota of Dallas", "Dallas", null), null);
});

test("phoneKey reuses normalizePhone (E.164) and nulls on failure", () => {
  assert.equal(phoneKey("(469) 535-9785"), "+14695359785");
  assert.equal(phoneKey("469-535-9785"), "+14695359785");
  assert.equal(phoneKey(""), null);
  assert.equal(phoneKey(null), null);
});

// ─── dealerIdentityKeys ──────────────────────────────────────────────────────

test("dealerIdentityKeys assembles all keys from a candidate", () => {
  const k = dealerIdentityKeys({
    name: "Toyota of Dallas Inc",
    website: "https://www.toyotaofdallas.com",
    zip: "75201",
    city: "Dallas",
    state: "TX",
    phone: "469-535-9785",
  });
  assert.equal(k.host, "toyotaofdallas.com");
  assert.equal(k.nameZip, "toyota of dallas|75201");
  assert.equal(k.nameCityState, "toyota of dallas|dallas|tx");
  assert.equal(k.phone, "+14695359785");
});

// ─── identitiesMatch ─────────────────────────────────────────────────────────

test("identitiesMatch: same website host matches", () => {
  const a = dealerIdentityKeys({ name: "Toyota of Dallas", website: "https://toyotaofdallas.com/new" });
  const b = dealerIdentityKeys({ name: "TOD Sales", website: "http://www.toyotaofdallas.com" });
  assert.equal(identitiesMatch(a, b), true);
});

test("identitiesMatch: no host but same name+zip matches", () => {
  const a = dealerIdentityKeys({ name: "Toyota of Dallas Inc", zip: "75201" });
  const b = dealerIdentityKeys({ name: "toyota of dallas", zip: "75201" });
  assert.equal(identitiesMatch(a, b), true);
});

test("identitiesMatch: same phone matches even when names differ", () => {
  const a = dealerIdentityKeys({ name: "Toyota of Dallas", phone: "469-535-9785" });
  const b = dealerIdentityKeys({ name: "Dallas Toyota", phone: "(469) 535-9785" });
  assert.equal(identitiesMatch(a, b), true);
});

test("identitiesMatch: different dealerships do not match", () => {
  const a = dealerIdentityKeys({ name: "Toyota of Dallas", website: "toyotaofdallas.com", zip: "75201" });
  const b = dealerIdentityKeys({ name: "Honda of Plano", website: "hondaofplano.com", zip: "75024" });
  assert.equal(identitiesMatch(a, b), false);
});

test("identitiesMatch: two empty candidates never match (no null-equals-null)", () => {
  const a = dealerIdentityKeys({});
  const b = dealerIdentityKeys({});
  assert.equal(identitiesMatch(a, b), false);
});
