// O3 — onboarding status transitions must be guarded and transactional.
//
// Before this fix any step POST silently reset a SUBMITTED/APPROVED review to
// IN_PROGRESS, and re-POSTing submit flipped APPROVED back to SUBMITTED — an
// affiliate could erase an admin decision at will. Now:
//   • step writes are allowed only in NOT_STARTED / IN_PROGRESS /
//     NEEDS_CORRECTION (a NEEDS_CORRECTION status is preserved so the
//     correction banner and items survive edits);
//   • SUBMITTED is reachable only from IN_PROGRESS / NEEDS_CORRECTION;
//   • anything else throws OnboardingLockedError (routes map it to 409),
//     inside the same transaction as the write.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/affiliate/__tests__/onboarding-transitions.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

interface Ctrl {
  review: { affiliateId: string; status: string; currentStep: number } | null;
  writes: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

const txClient = {
  affiliateOnboardingReview: {
    findUnique: async () => ctrl.review,
    upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const applied = ctrl.review ? { ...ctrl.review, ...update } : { ...create };
      ctrl.review = applied as Ctrl["review"];
      ctrl.writes.push(applied);
      return applied;
    },
  },
};
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      ...txClient,
      $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient),
    },
  },
});

beforeEach(() => {
  ctrl = { review: null, writes: [] };
});

async function svc() {
  return import("@/lib/services/affiliate/onboarding.service");
}

test("step write from NOT_STARTED (no row) → IN_PROGRESS", async () => {
  const { saveOnboardingStep } = await svc();
  await saveOnboardingStep("aff_1", 2);
  assert.equal(ctrl.review!.status, "IN_PROGRESS");
  assert.equal(ctrl.review!.currentStep, 2);
});

test("step write in NEEDS_CORRECTION keeps NEEDS_CORRECTION (banner/items survive edits)", async () => {
  const { saveOnboardingStep } = await svc();
  ctrl.review = { affiliateId: "aff_1", status: "NEEDS_CORRECTION", currentStep: 3 };
  await saveOnboardingStep("aff_1", 4);
  assert.equal(ctrl.review.status, "NEEDS_CORRECTION");
  assert.equal(ctrl.review.currentStep, 4);
});

for (const locked of ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"]) {
  test(`step write in ${locked} → OnboardingLockedError, nothing written`, async () => {
    const { saveOnboardingStep, OnboardingLockedError } = await svc();
    ctrl.review = { affiliateId: "aff_1", status: locked, currentStep: 7 };
    await assert.rejects(saveOnboardingStep("aff_1", 2), (e: unknown) => e instanceof OnboardingLockedError);
    assert.equal(ctrl.writes.length, 0, "a locked review must not be touched");
    assert.equal(ctrl.review.status, locked);
  });
}

test("submit from IN_PROGRESS → SUBMITTED with submittedAt", async () => {
  const { saveOnboardingStep } = await svc();
  ctrl.review = { affiliateId: "aff_1", status: "IN_PROGRESS", currentStep: 6 };
  await saveOnboardingStep("aff_1", 7, "SUBMITTED");
  assert.equal(ctrl.review.status, "SUBMITTED");
  assert.ok((ctrl.writes[0] as { submittedAt?: Date }).submittedAt instanceof Date);
});

test("submit from NEEDS_CORRECTION → SUBMITTED (resubmission after corrections)", async () => {
  const { saveOnboardingStep } = await svc();
  ctrl.review = { affiliateId: "aff_1", status: "NEEDS_CORRECTION", currentStep: 7 };
  await saveOnboardingStep("aff_1", 7, "SUBMITTED");
  assert.equal(ctrl.review.status, "SUBMITTED");
});

test("re-submit on APPROVED → OnboardingLockedError (cannot erase an admin decision)", async () => {
  const { saveOnboardingStep, OnboardingLockedError } = await svc();
  ctrl.review = { affiliateId: "aff_1", status: "APPROVED", currentStep: 7 };
  await assert.rejects(
    saveOnboardingStep("aff_1", 7, "SUBMITTED"),
    (e: unknown) => e instanceof OnboardingLockedError,
  );
  assert.equal(ctrl.review.status, "APPROVED");
});
