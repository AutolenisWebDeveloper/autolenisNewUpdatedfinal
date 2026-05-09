// lib/services/email/templates/dealer-account-terminated.tsx
// Dealer Account Terminated — sent when a dealer account is terminated.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_ACCOUNT_TERMINATED_SUBJECT =
  "Your AutoLenis Dealer Account Has Been Terminated";

export interface DealerAccountTerminatedEmailProps {
  contactName: string;
  dealershipName: string;
}

export function renderDealerAccountTerminatedEmail({
  contactName,
  dealershipName,
}: DealerAccountTerminatedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Account Terminated — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Account Notice</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">Your AutoLenis dealer account for <strong>${dealershipName}</strong> has been terminated and your access to the platform has been revoked.</p>
              <p style="margin:0 0 16px 0;font-weight:bold;color:#333333;font-size:14px;">Data Retention &amp; Portability</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:8px 12px;background:#F8F9FB;border-left:3px solid #0B5FD1;font-size:14px;color:#555555;line-height:1.5;margin-bottom:8px;">
                    Your data will be retained for <strong>90 days</strong> from the date of termination and will remain available for export during this period.
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:8px 12px;background:#F8F9FB;border-left:3px solid #0B5FD1;font-size:14px;color:#555555;line-height:1.5;">
                    To request a data export, please contact us before the retention period expires.
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;color:#555555;">If you believe this action was taken in error or have questions, please contact us at <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a>.</p>
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
