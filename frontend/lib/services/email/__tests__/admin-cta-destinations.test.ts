// The admin CTA in an outbound email is a navigation entry point into the
// console — and for /admin/vehicle-requests/[id] it is the ONLY one.
//
// Regression: the new-vehicle-request admin alert passed a Notification id.
// That page resolves BOTH id spaces — a VehicleRequest id redirects to the
// canonical command view at /admin/requests/[id], a Notification id renders the
// legacy read-only view — so the link "worked" while silently landing the
// operator on the surface that CANNOT action the request. A dead link fails
// loudly; this one never did.
//
// The sibling defect of the same shape (the founder hot-lead alert linking to
// /admin/opportunities/{id}, a page that never existed) is covered in
// lib/services/acquisition/__tests__/intake-pipeline.test.ts.
//
// Run with:
//   npx tsx --test lib/services/email/__tests__/admin-cta-destinations.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminVehicleRequestPath } from "@/lib/services/email/vehicle-offers.email";

test("prefers the VehicleRequest id so the CTA opens the canonical command view", () => {
  assert.equal(
    adminVehicleRequestPath({ notificationId: "notif_1", vehicleRequestId: "vr_1" }),
    "/admin/vehicle-requests/vr_1",
    "with both ids available the CTA must carry the VehicleRequest id — the " +
      "Notification id renders the legacy read-only view instead of the command " +
      "view that can send to dealers, create an offer, or change status",
  );
});

test("falls back to the Notification id when no VehicleRequest exists", () => {
  assert.equal(
    adminVehicleRequestPath({ notificationId: "notif_1" }),
    "/admin/vehicle-requests/notif_1",
    "a Notification-only request (no VehicleRequest created) must still resolve",
  );
});

test("falls back to the list when neither id is available", () => {
  assert.equal(adminVehicleRequestPath({}), "/admin/vehicle-requests");
});

test("always targets the admin console", () => {
  for (const ids of [
    { vehicleRequestId: "vr_9" },
    { notificationId: "notif_9" },
    {},
  ]) {
    assert.ok(
      adminVehicleRequestPath(ids).startsWith("/admin/vehicle-requests"),
      `not an admin path for ${JSON.stringify(ids)}`,
    );
  }
});

test("the rendered email carries the resolved path, not a raw id", () => {
  // Guards the wiring between the helper and the template: the helper being
  // right is worthless if the sender stops calling it.
  const src = readFileSync(
    join(process.cwd(), "lib/services/email/vehicle-offers.email.ts"),
    "utf8",
  );
  assert.match(
    src,
    /const detailUrl = `\$\{APP_URL\}\$\{adminVehicleRequestPath\(params\)\}`/,
    "the admin alert must build its CTA through adminVehicleRequestPath",
  );
});
