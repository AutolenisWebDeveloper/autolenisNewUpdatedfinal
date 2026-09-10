// BUILD-FAILING RULE — no provider Carfax field is requested, typed, stored or surfaced.
//
// MarketCheck returns `carfax_1_owner` and `carfax_clean_title` on every listing, unrequested,
// while declaring them unusable in its own tool contract:
//
//   "DO NOT USE CARFAX FIELDS: Carfax data on this server is incomplete and unreliable. Do NOT
//    pass `carfax_1_owner` or `carfax_clean_title` as filters, do NOT request them in
//    facets/stats, and do NOT infer ownership history, title status, or any other meaning from
//    any `carfax_*` value that might appear in a listing. Treat all Carfax fields as if they did
//    not exist."
//
// §8a settles it independently: the vehicle history report is DEALER-SUPPLIED. A dealer attaches
// a real CARFAX URL to a real offer, and that is the artefact a buyer may rely on. An aggregator
// boolean of unknown provenance rendered next to it would look like the same fact and is not one.
//
// WHY A GUARD RATHER THAN A NOTE. Today the repository is clean — every `carfax` occurrence is a
// dealer-supplied `carfaxUrl` from the offer form, plus one seed string and one due-diligence
// checklist label. Phase 4 is what puts it at risk: it WIDENS the listing type to add
// `mc_dealership`, `build` and `website`, and the obvious way to widen a type is to transcribe the
// live payload — which contains both Carfax keys. This rule is cheap now and expensive to add
// after the first one lands in a column.
//
// Run: pnpm test:inventory

import test from "node:test";
import assert from "node:assert/strict";
import { sourceFiles, read, findAll, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();
const ROOTS = ["app", "lib", "components", "scripts"] as const;

/**
 * The PROVIDER's fields, matched by their wire names and their camelCase transliterations.
 * Deliberately NOT a bare /carfax/i: the dealer-supplied `carfaxUrl` is a legitimate, required
 * capability (§8a) and a rule that forbade it would be wrong, would be disabled, and would then
 * protect nothing.
 */
const PROVIDER_CARFAX = /\bcarfax_1_owner\b|\bcarfax_clean_title\b|\bcarfax1Owner\b|\bcarfaxCleanTitle\b/g;

/** Every `carfax`-adjacent identifier, so the allowlist below can be checked for staleness. */
const ANY_CARFAX = /\bcarfax[A-Za-z_]*\b/gi;

/**
 * The dealer-supplied surface, which is REQUIRED and must keep working. Each entry is a file that
 * legitimately names Carfax, with what it is. If one of these disappears, a capability was
 * removed and the test says so.
 */
const DEALER_SUPPLIED: ReadonlyArray<{ file: string; what: string }> = [
  { file: "components/public/DealerOfferFormClient.tsx", what: "the dealer pastes a real CARFAX report URL onto their offer" },
  { file: "components/public/BuyerOfferReviewClient.tsx", what: "the buyer opens the URL the dealer supplied" },
  { file: "app/api/public/dealer-offer/[token]/route.ts", what: "carfaxUrl accepted and validated as a URL" },
  { file: "app/(public)/buyer-offer-review/[reviewToken]/page.tsx", what: "the review page's type" },
];

function scanned(): string[] {
  const files = sourceFiles(ROOT, [...ROOTS]);
  assertScanned(files, 800, "no-carfax-from-provider");
  return files;
}

/**
 * Comments stripped. The rule is about CODE.
 *
 * The adapter's listing type carries a comment naming both fields, to say why they are
 * DELIBERATELY not declared — which is the single most useful thing in the file for
 * stopping the next author adding them. A scan that could not tell a warning from a
 * violation would forbid its own best defence, and the way that ends is with the rule
 * disabled. Caught on this rule's first run.
 */
function codeOf(file: string): string {
  return read(ROOT, file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Hits of `pattern` across `files`, ignoring comments. Mirrors findAll's shape. */
function findInCode(files: readonly string[], pattern: RegExp): string[] {
  const out: string[] = [];
  for (const file of files) {
    const code = codeOf(file);
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    for (const m of code.matchAll(re)) {
      out.push(`${file}:${code.slice(0, m.index ?? 0).split("\n").length}`);
    }
  }
  return out;
}

test("no provider Carfax field is named anywhere in the application", () => {
  const hits = findInCode(scanned(), PROVIDER_CARFAX);
  assert.deepEqual(
    hits,
    [],
    "MarketCheck declares carfax_1_owner and carfax_clean_title unreliable and instructs that they " +
      "be treated as if they did not exist; §8a makes the vehicle history report dealer-supplied. " +
      "They arrive on every listing unrequested — reading one is what turns 'we did not ask for it' " +
      `into 'we showed it'. Found: ${hits.join(", ")}`
  );
});

test("the comment that says WHY they are absent is present, and does not trip the rule", () => {
  // The rule's own blind spot, asserted. If the explanation is ever deleted the next author
  // has nothing telling them the omission is deliberate, and the rule alone reads as
  // arbitrary — which is how a guard gets removed rather than obeyed.
  const adapter = read(ROOT, "lib/services/inventory/adapters/marketcheck.adapter.ts");
  assert.match(
    adapter,
    /DELIBERATELY NOT DECLARED[\s\S]{0,200}carfax/i,
    "the listing type must keep saying why the Carfax fields are not on it"
  );
  assert.deepEqual(
    findInCode(["lib/services/inventory/adapters/marketcheck.adapter.ts"], PROVIDER_CARFAX),
    [],
    "…and that explanation must not itself count as a violation"
  );
});

test("no provider Carfax field is declared on the Prisma schema", () => {
  const schema = read(ROOT, "prisma/schema.prisma");
  assert.doesNotMatch(
    schema,
    /carfax_1_owner|carfax_clean_title|carfax1Owner|carfaxCleanTitle/i,
    "A column is the point of no return: once a provider Carfax value is persisted it will be read."
  );
});

test("no provider Carfax field is requested in a migration or a query parameter", () => {
  // `facets=carfax_*` and `carfax_1_owner=true` are filter/facet REQUESTS, which the provider's
  // contract forbids separately from reading the returned value.
  const hits = findInCode(scanned(), /carfax[_a-z]*\s*[:=]\s*["']?(?:true|false)/gi);
  assert.deepEqual(hits, [], `A Carfax filter or facet was requested: ${hits.join(", ")}`);
});

test("the DEALER-supplied Carfax capability still exists — this rule must not have removed it", () => {
  // The failure mode of an over-broad ban. §8a REQUIRES the dealer-supplied report; if these
  // files stop naming Carfax, the guard was applied too widely and a capability went with it.
  const files = scanned();
  for (const { file, what } of DEALER_SUPPLIED) {
    assert.ok(files.includes(file), `${file} is no longer scanned — the allowlist is stale`);
    assert.match(
      read(ROOT, file),
      /carfax/i,
      `${file} no longer mentions Carfax, but it is where ${what}. §8a requires the dealer-supplied ` +
        "vehicle history report; this rule forbids the PROVIDER's unreliable booleans, not the dealer's report."
    );
  }
});

test("the rule is not vacuous — it can see the legitimate uses it permits", () => {
  const all = findAll(ROOT, scanned(), ANY_CARFAX);
  assert.ok(
    all.length >= 10,
    `Only ${all.length} carfax identifiers found across the scan. The dealer-supplied surface alone ` +
      "spans four files and more than ten references; a number this low means the scan is not reaching them."
  );
});
