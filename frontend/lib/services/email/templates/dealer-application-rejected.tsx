// lib/services/email/templates/dealer-application-rejected.tsx
// Dealer Application Rejected — sent when a dealer application is not approved.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_APPLICATION_REJECTED_SUBJECT =
  "Update on Your AutoLenis Dealer Application";

export interface DealerApplicationRejectedEmailProps {
  contactName: string;
  dealershipName: string;
}

export function renderDealerApplicationRejectedEmail({
  contactName,
  dealershipName,
}: DealerApplicationRejectedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Update on Your Dealer Application — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Dealer Network</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">Thank you for your interest in joining the AutoLenis dealer network. After reviewing your application for <strong>${dealershipName}</strong>, we are unable to move forward at this time.</p>
              <p style="margin:0 0 16px 0;">We encourage you to reapply after 90 days. Our team is happy to answer any general questions you may have about our platform requirements.</p>
              <p style="margin:0;font-size:14px;color:#555555;">For assistance, please contact us at <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a>.</p>
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
