// F-011 — dealer application auto-approval eligibility rule.
// Run with:  npx tsx --test lib/services/dealer-recruitment/__tests__/auto-approval.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDealerApplicationAutoApproval,
  autoApprovalAnnotation,
} from "../auto-approval";

const valid = {
  dealershipName: "Premier Auto Group",
  licenseNumber: "DLR-12345",
  state: "TX",
  zip: "75001",
};

test("objective-valid application is eligible for fast approval", () => {
  const r = evaluateDealerApplicationAutoApproval(valid);
  assert.equal(r.eligible, true);
});

test("eligible but NOT auto-approvable without a Maps-verified placeId (F-010 coupling)", () => {
  const r = evaluateDealerApplicationAutoApproval(valid);
  assert.equal(r.autoApprovable, false);
});

test("eligible AND auto-approvable once Maps-verified", () => {
  const r = evaluateDealerApplicationAutoApproval({ ...valid, verifiedPlaceId: true });
  assert.equal(r.eligible, true);
  assert.equal(r.autoApprovable, true);
});

test("invalid license / state / zip are not eligible and report reasons", () => {
  assert.equal(evaluateDealerApplicationAutoApproval({ ...valid, licenseNumber: "x" }).eligible, false);
  assert.equal(evaluateDealerApplicationAutoApproval({ ...valid, state: "Texas" }).eligible, false);
  assert.equal(evaluateDealerApplicationAutoApproval({ ...valid, zip: "750" }).eligible, false);
  const r = evaluateDealerApplicationAutoApproval({ ...valid, licenseNumber: "" });
  assert.ok(r.reasons.some((x) => x.includes("license")));
});

test("a Maps-verified application with a bad license is still NOT auto-approvable", () => {
  const r = evaluateDealerApplicationAutoApproval({ ...valid, licenseNumber: "!", verifiedPlaceId: true });
  assert.equal(r.eligible, false);
  assert.equal(r.autoApprovable, false);
});

test("annotation reflects the decision tier", () => {
  assert.match(autoApprovalAnnotation(evaluateDealerApplicationAutoApproval(valid)), /FAST-APPROVE ELIGIBLE/);
  assert.match(
    autoApprovalAnnotation(evaluateDealerApplicationAutoApproval({ ...valid, verifiedPlaceId: true })),
    /AUTO-APPROVABLE/,
  );
  assert.match(
    autoApprovalAnnotation(evaluateDealerApplicationAutoApproval({ ...valid, licenseNumber: "" })),
    /NEEDS REVIEW/,
  );
});
