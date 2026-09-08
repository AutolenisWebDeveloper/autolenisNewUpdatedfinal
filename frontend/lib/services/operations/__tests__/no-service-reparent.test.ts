// BUILD-FAILING RULE — no service writes a parent id onto an existing row.
//
// §3: a record "is never silently re-parented or duplicated into a parallel
// transaction". The forward guard (`assertParentResolvable`) stops a child being
// CREATED under a parent that does not resolve; this stops an existing child's
// parent being CHANGED anywhere except the one audited admin action.
//
// Today the tree is clean — every `.update`/`.updateMany`/`.upsert` on the six
// classes was read and none sets a parent id. So this rule is a RATCHET, not a
// cleanup: it holds the line at zero rather than counting down from a backlog. A
// ratchet that scans nothing would pass forever, which is why `assertScanned`
// enforces a floor.
//
// Run: pnpm test:operations

import test from "node:test";
import assert from "node:assert/strict";
import { sourceFiles, read, lineAt, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();
const ROOTS = ["lib", "app", "components", "scripts"] as const;

/**
 * The single audited escape hatch. §3 forbids a SILENT re-parent; a named admin,
 * with a reason, an awaited audit row carrying the previous and new values, and a
 * resolved exception is the opposite of silent.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; reason: string; removedInPhase: number | null }> = [
  {
    file: "app/api/admin/lineage/reparent/route.ts",
    reason: "THE audited re-parent admin action named by §8.2 Phase 2 Part A and control/L3-01.",
    removedInPhase: null,
  },
];

/** The six classes §3 names, and the parent fields each carries. */
const CLASSES: Readonly<Record<string, readonly string[]>> = {
  deposit: ["vehicleRequestId"],
  auction: ["vehicleRequestId", "sourcingCaseId"],
  offer: ["auctionId", "auctionVehicleId"],
  deal: ["offerId", "vehicleRequestOfferId", "auctionId", "depositId", "vehicleRequestId"],
  contractVersion: ["dealId"],
  pickup: ["dealId"],
};


/**
 * The matcher, in ONE place.
 *
 * It used to be written out twice — once in the rule, once in the
 * "proves it can fail" test — so a drift in the rule's copy left the proof
 * passing against its own private version. It also matched only `field:`, which
 * is blind to ES6 shorthand: `data: { offerId }` is exactly the write the rule
 * exists to stop and it sailed through.
 *
 * Returns one entry per parent-id write found in the `data:` (update/updateMany)
 * or `update:` (upsert) object of a Prisma call. An upsert's `create:` block is
 * NOT a re-parent — it gives a new row its parent, which §3 requires.
 */
export function findReparentWrites(
  src: string,
  classes: Record<string, readonly string[]>,
): Array<{ model: string; field: string; index: number }> {
  const found: Array<{ model: string; field: string; index: number }> = [];
  for (const [model, fields] of Object.entries(classes)) {
    // [\s\S] rather than the `s` flag — the repo's target predates es2018.
    const call = new RegExp(`\\.${model}\\.(?:update|updateMany|upsert)\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, "g");
    for (const m of src.matchAll(call)) {
      const blob = m[1] ?? "";
      // Only `data:` (update/updateMany) and `update:` (the update BRANCH of an
      // upsert) count. A `where:` clause naming the field is a read predicate. An
      // upsert's `create:` block is not a re-parent either — it establishes the
      // lineage of a NEW row, which is exactly what §3 asks for; three pickup
      // upserts do precisely that and are correct.
      const writeBlocks = blob.match(/\b(?:data|update)\s*:\s*\{[\s\S]*?\}/g) ?? [];
      for (const block of writeBlocks) {
        for (const field of fields) {
          // The field must be in KEY position: preceded by `{` or `,`. That
          // covers `offerId: x` and the ES6 shorthand `{ offerId }` alike, and
          // excludes `note: offerId`, which READS the value rather than writing
          // the field.
          const written = new RegExp(`[{,]\\s*${field}\\s*(?::|,|\\}|$)`, "m");
          if (written.test(block)) found.push({ model, field, index: m.index ?? 0 });
        }
      }
    }
  }
  return found;
}

test("no service writes a parent id onto an existing row of a §3 record class", () => {
  const files = sourceFiles(ROOT, [...ROOTS]);
  assertScanned(files, 800, "no-service-reparent");

  const allowed = new Set(ALLOWLIST.map((a) => a.file));
  const offenders: string[] = [];

  for (const file of files) {
    if (allowed.has(file)) continue;
    const src = read(ROOT, file);
    for (const hit of findReparentWrites(src, CLASSES)) {
      offenders.push(`${file}:${lineAt(src, hit.index)} (${hit.model}.${hit.field})`);
    }
  }

  assert.deepEqual(
    [...new Set(offenders)],
    [],
    "A parent id may only be written onto an existing row by the audited admin action " +
      "(app/api/admin/lineage/reparent/route.ts). §3: a record is never silently re-parented. " +
      `Offenders: ${[...new Set(offenders)].join(", ")}`
  );
});

test("every allowlisted file exists and still re-parents — a stale entry fails", () => {
  const files = new Set(sourceFiles(ROOT, [...ROOTS]));
  for (const entry of ALLOWLIST) {
    assert.ok(files.has(entry.file), `Allowlisted file no longer exists: ${entry.file}. Remove the entry.`);
    const src = read(ROOT, entry.file);
    assert.ok(
      /\.update\s*\(/.test(src),
      `Allowlisted file ${entry.file} no longer performs an update. A stale allowlist entry silently widens the rule.`
    );
  }
});

test("the escape hatch audits the change and records both values", () => {
  const src = read(ROOT, "app/api/admin/lineage/reparent/route.ts");
  // Awaited, not best-effort: a re-parent that is not recorded is the silent
  // re-parent §3 forbids.
  assert.match(src, /await createAuditLog\(/, "the audit row must be awaited, never best-effort");
  assert.ok(!/createAuditLog[\s\S]{0,200}\.catch\(/.test(src), "the audit row must not be swallowed");
  assert.match(src, /previousState:/, "the previous parent must be recorded");
  assert.match(src, /newState:/, "the new parent must be recorded");
  assert.match(src, /reason: z\.string\(\)\.min\(1/, "a reason must be mandatory");
  assert.match(src, /OPERATIONS_ADMIN/, "the route must be role-gated");
});

test("the guard detects a real violation — proved against planted samples", () => {
  // The guard is only trustworthy if it can fail, and the proof has to run THE
  // matcher, not a copy of it.
  const CLASSES_UNDER_TEST = { auction: ["vehicleRequestId"] as const, deal: ["offerId"] as const };

  const planted = `await prisma.auction.update({ where: { id }, data: { vehicleRequestId: vr.id } });`;
  assert.equal(findReparentWrites(planted, CLASSES_UNDER_TEST).length, 1, "an explicit parent-id write must be caught");

  // ES6 shorthand. This is the form that slipped through: `data: { offerId }`.
  const shorthand = `await prisma.deal.update({ where: { id }, data: { offerId } });`;
  assert.equal(findReparentWrites(shorthand, CLASSES_UNDER_TEST).length, 1, "shorthand is the same write and must be caught");

  // A where-clause READ of the same field is not a write.
  const innocent = `await prisma.auction.updateMany({ where: { vehicleRequestId: vr.id }, data: { status: "CLOSED" } });`;
  assert.equal(findReparentWrites(innocent, CLASSES_UNDER_TEST).length, 0, "a where-clause read must not trip the rule");

  // Nor is READING the value into another field.
  const readsValue = `await prisma.deal.update({ where: { id }, data: { note: offerId } });`;
  assert.equal(findReparentWrites(readsValue, CLASSES_UNDER_TEST).length, 0, "using the value must not trip the rule");
});
