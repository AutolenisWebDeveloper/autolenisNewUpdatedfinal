// §27 — a BUILD-FAILING guard on the SHAPE of every Phase 7 enqueue, not its content.
//
// Run with:  npx tsx --test lib/services/comms/__tests__/phase7-enqueue-shape.test.ts
//
// TWO DEFECTS, ONE CLASS, BOTH FOUND BY READING THE DIFF RATHER THAN BY A FAILING TEST.
//
//  1. THE MISSING `dealId`. `notifyCheckpoint`'s FAILED/EXPIRED branch enqueued without one.
//     `skipIfFinancingStatusChanged` opens with `if (!ctx.dealId) return { proceed: false }`, so
//     the row was SKIPPED at drain — not failed, not retried, just never sent. §Stage 12's failure
//     clause ("the buyer is told plainly what is being tried and by when") was unreachable for
//     every failure and every expiry, and nothing threw, so nothing could have noticed.
//
//  2. THE BLIND CATCH. Six enqueues ended `.catch(() => undefined)`. `enqueueTransactional` throws
//     on an unregistered template, an unrenderable payload or a database failure, and all three
//     became silence — which is exactly how the `RETURNED_TO_OFFERS` notice came to never send
//     while every other assertion about the stand-down passed.
//
// Both are properties of the CALL, visible in the source, and invisible to a behaviour test that
// stubs the dispatcher. So they are asserted in the source, where they live.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceFiles, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();

/** The services that enqueue Phase 7's notices. */
const PHASE_7_SERVICES = [
  "lib/services/deal/dealer-reaffirmation.service.ts",
  "lib/services/deal/deal-recap.service.ts",
  "lib/services/deal/return-to-offers.service.ts",
  "lib/services/financing/financing-checkpoint.service.ts",
];

/**
 * Split a file into the argument text of each enqueue call. Crude on purpose — it slices from the
 * call to the matching close of its FIRST argument object, which is where `dealId` belongs. A
 * parser would be more precise and would also be a thing that can be wrong quietly.
 */
function enqueueCalls(src: string): string[] {
  const calls: string[] = [];
  const re = /(enqueueTransactional|enqueueOrRaise)\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    calls.push(src.slice(m.index, i));
  }
  return calls;
}

test("every Phase 7 enqueue carries a dealId — its recheck refuses the row without one", () => {
  const offenders: string[] = [];
  let total = 0;
  for (const file of PHASE_7_SERVICES) {
    const src = readFileSync(`${ROOT}/${file}`, "utf8");
    for (const call of enqueueCalls(src)) {
      total++;
      // THE PROPERTY, NOT THE INTERPOLATION. A first draft of this test matched `\bdealId\b`,
      // which also matches `${dealId}` inside the idempotency key — so it passed against a call
      // with the property deleted. A guard that cannot fail is worse than no guard, because it
      // reads as evidence. This matches `dealId,` (shorthand) or `dealId:` (explicit) only.
      if (!/(?:^|[\s{,])dealId\s*[,:]/m.test(call)) {
        const template = /templateKey:\s*([^,\n]+)/.exec(call)?.[1]?.trim() ?? "unknown template";
        offenders.push(`${file} → ${template}`);
      }
    }
  }
  assert.ok(total >= 10, `expected to find Phase 7's enqueues; found ${total}`);
  assert.deepEqual(
    offenders,
    [],
    "A transactional notice with no deal reference is SKIPPED by its state recheck at drain — " +
      `never sent, never failed, never retried. Offenders: ${offenders.join(", ")}`,
  );
});

test("no Phase 7 enqueue is followed by a blind catch", () => {
  const offenders: string[] = [];
  for (const file of PHASE_7_SERVICES) {
    const src = readFileSync(`${ROOT}/${file}`, "utf8");
    // `enqueueOrRaise` is the sanctioned shape: it logs and opens a COMMS_TERMINAL_FAILURE row.
    // A bare `enqueueTransactional(...)` followed by a catch that returns undefined is not.
    for (const call of enqueueCalls(src)) {
      if (!/enqueueTransactional/.test(call)) continue;
      const after = src.slice(src.indexOf(call) + call.length, src.indexOf(call) + call.length + 120);
      if (/\.catch\(\(\)\s*=>\s*undefined\)/.test(after)) offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "`enqueueTransactional` throws on an unregistered template, an unrenderable payload or a DB " +
      "failure. Swallowing that makes a required §27 notice silently never send. Use " +
      `enqueueOrRaise. Offenders: ${offenders.join(", ")}`,
  );
});

test("the Phase 7 services are the ones this suite thinks they are", () => {
  // NON-VACUITY. A renamed or moved service would make both assertions above pass over nothing.
  const found = sourceFiles(ROOT, ["lib/services/deal", "lib/services/financing"]).filter((f) =>
    PHASE_7_SERVICES.includes(f),
  );
  assertScanned(found, PHASE_7_SERVICES.length, "phase7-enqueue-shape");
});
