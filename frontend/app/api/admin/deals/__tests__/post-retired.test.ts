// §8.2 Phase 6 defect (3) — `POST /api/admin/deals` IS RETIRED.
//
// §9: "No system, algorithm, or administrator selects on the buyer's behalf." The route took
// `buyerId` and `offerId` from the request body, minted a Deal and marked the offer ACCEPTED —
// an administrator selecting the winner, which is the thing §9 names.
//
// It also bypassed every guard the buyer path has: no `SELECT … FOR UPDATE` on the auction (so two
// concurrent calls could each mint a Deal), no approval recheck, no auction-status check, and no
// lineage beyond buyer and offer.
//
// A test that asserts an EXPORT IS ABSENT is unusual, and it is the point: nothing else can catch
// this. A future edit restoring the handler — or a refactor that reintroduces it while moving code
// around — compiles, lints and passes every other suite. §8.2's rollback paragraph says reverting
// this phase restores the route, so the deletion has to be the kind of thing that is done
// deliberately rather than drifted back into.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/admin/deals/__tests__/post-retired.test.ts

import test from "node:test";
import assert from "node:assert/strict";

test("the admin deals route exports no POST — administrators cannot select a winner", async () => {
  const mod = (await import("../route")) as Record<string, unknown>;
  assert.equal(
    typeof mod.POST,
    "undefined",
    "POST /api/admin/deals is back. §9 forbids an administrator selecting on the buyer's behalf; " +
      "selection exists only on the buyer routes.",
  );
});

test("GET survives — retiring selection did not remove the admin deals list", async () => {
  // The capability-preservation invariant: REMOVED needs owner sign-off and applies to the
  // selection capability only. The list view is a different capability on the same file and was
  // never in scope.
  const mod = (await import("../route")) as Record<string, unknown>;
  assert.equal(typeof mod.GET, "function", "the admin deals list was removed along with POST");
});

test("no other HTTP verb was introduced in its place", async () => {
  const mod = (await import("../route")) as Record<string, unknown>;
  for (const verb of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    assert.equal(typeof mod[verb], "undefined", `${verb} appeared on the admin deals collection route`);
  }
});
