// Email template: Admin Prequalification Alert
//
// Ops-addressed notification on (a) a new prequal resolving to
// MANUAL_REVIEW / OFAC_REVIEW / OFAC_ESCALATED, or (b) a MicroBilt provider
// failure — the reasons in PROVIDER_ERROR_REASONS (microbilt.service, the single
// source of truth) plus HTTP_*: TIMEOUT / NETWORK_ERROR / OAUTH_FAILED /
// IPREDICT_ERROR / CONFIG_ERROR / CONFIG_MISMATCH / URL_NOT_CONFIGURED /
// EMPTY_RESPONSE / UNPARSEABLE_RESPONSE / IDENTITY_NOT_CONFIGURED.
//
// Discreet on OFAC — content never confirms an OFAC hit, only that a case
// requires manual review. Actionable: deep-links to the buyer record.

export const ADMIN_PREQUAL_ALERT_SUBJECT_REVIEW =
  "[AutoLenis Ops] Prequalification needs manual review";
export const ADMIN_PREQUAL_ALERT_SUBJECT_PROVIDER =
  "[AutoLenis Ops] Prequalification provider error";

export type AdminPrequalAlertKind = "REVIEW" | "PROVIDER_ERROR";

export interface AdminPrequalAlertTemplateProps {
  kind: AdminPrequalAlertKind;
  buyerId: string;
  buyerEmail: string;
  decision: string;
  providerReason?: string | null;
  appUrl: string;
}

export function renderAdminPrequalAlertEmail({
  kind,
  buyerId,
  buyerEmail,
  decision,
  providerReason,
  appUrl,
}: AdminPrequalAlertTemplateProps): string {
  const reviewUrl = `${appUrl}/admin/buyers/${buyerId}?tab=prequal`;
  const queueUrl = `${appUrl}/admin/manual-reviews`;
  const title =
    kind === "REVIEW"
      ? "A prequalification requires manual review"
      : "MicroBilt iPredict provider error";
  const intro =
    kind === "REVIEW"
      ? "A new prequalification has resolved to a state that needs an admin to action it before the buyer can proceed."
      : "The prequalification could not be completed because the upstream provider returned an error. The buyer has been routed to MANUAL_REVIEW.";

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:#111827;padding:24px 32px">
        <p style="margin:0;color:#9CA3AF;font-size:11px;letter-spacing:0.15em;text-transform:uppercase">AutoLenis Ops Alert</p>
        <h1 style="margin:6px 0 0 0;color:#fff;font-size:20px;font-weight:700">${title}</h1>
      </div>
      <div style="padding:24px 32px;color:#111827;line-height:1.5;font-size:14px">
        <p style="margin-top:0">${intro}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
          <tr><td style="padding:6px 0;color:#6B7280;width:140px">Buyer ID</td><td style="padding:6px 0;font-family:monospace">${buyerId}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Buyer email</td><td style="padding:6px 0">${buyerEmail}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Decision</td><td style="padding:6px 0"><strong>${decision}</strong></td></tr>
          ${providerReason
            ? `<tr><td style="padding:6px 0;color:#6B7280">Provider reason</td><td style="padding:6px 0;font-family:monospace">${providerReason}</td></tr>`
            : ""}
        </table>
        <p style="margin:18px 0 0">
          <a href="${reviewUrl}" style="display:inline-block;background:#0B5FD1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:13px">Open buyer prequal panel</a>
          &nbsp;
          <a href="${queueUrl}" style="display:inline-block;background:#fff;color:#0B5FD1;text-decoration:none;padding:10px 18px;border:1px solid #0B5FD1;border-radius:6px;font-weight:600;font-size:13px">Manual review queue</a>
        </p>
      </div>
      <div style="padding:14px 32px;background:#F8F9FB;border-top:1px solid #E5E7EB;font-size:11px;color:#6B7280">
        Sent to your ops address (ADMIN_NOTIFICATION_EMAIL). Do not forward externally. Content is intentionally discreet — do not include consumer report details in replies.
      </div>
    </div>
  `.trim();
}
