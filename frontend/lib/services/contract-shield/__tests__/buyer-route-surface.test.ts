// P0 regression: a buyer could self-approve their own Contract Shield review.
//
// POST /api/buyer/contract-shield/[dealId] authenticated the buyer and checked
// deal ownership — and then let that buyer decide the outcome of the review
// performed on their own deal, two ways:
//
//   1. With NO body it persisted a fabricated PASS (score 88) as a real
//      ContractScan row and wrote contractShieldScore=88 /
//      contractShieldStatus="PASS" onto the Deal. Contract Shield PASS is the
//      hard gate for signing — prepareBuyerSigningEnvelope requires
//      CONTRACT_APPROVED, and computeJourney treats contractShieldPassed as
//      reaching the "sign" stage — so one POST let a buyer clear their own
//      contract review and advance their own deal toward execution.
//   2. With a body it ran scanContract() over buyer-supplied `contractText`,
//      letting the buyer choose the document their own review was performed
//      against instead of the dealer's real uploaded contract.
//
// Nothing in the buyer UI ever called it (/buyer/contract-shield renders the
// latest scan read-only), so it was a zero-caller endpoint that existed only as
// an escalation path. It is removed, not patched.
//
// This test fails if POST is ever reintroduced on the buyer route.
//
// Run: pnpm test:contract-shield
//   (globs lib/services/contract-shield/__tests__/*.test.ts)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = join(
  process.cwd(),
  "app/api/buyer/contract-shield/[dealId]/route.ts",
);

test("the buyer contract-shield route exposes GET only", async () => {
  const mod: Record<string, unknown> = await import(
    "@/app/api/buyer/contract-shield/[dealId]/route"
  );
  assert.equal(typeof mod.GET, "function", "the read endpoint must remain");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(
      mod[method],
      undefined,
      `${method} must not exist on the buyer contract-shield route — a buyer may ` +
        `never trigger, supply, or decide the outcome of their own contract review`,
    );
  }
});

test("the buyer route can no longer mint a scan result or touch the deal's shield fields", () => {
  const src = readFileSync(ROUTE, "utf8");
  // The specific writes that made self-approval possible.
  assert.ok(
    !/contractScan\s*\.\s*create/.test(src),
    "the buyer route must not create a ContractScan row",
  );
  assert.ok(
    !/contractShieldStatus\s*:/.test(src),
    "the buyer route must not write contractShieldStatus",
  );
  assert.ok(
    !/contractShieldScore\s*:/.test(src),
    "the buyer route must not write contractShieldScore",
  );
  assert.ok(
    !/scanContract\s*\(/.test(src),
    "the buyer route must not invoke a scan — scanning runs over the dealer's " +
      "uploaded ContractVersion via scanContractVersion(), never buyer-supplied text",
  );
});

test("the canonical scan path is unchanged and still dealer/system-owned", () => {
  // Removing the buyer POST must not orphan the capability: scanning still runs
  // over the dealer's real uploaded contract, swept by cron and reviewed by an
  // admin. Asserted by source rather than by import — dealer-contract.service
  // pulls in `server-only`, which refuses to load under the test runner.
  const dealerSvc = readFileSync(
    join(process.cwd(), "lib/services/dealer/dealer-contract.service.ts"),
    "utf8",
  );
  assert.match(
    dealerSvc,
    /export async function scanContractVersion\s*\(/,
    "scanContractVersion (real PDF text, dealer-uploaded version) must remain the scan entry point",
  );
  const cron = readFileSync(join(process.cwd(), "app/api/cron/contract-shield/route.ts"), "utf8");
  assert.match(cron, /scanContractVersion/, "the cron sweep must still drive scanning");
});
