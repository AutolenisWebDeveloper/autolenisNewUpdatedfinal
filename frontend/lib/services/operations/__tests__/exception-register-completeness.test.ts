// §8.3 COMPLETENESS — every `exception_code` in the register has at least one raise site.
//
// §8.3: "Phase 10 asserts completeness by a table-driven test that every
// `template_key` and `exception_code` in the register has at least one
// enqueue/raise site." This is the `exception_code` half; the `template_key` half
// is `lib/services/comms/__tests__/communications-register-completeness.test.ts`.
//
// WHY THE REGISTER IS THE TABLE AND NOT A HAND-WRITTEN LIST. `exception-catalogue.ts`
// already holds all 48 §26 rows plus the entries the Markdown states outside §26.
// Driving the assertion off `EXCEPTION_CATALOGUE` itself means a code added to the
// register tomorrow is covered by this rule the moment it is added — nobody has to
// remember to extend a second list, which is the failure mode §8.3 exists to close.
//
// WHY STRING LITERALS AND NOT grep. A code named in a comment — `// TODO: raise
// PAYMENT_FAILURE here` — satisfies a grep and satisfies nothing else. The scan
// parses each file and collects only literals that appear in CODE, so prose cannot
// discharge a register row. `stringLiterals` (lib/testing/source-scan.ts) does the
// parse; `ts.forEachChild` never descends into trivia.
//
// THE RULE IS PROVED TO FAIL. The last test seeds a deliberately unwired code and
// asserts the checker reports it. Phase 9 shipped a gate that asserted
// `complete === true` against a fixture that could not have been incomplete; a
// completeness rule that cannot fail is worse here than anywhere else, because
// this is the rule the other nine phases are measured by.
//
// Run: pnpm test:operations

import test from "node:test";
import assert from "node:assert/strict";
import { sourceFiles, assertScanned, stringLiterals } from "@/lib/testing/source-scan";
import { EXCEPTION_CATALOGUE } from "@/lib/services/operations/exception-catalogue";

const ROOT = process.cwd();
const ROOTS = ["app", "lib"] as const;

/**
 * The catalogue file itself is excluded: it necessarily contains every code as a
 * literal, so leaving it in would make the rule pass unconditionally — the exact
 * vacuous-pass shape `assertScanned` exists to prevent, one level up.
 */
const CATALOGUE_FILE = "lib/services/operations/exception-catalogue.ts";

function raiseSiteLiterals(): Set<string> {
  const files = sourceFiles(ROOT, [...ROOTS]).filter((f) => f !== CATALOGUE_FILE);
  assertScanned(files, 800, "exception-register-completeness");
  const literals = stringLiterals(ROOT, files);
  assert.ok(
    literals.size > 1000,
    `the literal scan collected only ${literals.size} strings — the parse failed and this rule is now blind`
  );
  return literals;
}

/** Registered codes with no literal anywhere outside the catalogue. */
function unwired(literals: ReadonlySet<string>): string[] {
  return EXCEPTION_CATALOGUE.filter((d) => !literals.has(d.code))
    .map((d) => d.code)
    .sort();
}

test("the register is non-empty and every entry is well-formed", () => {
  assert.ok(
    EXCEPTION_CATALOGUE.length >= 48,
    `§26 has 48 rows; the catalogue holds ${EXCEPTION_CATALOGUE.length}. A shrunken register would make the completeness rule below trivially satisfiable.`
  );
  for (const d of EXCEPTION_CATALOGUE) {
    assert.ok(d.code.length > 0, "an entry must have a code");
    assert.ok(d.ownerRole, `${d.code}: §26 requires an owner`);
    assert.ok(d.requiredResult.length > 0, `${d.code}: §26 requires a required result`);
  }
});

test("§8.3 — every registered exception_code has at least one raise site", () => {
  const missing = unwired(raiseSiteLiterals());
  assert.deepEqual(
    missing,
    [],
    "§26 requires every exception to raise through the writer, and §8.3 makes Phase 10 assert it. " +
      "These codes are catalogued but nothing raises them, so the register describes exceptions the " +
      "system cannot actually report. Wire a raise site through raiseException(), or — if the code is " +
      "genuinely not reachable — remove it from the register with a recorded reason. Leaving it here " +
      `is the register claiming a capability that does not exist. Unwired: ${missing.join(", ")}`
  );
});

test("the rule detects a real gap — proved against a seeded omission", () => {
  const literals = raiseSiteLiterals();

  // A code that IS wired today, so removing it from the observed set simulates
  // exactly the regression this rule exists to catch: a raise site deleted while
  // its register row stays behind.
  const wired = EXCEPTION_CATALOGUE.map((d) => d.code).filter((c) => literals.has(c));
  assert.ok(
    wired.length > 0,
    "no registered code has a raise site at all — the scan is broken, and every assertion above is vacuous"
  );

  const victim = wired[0]!;
  const seeded = new Set(literals);
  seeded.delete(victim);

  assert.ok(
    unwired(seeded).includes(victim),
    `seeding the removal of ${victim} did not make the checker report it — the rule cannot fail, so its passing means nothing`
  );

  // And the converse: with the literal restored the same code is not reported, so
  // the rule is not simply reporting everything.
  assert.ok(
    !unwired(literals).includes(victim),
    `${victim} is reported as unwired even though its literal is present — the checker reports indiscriminately`
  );
});
