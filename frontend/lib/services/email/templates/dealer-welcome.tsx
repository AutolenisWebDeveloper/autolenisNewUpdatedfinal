// lib/services/email/templates/dealer-welcome.tsx
// Dealer Welcome — sent when a dealer account becomes active.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_WELCOME_SUBJECT =
  "Welcome to AutoLenis — Your Dealer Account is Active";

export interface DealerWelcomeEmailProps {
  contactName: string;
  dealershipName: string;
  dashboardUrl: string;
}

export function renderDealerWelcomeEmail({
  contactName,
  dealershipName,
  dashboardUrl,
}: DealerWelcomeEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to AutoLenis — Dealer Account Active</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Welcome to the Dealer Network</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">Welcome to AutoLenis! Your dealer account for <strong>${dealershipName}</strong> is now active and ready to use.</p>
              <p style="margin:0 0 24px 0;">Here is your onboarding checklist to get started:</p>
              <!-- Onboarding Steps -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;">
                <tr>
                  <td style="padding:8px 0;vertical-align:top;width:28px;">
                    <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">1</span>
                  </td>
                  <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                    <strong>Complete your dealership profile</strong> — add contact info, location, and operating hours.
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;width:28px;">
                    <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">2</span>
                  </td>
                  <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                    <strong>Upload your inventory</strong> — list the vehicles you have available for sale.
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;width:28px;">
                    <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">3</span>
                  </td>
                  <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                    <strong>Configure your DMS feed</strong> — keep your inventory automatically in sync.
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;width:28px;">
                    <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">4</span>
                  </td>
                  <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                    <strong>Review incoming auction invitations</strong> — browse buyer opportunities matched to your inventory.
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;width:28px;">
                    <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">5</span>
                  </td>
                  <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                    <strong>Submit your first competitive offer</strong> — win the deal and grow your business.
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${dashboardUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Go to Your Dashboard &#8594;
                    </a>
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
