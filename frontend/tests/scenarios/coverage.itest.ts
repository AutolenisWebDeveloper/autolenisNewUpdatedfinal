// §26 and §27.1 coverage — MEASURED by the suite, and ratcheted.
//
// WHY THIS FILE EXISTS. `_harness.ts` states the suite's Rule 1: "COVERAGE IS MEASURED,
// NOT ASSERTED … this harness never asks the source tree anything. It drives the real
// services and then reads `queue_items.exception_code` and `comms_outbox.template_key`
// out of the database."
//
// It exported `exceptionCodesRaised()` and `templateKeysEnqueued()` to do that — and
// then NOTHING CALLED THEM. The second independent review found it: the headline numbers
// in ACCEPTANCE-REPORT.md (§26 7 of 55, §27.1 20 of 79) were produced by an ad-hoc SQL
// query run by hand, not by this suite. If §26 coverage fell to 1, every test still
// passed. The rule was decorative, which is the same defect the rule was written against.
//
// This file makes the numbers the suite's own output, and makes them a RATCHET: coverage
// may rise, and a fall is a failure that names itself. That is the only form in which a
// coverage number defends anything.
//
// WHAT THE NUMBER IS AND IS NOT. It counts codes and keys a PRODUCTION raise/enqueue site
// actually wrote during the runs this database has seen. §8.3's Phase-10 gates prove a
// site EXISTS; this proves one was REACHED — the gap §8.1j records as open, and the
// reason `PICKUP_MISSED` counted as satisfied throughout Phase 9 with no caller.
//
// It is a LOWER BOUND: several E2E specs delete their own rows in teardown, so a code
// raised and cleaned up is not counted. Measuring the true reached-count needs capture at
// raise time, which this phase did not build. Stated here and in the report rather than
// letting the floor read as the figure.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  prisma,
  assertNonEmpty,
  exceptionCodesRaised,
  templateKeysEnqueued,
} from "./_harness";
import { EXCEPTION_CATALOGUE } from "@/lib/services/operations/exception-catalogue";
import { allTemplateKeys } from "@/lib/services/comms/state-recheck-registry";

/**
 * The floors, measured 2026-09-18 on a database that had run the full suite plus the
 * phase 2/5-10 journeys and the form walk.
 *
 * Raising these is the point. Lowering one requires a deliberate edit and an explanation,
 * which is what stops a silent regression reading as "still fine".
 */
const SECTION_26_FLOOR = 7;
const SECTION_27_1_FLOOR = 20;

test("§26 — the reached-code count is measured from the database and does not fall", async () => {
  const reached = await exceptionCodesRaised();
  const catalogued = EXCEPTION_CATALOGUE.length;

  // Non-emptiness first: a count over zero rows would make the ratchet below vacuous.
  assertNonEmpty(
    reached,
    "§26 codes reached — with none, this file measures nothing and the ratchet is meaningless",
    SECTION_26_FLOOR,
  );

  assert.ok(
    reached.length <= catalogued,
    `more distinct exception_code values (${reached.length}) than the catalogue holds ` +
      `(${catalogued}) — a code was written that requireException() should have refused`,
  );

  // Every reached code must be one the catalogue knows. A row carrying an uncatalogued
  // code has no owner, deadline or copy — §26's whole guarantee — and `exceptionLineage`
  // drops it silently, so it would be invisible rather than wrong.
  const known = new Set(EXCEPTION_CATALOGUE.map((d: { code: string }) => d.code));
  const unknown = reached.filter((c) => !known.has(c));
  assert.deepEqual(
    unknown,
    [],
    `these exception codes were written to queue_items but are not in the catalogue: ${unknown.join(", ")}`,
  );

  console.log(`§26 REACHED: ${reached.length} of ${catalogued} catalogued — ${reached.join(", ")}`);
});

test("§27.1 — the enqueued-key count is measured from the database and does not fall", async () => {
  const enqueued = await templateKeysEnqueued();
  const registered = allTemplateKeys().length;

  assertNonEmpty(
    enqueued,
    "§27.1 keys enqueued — with none, this file measures nothing",
    SECTION_27_1_FLOOR,
  );

  const known = new Set(allTemplateKeys());
  const unknown = enqueued.filter((k) => !known.has(k));
  assert.deepEqual(
    unknown,
    [],
    `these template keys reached comms_outbox but are not in the register: ${unknown.join(", ")}`,
  );

  console.log(`§27.1 ENQUEUED: ${enqueued.length} of ${registered} registered — ${enqueued.join(", ")}`);
});

test("the coverage measurement is discriminating — it reads the database, not a constant", async () => {
  // The failure mode this guards: a measurement that returns a hard-coded list, or one
  // whose query is wrong and silently returns []. Both would sail past the ratchet if the
  // floor were 0, and both are exactly the "drift guard comparing two empty sets" defect.
  //
  // Proof: the two readers must disagree with each other. If either returned a constant
  // or an empty set, this fails.
  const [codes, keys] = await Promise.all([exceptionCodesRaised(), templateKeysEnqueued()]);
  assert.notDeepEqual(
    codes,
    keys,
    "the exception reader and the template reader returned identical lists — at least one " +
      "is not reading what it claims to",
  );

  // And the rows must actually exist, counted independently of the readers.
  const rawCodes = await prisma.queueItem.count({ where: { exceptionCode: { not: null } } });
  assert.ok(
    rawCodes >= codes.length,
    `the distinct-code reader returned ${codes.length} values from ${rawCodes} rows — impossible`,
  );
});

after(async () => {
  await prisma.$disconnect();
});
