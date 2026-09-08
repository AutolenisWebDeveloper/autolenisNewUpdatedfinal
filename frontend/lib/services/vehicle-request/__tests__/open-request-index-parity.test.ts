// The service's idea of "open" must equal the DATABASE's, character for character.
//
// `OPEN_REQUEST_STATUSES` decides whether a submission attaches or creates;
// `vehicle_requests_one_open_per_buyer_key` decides whether the insert succeeds.
// If they ever disagree the service loses: it creates confidently, the index
// rejects, and the buyer gets a raw 23505 — the exact failure §8.1a.1 predicted
// ("a buyer who declines and resubmits gets a raw 23505 until a service-side guard
// and a buyer-facing path land").
//
// So this parses the migration's predicate and compares it to the constant. A
// future edit to either one fails here rather than in production.
//
// Owner Ruling 1 (§8.1a.1) put OFFER_DECLINED in the set — it has an explicit exit
// (REOPEN_SOURCING) so no buyer is stranded, and a request there still holds offers
// that may be revalidated, so a second request would spend a second $99 on work the
// first may still deliver. DRAFT is in it too, which is the interaction §6.4's
// recovery sequence turns on: a buyer with an abandoned draft gets their draft
// back, not a second request.
//
// Run: pnpm test:vehicle-request

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OPEN_REQUEST_STATUSES } from "../open-request.service";

const MIGRATION = "prisma/migrations/20261106000100_transaction_spine_foundation/migration.sql";

/** The status list inside the index's WHERE ... IN ( ... ) predicate. */
function predicateStatuses(): string[] {
  const sql = readFileSync(`${process.cwd()}/${MIGRATION}`, "utf8");
  const idx = sql.indexOf("vehicle_requests_one_open_per_buyer_key");
  assert.notEqual(idx, -1, "the one-open-per-buyer index is not in the migration");
  const tail = sql.slice(idx, idx + 800);
  const m = tail.match(/WHERE\s+"status"\s+IN\s*\(([\s\S]*?)\)/);
  assert.ok(m, "could not parse the index predicate");
  return [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!);
}

test("the service's open-status set equals the partial unique index's predicate", () => {
  const fromSql = predicateStatuses();
  assert.equal(fromSql.length, 10, "the predicate should carry exactly ten statuses");
  assert.deepEqual(
    [...OPEN_REQUEST_STATUSES].sort(),
    [...fromSql].sort(),
    "OPEN_REQUEST_STATUSES and vehicle_requests_one_open_per_buyer_key must agree. " +
      "If they diverge the service creates a request the index rejects, and the buyer sees a raw 23505."
  );
});

test("OFFER_DECLINED and DRAFT are both in the set — owner Ruling 1", () => {
  assert.ok(OPEN_REQUEST_STATUSES.includes("OFFER_DECLINED"));
  assert.ok(OPEN_REQUEST_STATUSES.includes("DRAFT"));
});

test("terminal statuses are NOT in the set — a closed request must not block a new one", () => {
  for (const terminal of ["CANCELLED", "EXPIRED", "CLOSED_NO_MATCH", "DEAL_CREATED"] as const) {
    assert.ok(
      !OPEN_REQUEST_STATUSES.includes(terminal),
      `${terminal} must not count as open — a buyer whose request reached it must be able to start a new one`
    );
  }
});
