// The owner's CONDITION on signing off the `radiusMiles` removal (2026-09-10):
//
//   "§22a makes the ceiling AutoLenis policy, not a client parameter, so removing client
//    control is right. But silently returning a different result set than the URL requested is
//    the defect class this program exists to eliminate. Ignore the parameter AND have the
//    results header state the radius in force, so a bookmark carrying radiusMiles=25 reads
//    'within 100 miles' rather than quietly lying."
//
// Two halves, and this file pins both.
//
// WHY THIS SCANS SOURCE INSTEAD OF RENDERING. `BuyerSearchClient` is a client component and
// this repository has no DOM harness — the unit suites are `node:test` over services and route
// handlers, and UI is covered by Playwright. Source scanning is the established pattern here
// for an invariant that lives in a component (lib/security/__tests__/no-ssn-intake.test.ts
// scans intake surfaces the same way, and shortlist-cap.test.ts reads the migration SQL). It
// is a weaker check than a render — it proves the code says the right thing, not that a browser
// shows it — so the assertions are written against structure that cannot be satisfied by a
// comment, and the copy itself is left to Playwright.
//
//   npx tsx --test app/api/buyer/search/__tests__/radius-disclosure.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CLIENT = new URL("../../../../../components/buyer/BuyerSearchClient.tsx", import.meta.url);

function source(): string {
  return readFileSync(CLIENT, "utf8");
}

/** The file with every comment removed, so a claim in prose can never satisfy an assertion. */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments, JSX comment bodies included
    .replace(/^\s*\/\/.*$/gm, "");      // line comments
}

test("the parameter is stripped before the request leaves the browser", () => {
  // Not "the server ignores it" — that is true (no-radius-drop.test.ts) but it is the far end.
  // A surface that transmits a filter it does not honour is one route change away from
  // honouring it again by accident.
  assert.match(
    code(),
    /params\.delete\(\s*["']radiusMiles["']\s*\)/,
    "BuyerSearchClient must delete radiusMiles from the outgoing query string",
  );
});

test("radiusMiles is never SET on an outgoing query", () => {
  const c = code();
  assert.doesNotMatch(
    c,
    /params\.set\(\s*["']radiusMiles["']/,
    "setting it would re-transmit the filter this batch removed",
  );
  assert.doesNotMatch(
    c,
    /radiusMiles=\$\{/,
    "and it must not be interpolated into a URL either",
  );
});

test("the results header states the radius in force, from the server's own number", () => {
  const c = code();
  // `policyRadius` is set from `data.radiusMiles` — the SERVER's policy — so the header cannot
  // drift from the gate that decides the card's action.
  assert.match(
    c,
    /setPolicyRadius\(\s*data\.radiusMiles\s*\?\?\s*null\s*\)/,
    "the policy radius must come from the server response, not a client constant",
  );
  const header = c.slice(c.indexOf('data-testid="results-count"'));
  const inRadius = header.slice(0, header.indexOf("</p>"));
  assert.ok(
    /\{policyRadius\}\s*miles/.test(inRadius),
    "the results header must render the radius in force next to the count",
  );
});

test("a link asking for a different radius is contradicted out loud", () => {
  const c = code();
  assert.match(c, /data-testid="radius-param-ignored"/, "the disclosure element must exist");
  // Conditioned on a real difference: a link that happens to carry the policy value, or no
  // link parameter at all, must not produce a line explaining a discrepancy that is not there.
  assert.match(
    c,
    /requestedRadius\s*!==\s*null[\s\S]{0,120}?requestedRadius\s*!==\s*policyRadius/,
    "shown only when the URL asked for something other than the radius in force",
  );
  assert.match(c, /\{requestedRadius\}/, "and it must name what the link actually asked for");
});

test("requestedRadius is read for disclosure only — nothing branches the RESULTS on it", () => {
  const c = code();
  const uses = [...c.matchAll(/requestedRadius/g)].length;
  assert.ok(uses >= 3, `expected the disclosure to reference it; found ${uses}`);
  // It must not reach the fetch, the filter state, or the URL the surface writes back.
  const fetchBlock = c.slice(c.indexOf("const fetchResults"), c.indexOf("const fetchResults") + 900);
  assert.doesNotMatch(
    fetchBlock,
    /requestedRadius/,
    "the ignored parameter must never influence the request",
  );
});
