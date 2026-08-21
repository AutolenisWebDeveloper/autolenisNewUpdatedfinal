// UI-13: one source of truth for status labels. Guards that every enum value has
// a label (no raw UPPER_SNAKE leaks), buyer vs internal wording is intentional,
// and deal tone is consistent.

import test from "node:test";
import assert from "node:assert/strict";
import { VehicleRequestStatus, DealStatus } from "@prisma/client";
import {
  vehicleRequestStatusLabel,
  VEHICLE_REQUEST_STATUS_TONE,
  dealStatusLabel,
  dealStatusTone,
} from "@/lib/domain/status-labels";

test("every VehicleRequestStatus has an internal + buyer label + tone (no raw enum leak)", () => {
  for (const s of Object.values(VehicleRequestStatus)) {
    const internal = vehicleRequestStatusLabel(s, "internal");
    const buyer = vehicleRequestStatusLabel(s, "buyer");
    assert.ok(internal && internal !== s, `internal label missing for ${s}`);
    assert.ok(buyer && buyer !== s, `buyer label missing for ${s}`);
    assert.ok(VEHICLE_REQUEST_STATUS_TONE[s], `tone missing for ${s}`);
  }
});

test("ACTIVE_SOURCING never renders as the raw enum on an internal surface", () => {
  assert.equal(vehicleRequestStatusLabel(VehicleRequestStatus.ACTIVE_SOURCING, "internal"), "Sourcing");
});

test("buyer wording is softer than internal for OFFER_READY", () => {
  assert.equal(vehicleRequestStatusLabel(VehicleRequestStatus.OFFER_READY, "buyer"), "Offer Pending");
  assert.equal(vehicleRequestStatusLabel(VehicleRequestStatus.OFFER_READY, "internal"), "Offer Ready");
});

test("every DealStatus has a friendly label (no shouty UPPER_SNAKE)", () => {
  for (const s of Object.values(DealStatus)) {
    const label = dealStatusLabel(s);
    assert.ok(label && !/[A-Z]_[A-Z]/.test(label), `bad deal label for ${s}: ${label}`);
  }
});

test("deal tone: completed=success, cancelled/refunded=danger, else progress", () => {
  assert.equal(dealStatusTone(DealStatus.COMPLETED), "success");
  assert.equal(dealStatusTone(DealStatus.CANCELLED), "danger");
  assert.equal(dealStatusTone(DealStatus.REFUNDED), "danger");
  assert.equal(dealStatusTone(DealStatus.FINANCING_PENDING), "progress");
});
