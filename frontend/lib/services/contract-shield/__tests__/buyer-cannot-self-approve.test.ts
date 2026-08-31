// SECURITY REGRESSION GUARD — Contract Shield is the compliance gate that stands
// between a buyer and a signable contract. The buyer is the party it protects, so
// no buyer-facing surface may ever produce an authoritative scan result.
//
// The defect this pins: POST /api/buyer/contract-shield/[dealId] accepted a
// buyer-supplied `contractText`, passed it straight to scanContract() — which
// writes the authoritative ContractScan, overwrites deal.contractShieldScore /
// contractShieldStatus, and then calls autoAdvanceContractOnPass() to walk the deal
// CONTRACT_PENDING → CONTRACT_REVIEW → CONTRACT_APPROVED. A buyer could therefore
// approve their own contract and make the deal signable without the dealer's real
// document ever being scanned. With NO body at all the same route wrote a mock
// PASS (score 88) directly onto the deal.
//
// The route had zero callers. The mutating handler is removed; scans are driven
// only by the dealer contract upload (dealer-contract.service) and by admin review.
// The read-only GET remains.
//
// Asserted by source inspection rather than by importing the route: these modules
// pull in `server-only`, and the guarantee ("this handler does not exist") is a
// property of the source, not of runtime behaviour.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/contract-shield/__tests__/buyer-cannot-self-approve.test.ts"

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const BUYER_API = join(process.cwd(), "app", "api", "buyer");
const SHIELD_ROUTE = join(BUYER_API, "contract-shield", "[dealId]", "route.ts");

function buyerRouteFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith(".ts") && !p.includes("__tests__")) out.push(p);
    }
  };
  walk(BUYER_API);
  return out;
}

test("the buyer Contract Shield route exposes NO mutating handler", () => {
  const src = readFileSync(SHIELD_ROUTE, "utf8");
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].filter((m) =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src),
  );
  assert.deepEqual(
    mutating,
    [],
    `a buyer must never be able to write a Contract Shield result; found: ${mutating.join(", ")}`,
  );
});

test("the buyer Contract Shield route still exposes the read-only GET", () => {
  const src = readFileSync(SHIELD_ROUTE, "utf8");
  assert.match(src, /export\s+async\s+function\s+GET\b/, "buyers must still be able to READ their scan result");
});

test("no buyer-facing route imports scanContract (it auto-advances the deal)", () => {
  // An IMPORT is the real signal — the symbol cannot be invoked without one, and
  // unlike a bare substring match this does not trip over prose in a comment
  // explaining why the route must not do this.
  const offenders = buyerRouteFiles()
    .filter((p) => /import\s*\{[^}]*\bscanContract\b[^}]*\}\s*from|\bfrom\s+["'][^"']*contract-shield\.service["']/.test(readFileSync(p, "utf8")))
    .map((p) => p.replace(process.cwd() + "/", ""));
  assert.deepEqual(offenders, [], `buyer routes must not import scanContract: ${offenders.join(", ")}`);
});

test("no buyer-facing route writes contractShieldStatus directly", () => {
  const offenders = buyerRouteFiles()
    .filter((p) => /contractShieldStatus\s*:/.test(readFileSync(p, "utf8")))
    .map((p) => p.replace(process.cwd() + "/", ""));
  assert.deepEqual(
    offenders,
    [],
    `the compliance verdict must never be written from a buyer route: ${offenders.join(", ")}`,
  );
});
