// §25.1 / golden rule 3 — a BUILD-FAILING guard that every dealer-facing read and every
// destructive dealer action resolves ownership, and resolves it the SAME way.
//
// Run with:  npx tsx --test lib/services/deal/__tests__/dealer-ownership-guards.test.ts
//
// TWO DEFECTS, FOUND BY RE-AUDITING A BATCH THAT HAD ALREADY BEEN REVIEWED TWICE.
//
//  1. `releaseVehicleHold` took `actorId` and went straight to `returnToRemainingOffers` with NO
//     ownership check on any line of the path — including the route, which authenticated the
//     dealer and passed `dealId` through unverified. Any authenticated dealership could POST
//     another dealership's deal id and destroy that deal: CANCELLED, firewall revoked, buyer
//     emailed, and a dealer-fault SLA violation filed against the victim's rooftop. The EXTEND
//     branch of the SAME route was guarded. The cheap action was protected and the irreversible
//     one was open.
//
//  2. The dealer PAGE readers resolved ownership as `offer: { dealerId }` while every dealer ROUTE
//     resolved it as `OR: [{ offer: { dealerId } }, { dealerId }]`. §13-D20 keeps
//     `Offer.dealerId` on the outside-dealer placeholder and puts the claimed dealership on
//     `Deal.dealerId`, so an outside winner was accepted by the API and 404'd by the page their
//     own recap email linked to.
//
// Both are properties of the SOURCE — one is an absent check, the other a divergence between two
// files — so they are asserted in the source. A behaviour test proves today's paths; this proves
// the next one, because the build fails without it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceFiles, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(`${ROOT}/${f}`, "utf8");

/** The canonical ownership test: EITHER id is ownership. */
const DUAL_KEYED = /OR:\s*\[\s*\{\s*offer:\s*\{\s*dealerId[^}]*\}\s*\}\s*,\s*\{\s*dealerId[^}]*\}\s*\]/;

test("every dealer-facing deal reader resolves ownership on BOTH ids", () => {
  // `Offer.dealerId` is the immutable attribution; `Deal.dealerId` is §13-D20's lineage field.
  // A reader that consults only the first cannot see an outside winner's own deal.
  const offenders: string[] = [];
  for (const file of [
    "lib/services/dealer/dealer-deals.service.ts",
    "app/api/dealer/deals/[dealId]/recap/route.ts",
    "app/api/dealer/deals/[dealId]/reaffirm/route.ts",
  ]) {
    const src = read(file);
    // Every `prisma.deal.find*` in a dealer-facing reader must be dual-keyed.
    const reads = (src.match(/prisma\.deal\.find(First|Unique|Many)/g) ?? []).length;
    const dual = (src.match(new RegExp(DUAL_KEYED.source, "g")) ?? []).length;
    if (reads > dual) offenders.push(`${file} (${reads} deal reads, ${dual} dual-keyed)`);
  }
  assert.deepEqual(
    offenders,
    [],
    "§13-D20 splits attribution from lineage, so ownership is `Offer.dealerId` OR `Deal.dealerId`. " +
      `A reader consulting one of them 404s an outside winner on their own deal. ${offenders.join(", ")}`,
  );
});

test("the destructive hold action verifies ownership before it stands a deal down", () => {
  const src = read("lib/services/deal/dealer-reaffirmation.service.ts");
  const body = src.slice(src.indexOf("export async function releaseVehicleHold"));
  const fn = body.slice(0, body.indexOf("\n}\n") + 2);

  assert.match(
    fn,
    /dealerId:\s*string/,
    "releaseVehicleHold must take the authenticated dealership — not just an actorId — or it " +
      "cannot check anything. It took only `actorId`, and any dealer could destroy any deal.",
  );
  assert.match(
    fn,
    /belongs to another dealership/,
    "releaseVehicleHold must refuse a deal that is not the caller's, the same way extendVehicleHold does.",
  );
  // The check has to come BEFORE the stand-down, not after it.
  assert.ok(
    fn.indexOf("belongs to another dealership") < fn.indexOf("returnToRemainingOffers"),
    "the ownership check must precede returnToRemainingOffers — a check after the deal is cancelled is not a check",
  );
});

test("the hold route passes the authenticated dealership to BOTH branches", () => {
  const src = read("app/api/dealer/deals/[dealId]/hold/route.ts");
  assert.match(src, /extendVehicleHold\(\{[\s\S]*?dealerId:\s*dealer\.id/, "EXTEND must carry the dealer id");
  assert.match(src, /releaseVehicleHold\(\{[\s\S]*?dealerId:\s*dealer\.id/, "RELEASE must carry the dealer id");
});

test("no dealer route reaches a destructive deal action without an ownership check", () => {
  // The class-level form: any dealer route that cancels or stands down a deal must either resolve
  // ownership itself or call a service that takes `dealerId`.
  const DESTRUCTIVE = /releaseVehicleHold|returnToRemainingOffers|advanceDealStatus\([^)]*CANCELLED/;
  const files = sourceFiles(ROOT, ["app/api/dealer"]);
  assertScanned(files, 20, "dealer-ownership-guards");
  const offenders: string[] = [];
  for (const file of files) {
    const src = read(file);
    if (!DESTRUCTIVE.test(src)) continue;
    if (/dealerId:\s*dealer\.id/.test(src) || DUAL_KEYED.test(src)) continue;
    offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    `A dealer route that can destroy a deal must prove the deal is theirs. Offenders: ${offenders.join(", ")}`,
  );
});

test("a dealership that could not act is not recorded as having failed to act", () => {
  // §10b refuses every outside winner whose claim sequence is incomplete, so the 24-hour sweep
  // would time them out as DEALER_TIMED_OUT — a real SLA mark on a real business for a window the
  // platform closed to them. The attribution is gated on that, and it fails TOWARD the dealership.
  const src = read("lib/services/deal/return-to-offers.service.ts");
  assert.match(src, /dealershipWasBlocked/, "the blocked check must exist");
  assert.match(
    src,
    /if\s*\(!blocked\s*&&\s*DEALER_FAULT\.includes\(params\.cause\)\)/,
    "the SLA/scorecard attribution must be gated on the dealership having been ABLE to act",
  );
  // Fail-toward-the-dealership: an unevaluable gate must not silently attribute fault.
  const fn = src.slice(src.indexOf("async function dealershipWasBlocked"));
  assert.match(
    fn.slice(0, fn.indexOf("\n}\n")),
    /could not confirm whether this dealership was able to act/,
    "if the gate cannot be evaluated the stand-down must not be attributed to the dealership",
  );
});

test("a buyer-side refusal does not burn the dealership's window", () => {
  // APPROVAL_NOT_CURRENT refuses the DEALERSHIP because the BUYER's approval lapsed. Leaving the
  // 24-hour clock running would hand them a timeout for a condition only Operations can clear.
  const src = read("lib/services/deal/dealer-reaffirmation.service.ts");
  const at = src.indexOf("APPROVAL_NOT_CURRENT");
  assert.ok(at > 0, "the refusal must exist");
  const before = src.slice(Math.max(0, at - 1600), at);
  assert.match(before, /dueAt:\s*new Date\(now\.getTime\(\) \+ REAFFIRMATION_WINDOW_HOURS/,
    "the confirmation window must be extended before the refusal is thrown");
});
