export const FOUNDER_HOT_LEAD_ALERT_SUBJECT = (
  firstName: string,
  vehicle: string
): string => `🔥 Hot lead — ${firstName} wants ${vehicle}`;

export function renderFounderHotLeadAlertEmail(params: {
  firstName: string;
  email: string;
  phone: string;
  vehicle: string;
  budget: string;
  timeline: string;
  zip: string;
  score: number;
  scoringReason: string;
  sessionId: string;
  /** Admin path the CTA opens, resolved by the caller. Must be an existing page. */
  adminPath: string;
}): string {
  const {
    firstName, email, phone, vehicle, budget, timeline, zip,
    score, scoringReason, sessionId, adminPath,
  } = params;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";

  const timelineDisplay = timeline === "this_week"
    ? "This week"
    : timeline === "1_to_3_months"
      ? "1-3 months"
      : timeline === "researching"
        ? "Researching"
        : timeline;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>🔥 Hot lead — ${escapeHtml(firstName)}</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
  <div style="max-width:600px;margin:0 auto;background:#fff;">

    <!-- Hot lead banner -->
    <div style="background:#DC2626;padding:20px 32px;">
      <p style="margin:0;color:#fff;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:2px;">
        🔥 Hot Lead &mdash; Score ${score}/100
      </p>
    </div>

    <div style="padding:32px;">
      <h2 style="margin:0 0 8px;color:#111827;font-size:24px;font-weight:700;">
        ${escapeHtml(firstName)} wants a ${escapeHtml(vehicle)}
      </h2>
      <p style="margin:0 0 24px;color:#6B7280;font-size:14px;">
        Captured through the AutoLenis concierge
      </p>

      <!-- Contact info -->
      <div style="background:#FEF3C7;border:1px solid #FBBF24;border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="margin:0 0 6px;color:#92400E;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
          Contact
        </p>
        <p style="margin:0;color:#111827;font-size:15px;font-weight:600;">
          <a href="tel:${escapeHtml(phone)}" style="color:#0B5FD1;text-decoration:none;">${escapeHtml(phone)}</a>
        </p>
        <p style="margin:4px 0 0;color:#111827;font-size:13px;">
          <a href="mailto:${escapeHtml(email)}" style="color:#0B5FD1;text-decoration:none;">${escapeHtml(email)}</a>
        </p>
      </div>

      <!-- Lead details -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:13px;width:35%;">Vehicle</td>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(vehicle)}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:13px;">Budget</td>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(budget)}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:13px;">Timeline</td>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(timelineDisplay)}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:13px;">ZIP</td>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(zip)}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#6B7280;font-size:13px;">Score</td>
          <td style="padding:10px 0;color:#DC2626;font-size:14px;font-weight:700;">${score}/100 &mdash; Hot</td>
        </tr>
      </table>

      <!-- Scoring reason -->
      <div style="background:#F8F9FB;border-left:3px solid #0B5FD1;padding:12px 16px;margin-bottom:24px;">
        <p style="margin:0 0 4px;color:#6B7280;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">
          AI scoring reason
        </p>
        <p style="margin:0;color:#374151;font-size:13px;line-height:1.5;">
          ${escapeHtml(scoringReason)}
        </p>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin:24px 0;">
        <a href="${appUrl}${escapeHtml(adminPath)}" style="display:inline-block;background:#111827;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
          View in Admin &rarr;
        </a>
      </div>

      <p style="margin:24px 0 0;color:#94A3B8;font-size:11px;line-height:1.6;text-align:center;">
        Session: ${escapeHtml(sessionId)}<br>
        Time: ${new Date().toISOString()}
      </p>
    </div>

  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
