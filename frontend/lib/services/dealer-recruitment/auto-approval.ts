// F-011 — dealer application auto-approval eligibility.
//
// SCOPE / SAFETY: this is a pure triage signal, NOT an account-creation trigger.
// Fully automatic approval is intentionally NOT applied to anonymous public
// applications because (a) that endpoint still lacks captcha/rate-limiting
// (F-022) and (b) the audit's auto-approval rule requires a Maps-verified
// dealer placeId, which only exists for recruited DealerProspects (F-010) — not
// for self-submitted applications. So today this only surfaces an "eligible for
// fast approval" annotation that lets an admin bulk-clear low-risk applications
// instead of scrutinising every field. Once F-010 links applications to
// Maps-verified prospects, `verifiedPlaceId` flips on and the same rule can gate
// genuine auto-approval behind an env flag.

export interface AutoApprovalInput {
  dealershipName: string;
  licenseNumber: string;
  state: string;
  zip: string;
  // Set only when the application originated from a Maps-verified prospect
  // (F-010). Anonymous public applications leave this false.
  verifiedPlaceId?: boolean;
}

export interface AutoApprovalResult {
  // Low-risk on objective fields → safe for an admin to fast-approve.
  eligible: boolean;
  // True only when EVERY criterion for hands-off automatic approval is met,
  // including Maps verification. Gated behind an env flag by callers.
  autoApprovable: boolean;
  reasons: string[];
}

// A US dealer license is typically 5–20 alphanumerics (formats vary by state),
// optionally with dashes. We validate shape only — not authenticity.
const LICENSE_RE = /^[A-Za-z0-9-]{5,20}$/;
const STATE_RE = /^[A-Za-z]{2}$/;
const ZIP_RE = /^\d{5}$/;

export function evaluateDealerApplicationAutoApproval(
  input: AutoApprovalInput,
): AutoApprovalResult {
  const reasons: string[] = [];

  const licenseOk = LICENSE_RE.test((input.licenseNumber ?? "").trim());
  const stateOk = STATE_RE.test((input.state ?? "").trim());
  const zipOk = ZIP_RE.test((input.zip ?? "").trim());
  const nameOk = (input.dealershipName ?? "").trim().length >= 2;

  if (!licenseOk) reasons.push("license number format invalid");
  if (!stateOk) reasons.push("state not a 2-letter code");
  if (!zipOk) reasons.push("zip not 5 digits");
  if (!nameOk) reasons.push("dealership name too short");

  const eligible = licenseOk && stateOk && zipOk && nameOk;
  if (eligible) reasons.push("objective fields valid");

  // Hands-off auto-approval additionally requires Maps verification (F-010).
  const autoApprovable = eligible && input.verifiedPlaceId === true;
  if (eligible && !autoApprovable) {
    reasons.push("manual review required (no Maps-verified placeId)");
  }

  return { eligible, autoApprovable, reasons };
}

// Compact human-readable annotation for the application notes / admin queue.
export function autoApprovalAnnotation(result: AutoApprovalResult): string {
  const tag = result.autoApprovable
    ? "AUTO-APPROVABLE"
    : result.eligible
      ? "FAST-APPROVE ELIGIBLE"
      : "NEEDS REVIEW";
  return `[Auto-review: ${tag} — ${result.reasons.join("; ")}]`;
}
