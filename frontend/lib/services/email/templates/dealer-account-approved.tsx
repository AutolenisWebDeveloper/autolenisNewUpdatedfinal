// lib/services/email/templates/dealer-account-approved.tsx
// Dealer Account Approved — sent when a dealer account is fully approved.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_ACCOUNT_APPROVED_SUBJECT =
  "Your AutoLenis Dealer Account is Now Active";

export interface DealerAccountApprovedEmailProps {
  contactName: string;
  dealershipName: string;
  dashboardUrl: string;
}

export function renderDealerAccountApprovedEmail({
  contactName,
  dealershipName,
  dashboardUrl,
}: DealerAccountApprovedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dealer Account Now Active — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Dealer Account Active</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">Great news — your AutoLenis dealer account for <strong>${dealershipName}</strong> is now fully approved and active. You have full access to the platform and can begin participating in buyer auctions.</p>
              <p style="margin:0 0 20px 0;font-weight:bold;color:#333333;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">How Auction Participation Works</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;">
                <tr>
                  <td style="padding:8px 12px;background:#F8F9FB;border-left:3px solid #0B5FD1;margin-bottom:8px;font-size:14px;color:#555555;line-height:1.5;">
                    You will be invited to relevant auctions based on your inventory and location.
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:8px 12px;background:#F8F9FB;border-left:3px solid #0B5FD1;font-size:14px;color:#555555;line-height:1.5;">
                    Each auction has a <strong>48-hour competitive offer window</strong> for you to submit your best offer.
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:8px 12px;background:#F8F9FB;border-left:3px solid #0B5FD1;font-size:14px;color:#555555;line-height:1.5;">
                    Use the <strong>offer builder</strong> with real-time guidance to craft competitive, winning offers.
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${dashboardUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Go to Dashboard &#8594;
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
