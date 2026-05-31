export const BUYER_OPPORTUNITY_CONFIRMATION_SUBJECT = (
  vehicle: string
): string => `Your ${vehicle} dealer auction is being set up`;

export function renderBuyerOpportunityConfirmationEmail(params: {
  firstName: string;
  vehicle: string;
  budget: string;
  timeline: string;
  zip: string;
}): string {
  const { firstName, vehicle, budget, timeline, zip } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";

  const timelineDisplay = timeline === "this_week"
    ? "this week"
    : timeline === "1_to_3_months"
      ? "the next 1-3 months"
      : timeline === "researching"
        ? "your research phase"
        : timeline;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your dealer auction is being set up</title>
</head>
<body style="margin:0;padding:0;background:#F8F9FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;">

    <!-- Header -->
    <div style="background:#0B5FD1;padding:32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
        AutoLenis
      </h1>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:600;line-height:1.3;">
        Hi ${escapeHtml(firstName)} — your dealer auction is being set up
      </h2>

      <p style="margin:0 0 24px;color:#4B5563;font-size:15px;line-height:1.6;">
        Thanks for telling me what you're looking for. I'm getting verified dealers in your area lined up to compete for your business. You'll start receiving offers from them shortly — directly to you, no haggling at a showroom.
      </p>

      <!-- Summary card -->
      <div style="background:#F8F9FB;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 12px;color:#94A3B8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">
          What you told me
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:35%;">Vehicle</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(vehicle)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;">Budget</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(budget)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;">Timeline</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(timelineDisplay)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;">Area</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">ZIP ${escapeHtml(zip)}</td>
          </tr>
        </table>
      </div>

      <!-- What happens next -->
      <p style="margin:0 0 12px;color:#111827;font-size:14px;font-weight:600;">
        What happens next
      </p>
      <ol style="margin:0 0 24px;padding-left:20px;color:#4B5563;font-size:14px;line-height:1.7;">
        <li>I'm reaching out to verified dealers near ${escapeHtml(zip)} who sell the vehicle you want</li>
        <li>Dealers will submit their best out-the-door prices privately to you</li>
        <li>You'll get a comparison of the top offers — no pressure, no obligation</li>
      </ol>

      <!-- CTA -->
      <div style="text-align:center;margin:32px 0;">
        <a href="${appUrl}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
          Visit AutoLenis &rarr;
        </a>
      </div>

      <p style="margin:24px 0 0;color:#94A3B8;font-size:12px;line-height:1.6;text-align:center;">
        Questions? Just reply to this email and a real person will get back to you.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#F8F9FB;padding:24px 32px;border-top:1px solid #E5E7EB;text-align:center;">
      <p style="margin:0;color:#94A3B8;font-size:11px;line-height:1.6;">
        AutoLenis &mdash; Verified dealers compete for your business<br>
        <a href="${appUrl}" style="color:#0B5FD1;text-decoration:none;">autolenis.com</a>
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
