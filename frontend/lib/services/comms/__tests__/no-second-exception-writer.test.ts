// BUILD-FAILING RULE — exactly one writer for `queue_items`.
//
// §26 requires that every exception names an owner, a buyer-visible status, a
// required action, a deadline and a return point, and that all of them are
// written to `queue_items`. §8.2 Phase 2 requires exactly one writer: later
// phases add exception TYPES, never a second writer. Five facts per row, one
// place that knows them — a second writer is how four of the five quietly
// become optional.
//
// WHY THIS FILE EXISTS ONLY NOW. `lib/services/operations/queue-item.service.ts`
// has cited this exact path as "the build-failing rule that keeps it that way"
// since Phase 2 (:6-8). The file did not exist. A sibling with a similar name —
// `no-direct-transactional-send.test.ts` — enforces a DIFFERENT rule, which is
// what let the citation survive every skim since. Phase 4 is the first phase to
// add new raise sites (four `INVENTORY_EXCEPTION` codes and the candidate-drop
// primitive), so it is the phase that has to make the citation true. A reference
// to a guard is not a guard.
//
// WHAT IT ENFORCES, IN TWO INDEPENDENT DIRECTIONS:
//
//   1. PERSISTENCE. No file outside the canonical service may reach the
//      `queueItem` Prisma delegate with a mutation. Reads are fine — the admin
//      queue, the drain and the reconcilers all read.
//   2. VOCABULARY. No file outside the canonical service may DEFINE a function
//      named `raiseException`. A second definition is how a caller ends up
//      writing a row that never consulted the §26 catalogue, which is the same
//      defect as a second delegate call with none of the visibility.
//
// Both directions matter because either alone is bypassable: a second writer
// could import the delegate under an alias, or could write through a helper of
// its own that eventually calls the real one with a fabricated code. (2) catches
// the shape; (1) catches the mechanism.
//
// Run: pnpm test:comms-outbox

import test from "node:test";
import assert from "node:assert/strict";
import { sourceFiles, read, findAll, format, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();
const ROOTS = ["app", "lib", "components", "scripts"] as const;

/** The one file §8.2 Phase 2 authorises to write `queue_items`. */
const CANONICAL_WRITER = "lib/services/operations/queue-item.service.ts";

/**
 * Every mutating Prisma delegate method. `findMany`/`findFirst`/`findUnique`/
 * `count`/`aggregate`/`groupBy` are deliberately absent: reading the queue is
 * what the admin surface, the drain and the §26 completeness assertion all do,
 * and forbidding it would make the rule unlivable rather than strict.
 */
const MUTATIONS = [
  "create",
  "createMany",
  "createManyAndReturn",
  "upsert",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
] as const;

const DELEGATE_WRITE = new RegExp(`\\bqueueItem\\s*\\.\\s*(?:${MUTATIONS.join("|")})\\s*\\(`, "g");

/**
 * A DEFINITION of `raiseException`, not a call. `export async function
 * raiseException`, `export const raiseException = `, and the un-exported forms
 * of both — a module-private second implementation is still a second
 * implementation.
 */
const RAISE_DEFINITION = /(?:export\s+)?(?:async\s+)?function\s+raiseException\b|(?:export\s+)?(?:const|let|var)\s+raiseException\s*(?::[^=]+)?=/g;

function scannedFiles(): string[] {
  const files = sourceFiles(ROOT, [...ROOTS]);
  assertScanned(files, 800, "no-second-exception-writer");
  return files;
}

test("the canonical writer is where this rule thinks it is", () => {
  // If the service is renamed or moved, every assertion below silently starts
  // permitting the whole repository. Fail loudly instead.
  const src = read(ROOT, CANONICAL_WRITER);
  assert.match(
    src,
    /export\s+async\s+function\s+raiseException\b/,
    `${CANONICAL_WRITER} no longer exports raiseException. This rule's allowlist is keyed on that path — ` +
      "point it at the new one rather than deleting the assertion."
  );
  assert.match(
    src,
    DELEGATE_WRITE,
    `${CANONICAL_WRITER} no longer writes the queueItem delegate. Either the writer moved — update ` +
      "CANONICAL_WRITER — or the scan pattern no longer matches the code, in which case this rule is blind."
  );
});

test("no second writer of queue_items — the delegate is mutated in exactly one file", () => {
  const hits = findAll(ROOT, scannedFiles(), DELEGATE_WRITE).filter((h) => h.file !== CANONICAL_WRITER);
  assert.deepEqual(
    format(hits),
    [],
    "§26 requires one writer for queue_items, and §8.2 Phase 2 makes it " +
      `${CANONICAL_WRITER}. Later phases add exception TYPES to ` +
      "lib/services/operations/exception-catalogue.ts and call raiseException / resolveQueueItem — " +
      `they never write the delegate. New writers: ${format(hits).join(", ")}`
  );
});

test("no second definition of raiseException", () => {
  const hits = findAll(ROOT, scannedFiles(), RAISE_DEFINITION).filter((h) => h.file !== CANONICAL_WRITER);
  assert.deepEqual(
    format(hits),
    [],
    "A second raiseException is a second vocabulary: it can write a row whose code was never checked " +
      "against the §26 catalogue, so the row names an owner, a deadline and a return point that nobody " +
      `ratified. Import the one in ${CANONICAL_WRITER}. Found: ${format(hits).join(", ")}`
  );
});

test("the rule is not vacuous — it can see the writer it permits", () => {
  // The three assertions above all pass if the scan finds nothing at all. This
  // one fails in that case: the canonical writer must be inside the scanned set,
  // with at least one delegate mutation, or the roots are wrong.
  const files = scannedFiles();
  assert.ok(
    files.includes(CANONICAL_WRITER),
    `${CANONICAL_WRITER} is not in the scanned set (${files.length} files). The roots are wrong and this ` +
      "rule is enforcing nothing."
  );
  const inCanonical = findAll(ROOT, [CANONICAL_WRITER], DELEGATE_WRITE);
  assert.ok(
    inCanonical.length >= 1,
    "The scan found no delegate mutation in the canonical writer, so the pattern no longer matches real code."
  );
});
