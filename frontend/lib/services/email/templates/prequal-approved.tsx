// Email template: Prequalification Approved
// Generates the HTML body for the buyer congratulations email sent on APPROVED decisions.

const TIER_LABELS: Record<string, string> = {
  STRONG: "Excellent Credit Profile",
  GOOD: "Good Credit Profile",
  FAIR: "Fair Credit Profile",
  WEAK: "Limited Credit History",
};

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export interface PrequalApprovedTemplateProps {
  firstName: string;
  maxOtdAmountCents: number;
  tier: string | null;
  expiryDate: Date;
}

export function prequalApprovedHtml({
  firstName,
  maxOtdAmountCents,
  tier,
  expiryDate,
}: PrequalApprovedTemplateProps): string {
  const tierLabel =
    (tier ? TIER_LABELS[tier] : undefined) ?? "Pre-Qualified";
  const amount = formatCurrency(maxOtdAmountCents);
  const expiry = formatDate(expiryDate);
  const browseUrl = "https://autolenis.com/buyer/search";

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">

      <!-- Header -->
      <div style="background:#0B5FD1;padding:32px;text-align:center">
        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px">
          You&#39;re Pre-Qualified
        </h1>
        <p style="margin:8px 0 0;color:#93C5FD;font-size:14px">AutoLenis Pre-Qualification</p>
      </div>

      <!-- Greeting -->
      <div style="padding:32px 32px 0">
        <p style="color:#1a1a2e;font-size:16px;line-height:1.6;margin:0 0 8px">
          Dear ${firstName},
        </p>
        <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px">
          Great news &#8212; you&#39;ve been pre-qualified with AutoLenis!
        </p>
        <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">
          Here is a summary of your prequalification findings:
        </p>
      </div>

      <!-- Budget Card -->
      <div style="padding:0 32px 24px">
        <div style="background:#0B5FD1;border-radius:12px;padding:28px 24px;text-align:center">
          <p style="margin:0 0 4px;color:#93C5FD;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;font-weight:600">
            YOUR APPROVED BUYING POWER
          </p>
          <p style="margin:0 0 20px;color:#ffffff;font-size:42px;font-weight:800;letter-spacing:-1px;line-height:1.1">
            ${amount}
          </p>
          <table style="width:100%;border-collapse:collapse;color:#ffffff;font-size:14px">
            <tr>
              <td style="padding:6px 0;color:#93C5FD;text-align:left">Maximum Budget</td>
              <td style="padding:6px 0;text-align:right;font-weight:600">${amount}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#93C5FD;text-align:left">Credit Profile</td>
              <td style="padding:6px 0;text-align:right;font-weight:600">${tierLabel}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#93C5FD;text-align:left">Valid Through</td>
              <td style="padding:6px 0;text-align:right;font-weight:600">${expiry}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#93C5FD;text-align:left">Soft Pull Only</td>
              <td style="padding:6px 0;text-align:right;font-weight:600">No credit impact</td>
            </tr>
          </table>
        </div>
      </div>

      <!-- What This Means -->
      <div style="padding:0 32px 24px">
        <p style="color:#1a1a2e;font-size:16px;font-weight:700;margin:0 0 12px">
          What this means for you:
        </p>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.8">
          <li>Your vehicle search will show only options within your approved budget</li>
          <li>Dealers can only submit offers within your pre-qualified range</li>
          <li>This approval is valid for 30 days from today</li>
          <li>No credit score impact was made during this check</li>
          <li>This is not a loan commitment &#8212; financing is selected after you choose your deal</li>
        </ul>
      </div>

      <!-- Disclosure -->
      <div style="padding:0 32px 24px">
        <div style="background:#f9fafb;border-left:3px solid #e5e7eb;padding:16px;border-radius:4px">
          <p style="margin:0 0 6px;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">
            IMPORTANT DISCLOSURE
          </p>
          <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6">
            This prequalification is based on a soft credit pull through MicroBilt
            Corporation and does not guarantee final financing approval. Credit
            Information accessed for your pre-qualification request may differ from
            the Credit Information accessed by a credit grantor at the time of a
            final credit decision.
          </p>
        </div>
      </div>

      <!-- CTA -->
      <div style="padding:0 32px 32px;text-align:center">
        <p style="color:#374151;font-size:15px;font-weight:600;margin:0 0 16px">
          Ready to find your next vehicle?
        </p>
        <a href="${browseUrl}"
           style="display:inline-block;background:#0B5FD1;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
          Browse Vehicles Within My Budget &#8594;
        </a>
      </div>

      <!-- Footer -->
      <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 32px;text-align:center">
        <p style="margin:0 0 8px;color:#6b7280;font-size:13px">
          Questions? Contact us at
          <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none">support@autolenis.com</a>
        </p>
        <p style="margin:0;color:#9ca3af;font-size:12px">AutoLenis, Inc.</p>
      </div>

    </div>
  `;
}
