// lib/services/email/templates/dealer-application-approved.tsx
// Dealer Application Approved — sent when a dealer application is approved.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_APPLICATION_APPROVED_SUBJECT =
  "Your Application is Approved — Activate Your AutoLenis Dealer Account";

export interface DealerApplicationApprovedEmailProps {
  contactName: string;
  dealershipName: string;
  claimUrl: string;
  expiresAt: string;
}

export function renderDealerApplicationApprovedEmail({
  contactName,
  dealershipName,
  claimUrl,
  expiresAt,
}: DealerApplicationApprovedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Application Approved — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Dealer Network — Application Approved</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">Congratulations — your application for <strong>${dealershipName}</strong> has been approved! You are now ready to activate your AutoLenis dealer account and start participating in our private buyer auction network.</p>
              <p style="margin:0 0 24px 0;">Click the button below to activate your account and complete onboarding.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">
                <tr>
                  <td>
                    <a href="${claimUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Activate Your Account &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 32px 0;font-size:13px;color:#888888;">This activation link expires on ${expiresAt}. Please activate your account before then.</p>
              <!-- Tier Benefits -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eeeeee;padding-top:24px;margin-top:8px;">
                <tr>
                  <td>
                    <p style="margin:0 0 16px 0;font-weight:bold;color:#333333;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Tier Benefits Overview</p>
                    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                      <tr style="background:#F8F9FB;">
                        <td style="padding:10px 12px;font-size:13px;font-weight:bold;color:#0B5FD1;border:1px solid #F0F9FF;">Standard</td>
                        <td style="padding:10px 12px;font-size:13px;color:#555555;border:1px solid #F0F9FF;">Access to all auctions</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 12px;font-size:13px;font-weight:bold;color:#0B5FD1;border:1px solid #F0F9FF;">Silver</td>
                        <td style="padding:10px 12px;font-size:13px;color:#555555;border:1px solid #F0F9FF;">Priority auction placement + analytics</td>
                      </tr>
                      <tr style="background:#F8F9FB;">
                        <td style="padding:10px 12px;font-size:13px;font-weight:bold;color:#0B5FD1;border:1px solid #F0F9FF;">Gold</td>
                        <td style="padding:10px 12px;font-size:13px;color:#555555;border:1px solid #F0F9FF;">Dedicated account manager + premium placement</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 12px;font-size:13px;font-weight:bold;color:#0B5FD1;border:1px solid #F0F9FF;">Platinum</td>
                        <td style="padding:10px 12px;font-size:13px;color:#555555;border:1px solid #F0F9FF;">Custom SLA + full API access</td>
                      </tr>
                    </table>
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
