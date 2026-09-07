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

test("no service writes a parent id onto an existing row of a §3 record class", () => {
  const files = sourceFiles(ROOT, [...ROOTS]);
  assertScanned(files, 800, "no-service-reparent");

  const allowed = new Set(ALLOWLIST.map((a) => a.file));
  const offenders: string[] = [];

  for (const file of files) {
    if (allowed.has(file)) continue;
    const src = read(ROOT, file);
    for (const [model, fields] of Object.entries(CLASSES)) {
      // `prisma.<model>.update(...)`, `tx.<model>.updateMany(...)`, `.upsert(...)`.
      // [\s\S] rather than the `s` flag — the repo's target predates es2018.
      const call = new RegExp(`\\.${model}\\.(?:update|updateMany|upsert)\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, "g");
      for (const m of src.matchAll(call)) {
        const blob = m[1] ?? "";
        // Only a `data:` / `update:` object counts. A `where:` clause naming the
        // same field is a read predicate, not a write.
        const writeBlocks = blob.match(/\b(?:data|update|create)\s*:\s*\{[\s\S]*?\}/g) ?? [];
        for (const block of writeBlocks) {
          for (const field of fields) {
            if (new RegExp(`\\b${field}\\s*:`).test(block)) {
              offenders.push(`${file}:${lineAt(src, m.index ?? 0)} (${model}.${field})`);
            }
          }
        }
      }
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

test("the guard detects a real violation — proved against a planted sample", () => {
  // The guard is only trustworthy if it can fail. This exercises the same matcher
  // the test above uses, against source text that violates the rule.
  const planted = `await prisma.auction.update({ where: { id }, data: { vehicleRequestId: vr.id } });`;
  const call = new RegExp(`\\.auction\\.(?:update|updateMany|upsert)\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, "g");
  const matches = [...planted.matchAll(call)];
  assert.equal(matches.length, 1, "the matcher must see the call");
  const writeBlocks = (matches[0]![1] ?? "").match(/\b(?:data|update|create)\s*:\s*\{[\s\S]*?\}/g) ?? [];
  assert.ok(writeBlocks.some((b) => /\bvehicleRequestId\s*:/.test(b)), "the matcher must see the parent-id write");

  // And it must NOT fire on a where-clause read of the same field.
  const innocent = `await prisma.auction.updateMany({ where: { vehicleRequestId: vr.id }, data: { status: "CLOSED" } });`;
  const m2 = [...innocent.matchAll(new RegExp(call.source, "g"))];
  const blocks2 = (m2[0]?.[1] ?? "").match(/\b(?:data|update|create)\s*:\s*\{[\s\S]*?\}/g) ?? [];
  assert.ok(!blocks2.some((b) => /\bvehicleRequestId\s*:/.test(b)), "a where-clause read must not trip the rule");
});
