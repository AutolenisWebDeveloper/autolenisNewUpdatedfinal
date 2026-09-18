// F7 — `VehicleRequestEntryType.INVENTORY_SELECTION` has no production writer.
//
// WHY THIS IS A SOURCE SCAN AND NOT A DATABASE READ-BACK.
//
// The first version of this assertion lived in `spine.itest.ts`: the fixture wrote
// `entryType: "CUSTOM_REQUEST"`, and the test then read that column back and asserted it
// equalled "CUSTOM_REQUEST", with a comment claiming "if this now reads
// INVENTORY_SELECTION, a writer was added and F7 is resolved".
//
// Both halves of that were false, and the second independent review proved it by editing
// one fixture line and watching the test fail:
//   • the only way it could read INVENTORY_SELECTION was for someone to edit the test's
//     own fixture — no production change could do it;
//   • if a real writer WERE added in `app/`, the assertion would stay green forever, so
//     the finding would go stale in exactly the way the comment promised it could not.
//
// A claim about what production writes must be checked against production source. This
// file uses the repository's own scanner — the same `assertScanned` floor the §8.3
// completeness gates use, for the same reason: a guard that scans nothing passes without
// enforcing anything.

import test from "node:test";
import assert from "node:assert/strict";
import { sourceFiles, stringLiterals, assertScanned } from "@/lib/testing/source-scan";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());

test("F7 — no production code writes INVENTORY_SELECTION", () => {
  const files = sourceFiles(ROOT, ["app", "lib"]);
  assertScanned(files, 800, "f7-entry-type");

  // Files that mention `entryType` at all. Narrowed the way the §8.3 gates narrow, so a
  // literal appearing in unrelated code cannot discharge or trip the rule.
  const writers = files.filter((f) => {
    try {
      return require("node:fs").readFileSync(f, "utf8").includes("entryType");
    } catch {
      return false;
    }
  });
  assert.ok(
    writers.length >= 3,
    `only ${writers.length} files mention entryType — the filter is wrong and this rule is blind`,
  );

  const offenders = writers.filter((f) => stringLiterals(ROOT, [f]).has("INVENTORY_SELECTION"));

  assert.deepEqual(
    offenders.map((f) => f.replace(`${ROOT}/`, "")),
    [],
    "F7 states that `INVENTORY_SELECTION` has no production writer — §34's 'Selected " +
      "inventory' entry form is therefore not recorded on the Vehicle Request at all, and " +
      "the only mechanical expression of it is the shortlist → AuctionVehicle candidate " +
      "set. If this now fails, a writer WAS added: F7 is resolved and both this test and " +
      "ACCEPTANCE-REPORT.md must be updated deliberately.",
  );
});

test("F7's scan is discriminating — it finds the literal when one exists", () => {
  // The rule above asserts an ABSENCE. An absence assertion over a broken scan passes
  // silently, which is the "drift guard comparing two empty sets" defect. So: prove the
  // same scan DOES find a literal that is genuinely present in the same file set.
  const files = sourceFiles(ROOT, ["app", "lib"]);
  const withCustom = files.filter((f) => stringLiterals(ROOT, [f]).has("CUSTOM_REQUEST"));
  assert.ok(
    withCustom.length > 0,
    "the scan found no file containing the literal \"CUSTOM_REQUEST\" — but " +
      "`app/api/public/request-vehicle/route.ts` writes it twice. The scan is broken, and " +
      "the absence assertion above therefore proves nothing.",
  );
});
