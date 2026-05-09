// lib/services/email/templates/dealer-compliance-notice.tsx
// Dealer Compliance Notice — sent when a trust-check flags a potential off-platform contact attempt.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).
// IMPORTANT: No internal IDs exposed in the email body.

export const DEALER_COMPLIANCE_NOTICE_SUBJECT =
  "Compliance Notice — AutoLenis Platform Policy";

export interface DealerComplianceNoticeEmailProps {
  contactName: string;
  noticeDate: string;
}

export function renderDealerComplianceNoticeEmail({
  contactName,
  noticeDate,
}: DealerComplianceNoticeEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Compliance Notice — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Platform Compliance Notice</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 8px 0;font-size:13px;color:#888888;">Notice Date: ${noticeDate}</p>
              <p style="margin:0 0 16px 0;">Our platform trust systems have flagged activity on your account that may constitute an attempt to contact a buyer outside the AutoLenis platform.</p>
              <!-- Policy Reminder -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="padding:16px 20px;background:#fff8f8;border-bottom:1px solid #f0d0d0;">
                    <p style="margin:0;font-size:13px;font-weight:bold;color:#c0392b;text-transform:uppercase;letter-spacing:0.5px;">Anti-Circumvention Policy</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 12px 0;font-size:14px;color:#555555;">All buyer-dealer communication and transactions must take place within the AutoLenis platform. Attempting to contact buyers directly outside the platform, including through messages, external links, or shared personal contact information, is a violation of the AutoLenis dealer agreement.</p>
                    <p style="margin:0;font-size:14px;color:#555555;">This policy exists to protect the privacy and safety of buyers on the platform.</p>
                  </td>
                </tr>
              </table>
              <!-- Consequences -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border-left:3px solid #c0392b;padding-left:0;">
                <tr>
                  <td style="padding:12px 16px;background:#fff8f8;font-size:14px;color:#555555;line-height:1.6;">
                    <strong>Consequences of continued violations:</strong>
                    <ul style="margin:8px 0 0 0;padding:0 0 0 20px;">
                      <li style="margin-bottom:4px;">Temporary suspension of your dealer account</li>
                      <li style="margin-bottom:4px;">Permanent termination of your dealer account</li>
                      <li>Forfeiture of pending payouts</li>
                    </ul>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;color:#555555;">If you believe this notice was sent in error or have questions, please contact us at <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a>.</p>
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
