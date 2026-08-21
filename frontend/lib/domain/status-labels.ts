// Single source of truth for human-facing status labels + badge tones.
//
// Phase 1 UI-13: VehicleRequestStatus and DealStatus were rendered three or four
// different ways across dashboards — buyer/admin label maps that disagreed, raw
// UPPER_SNAKE enum values leaked to admins (e.g. "ACTIVE_SOURCING"), and shouty
// `.replace(/_/g," ")` labels. Centralizing them here keeps role wording
// intentional (buyer copy is softer than internal copy) but from ONE place, and
// removes the raw-enum leaks.

import type { VehicleRequestStatus, DealStatus } from "@prisma/client";

// ── VehicleRequestStatus ─────────────────────────────────────────────────────

/** Internal / admin-facing labels. */
export const VEHICLE_REQUEST_STATUS_LABEL: Record<VehicleRequestStatus, string> = {
  SUBMITTED: "New",
  INTAKE: "In Review",
  ACTIVE_SOURCING: "Sourcing",
  OFFER_READY: "Offer Ready",
  OFFER_SENT: "Offer Sent",
  OFFER_ACCEPTED: "Offer Accepted",
  OFFER_DECLINED: "Offer Declined",
  DEAL_CREATED: "Deal Created",
  CLOSED_NO_MATCH: "Closed — No Match",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

/** Buyer-facing labels — softer, never expose internal-only states. */
export const VEHICLE_REQUEST_STATUS_BUYER_LABEL: Record<VehicleRequestStatus, string> = {
  SUBMITTED: "Submitted",
  INTAKE: "Under Review",
  ACTIVE_SOURCING: "Sourcing Vehicles",
  OFFER_READY: "Offer Pending",
  OFFER_SENT: "Offer Sent",
  OFFER_ACCEPTED: "Offer Accepted",
  OFFER_DECLINED: "Offer Declined",
  DEAL_CREATED: "Deal Created",
  CLOSED_NO_MATCH: "Closed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

/** Tailwind badge tone classes for VehicleRequestStatus (internal surfaces). */
export const VEHICLE_REQUEST_STATUS_TONE: Record<VehicleRequestStatus, string> = {
  SUBMITTED: "bg-blue-100 text-blue-700 border-blue-200",
  INTAKE: "bg-amber-100 text-amber-700 border-amber-200",
  ACTIVE_SOURCING: "bg-violet-100 text-violet-700 border-violet-200",
  OFFER_READY: "bg-cyan-100 text-cyan-700 border-cyan-200",
  OFFER_SENT: "bg-cyan-100 text-cyan-700 border-cyan-200",
  OFFER_ACCEPTED: "bg-green-100 text-green-700 border-green-200",
  OFFER_DECLINED: "bg-red-100 text-red-700 border-red-200",
  DEAL_CREATED: "bg-green-100 text-green-700 border-green-200",
  CLOSED_NO_MATCH: "bg-slate-100 text-slate-600 border-slate-200",
  CANCELLED: "bg-slate-100 text-slate-600 border-slate-200",
  EXPIRED: "bg-slate-100 text-slate-600 border-slate-200",
};

export function vehicleRequestStatusLabel(
  status: VehicleRequestStatus,
  audience: "internal" | "buyer" = "internal",
): string {
  const map = audience === "buyer" ? VEHICLE_REQUEST_STATUS_BUYER_LABEL : VEHICLE_REQUEST_STATUS_LABEL;
  return map[status] ?? String(status);
}

// ── DealStatus ───────────────────────────────────────────────────────────────

/** Friendly labels for DealStatus (shared by buyer + admin). */
export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  FINANCING_PENDING: "Financing",
  FEE_PENDING: "Service Fee Due",
  FEE_PAID: "Service Fee Paid",
  INSURANCE_PENDING: "Insurance",
  CONTRACT_PENDING: "Contract Review",
  CONTRACT_REVIEW: "Contract Review",
  CONTRACT_APPROVED: "Contract Approved",
  SIGNING_PENDING: "Awaiting Signature",
  SIGNED: "Signed",
  PICKUP_SCHEDULED: "Pickup Scheduled",
  PICKUP_COMPLETE: "Picked Up",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** Coarse tone key for a DealStatus, so buyer + admin badges agree. */
export type StatusToneKey = "success" | "danger" | "progress" | "neutral";

export function dealStatusTone(status: DealStatus): StatusToneKey {
  if (status === "COMPLETED" || status === "PICKUP_COMPLETE") return "success";
  if (status === "CANCELLED" || status === "REFUNDED") return "danger";
  return "progress";
}

export function dealStatusLabel(status: DealStatus): string {
  return DEAL_STATUS_LABEL[status] ?? String(status);
}
