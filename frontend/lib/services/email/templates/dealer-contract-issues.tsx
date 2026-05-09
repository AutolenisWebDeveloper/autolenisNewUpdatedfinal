// lib/services/email/templates/dealer-contract-issues.tsx
// Dealer Contract Issues — sent when a contract review finds issues requiring correction.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).
// IMPORTANT: fixItems must contain plain language descriptions — no internal rule IDs.

export const DEALER_CONTRACT_ISSUES_SUBJECT = "Contract Review: Issues Found";

export interface DealerContractIssuesEmailProps {
  contactName: string;
  vehicleRef: string;
  fixItems: string[];
  contractUrl: string;
}

export function renderDealerContractIssuesEmail({
  contactName,
  vehicleRef,
  fixItems,
  contractUrl,
}: DealerContractIssuesEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Contract Issues Found — AutoLenis</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:#0B5FD1;padding:32px;text-align:center;">
              <p style="color:#ffffff;font-size:26px;font-weight:bold;margin:0;letter-spacing:-0.5px;">AutoLenis</p>
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Contract Review</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">Our contract review for <strong>${vehicleRef}</strong> found the following issues that need to be corrected before the deal can proceed.</p>
              <!-- Issues List -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="padding:16px 20px;background:#fff8f8;border-bottom:1px solid #f0d0d0;">
                    <p style="margin:0;font-size:13px;font-weight:bold;color:#c0392b;text-transform:uppercase;letter-spacing:0.5px;">Issues to Fix</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <ul style="margin:0;padding:0 0 0 20px;color:#555555;font-size:14px;line-height:1.8;">
                      ${fixItems.map((item) => `<li style="margin-bottom:6px;">${item}</li>`).join("")}
                    </ul>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px 0;font-size:14px;color:#555555;">Please correct the items listed above and re-upload your contract to continue the transaction.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${contractUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Re-upload Contract &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#888888;">Need assistance? Contact us at <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a>.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f8f8;padding:24px 40px;text-align:center;border-top:1px solid #F0F9FF;">
              <p style="margin:0;font-size:13px;color:#888888;">AutoLenis, Inc. &middot; <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a></p>
              <p style="margin:4px 0 0 0;font-size:12px;color:#aaaaaa;"><a href="#" style="color:#aaaaaa;">Unsubscribe</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
