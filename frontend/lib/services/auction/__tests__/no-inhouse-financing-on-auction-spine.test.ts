// Program 3 — req #15/#16: MicroBilt is prequalification-only and there is NO
// in-house financing/lender program. Program 3 touches the PAID → auction → offer
// → Deal spine; that spine must NOT activate, extend, or wire in the dormant
// Phase-5 lender-decisioning modules (financing/lender/*, financing-orchestrator,
// credit-application). This is an executable guard, not a convention: if a future
// edit imports lender decisioning into the competitive-auction path, this fails.
//
//   npx tsx --test lib/services/auction/__tests__/no-inhouse-financing-on-auction-spine.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// The competitive-auction → offer → Deal spine Program 3 operates on.
function spineFiles(): string[] {
  const files: string[] = [];
  for (const dir of ["lib/services/auction", "lib/services/offer"]) {
    const full = join(ROOT, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full)) {
      if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) files.push(join(dir, entry));
    }
  }
  // The winner-selection → Deal-creation path.
  files.push("lib/services/deal/select-offer.service.ts");
  files.push("app/api/buyer/auctions/[auctionId]/select-offer/route.ts");
  return files.filter((f) => existsSync(join(ROOT, f)));
}

// Import specifiers / symbols that mean "in-house lender decisioning is being
// wired in". NOTE: the DealStatus value "FINANCING_PENDING" and the word
// "financing" alone are legitimate on the Deal spine, so we match only the
// lender-DECISIONING module paths + symbols, never the bare word "financing".
const FORBIDDEN = [
  "financing/lender",
  "lender-service",
  "mock-lender-adapter",
  "financing-orchestrator",
  "credit-application.service",
  "LenderAdapter",
  "submitCreditApplication",
  "runLenderDecision",
];

test("the auction→offer→Deal spine does not import in-house lender decisioning", () => {
  const offenders: string[] = [];
  for (const rel of spineFiles()) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const needle of FORBIDDEN) {
      if (src.includes(needle)) offenders.push(`${rel} references "${needle}"`);
    }
  }
  assert.deepEqual(offenders, [], `In-house financing must stay dormant on the auction spine:\n${offenders.join("\n")}`);
});

test("the spine file list is non-empty (guard actually scanned real files)", () => {
  const files = spineFiles();
  assert.ok(files.length >= 5, `expected the auction/offer/deal spine files, got ${files.length}`);
  assert.ok(files.includes("lib/services/deal/select-offer.service.ts"));
});
