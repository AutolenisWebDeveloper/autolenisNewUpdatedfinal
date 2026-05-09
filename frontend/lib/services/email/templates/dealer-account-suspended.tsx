// lib/services/email/templates/dealer-account-suspended.tsx
// Dealer Account Suspended — sent when a dealer account is suspended.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_ACCOUNT_SUSPENDED_SUBJECT =
  "Your AutoLenis Dealer Account Has Been Suspended";

export interface DealerAccountSuspendedEmailProps {
  contactName: string;
  dealershipName: string;
  reasonCategory: string;
  adminContactEmail: string;
}

export function renderDealerAccountSuspendedEmail({
  contactName,
  dealershipName,
  reasonCategory,
  adminContactEmail,
}: DealerAccountSuspendedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Account Suspended — AutoLenis</title>
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
              <p style="margin:0 0 16px 0;">Your AutoLenis dealer account for <strong>${dealershipName}</strong> has been suspended and your access to the platform has been temporarily restricted.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:16px;background:#fff8f8;border:1px solid #f0d0d0;border-radius:6px;">
                    <p style="margin:0;font-size:14px;color:#333333;"><strong>Reason category:</strong> ${reasonCategory}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px 0;font-weight:bold;color:#333333;font-size:14px;">Steps to Reinstate Your Account</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:8px 0;vertical-align:top;width:28px;">
                    <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">1</span>
                  </td>
                  <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                    Review the reason category above and gather any relevant documentation.
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;width:28px;">
                    <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">2</span>
                  </td>
                  <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                    Contact our team at <a href="mailto:${adminContactEmail}" style="color:#0B5FD1;text-decoration:none;">${adminContactEmail}</a> to begin the reinstatement process.
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;width:28px;">
                    <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">3</span>
                  </td>
                  <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                    Once your case is reviewed and resolved, your account access will be restored.
                  </td>
                </tr>
              </table>
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
