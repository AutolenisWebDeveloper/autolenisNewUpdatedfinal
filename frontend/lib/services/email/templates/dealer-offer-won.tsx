// lib/services/email/templates/dealer-offer-won.tsx
// Dealer Offer Won — sent when a dealer's offer is selected by the buyer.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).
// IMPORTANT: Only expose buyer first name + last initial — no other buyer PII.

export const DEALER_OFFER_WON_SUBJECT = (vehicleRef: string) =>
  `You Won — ${vehicleRef}`;

export interface DealerOfferWonEmailProps {
  contactName: string;
  vehicleRef: string;
  buyerFirstName: string;
  buyerLastInitial: string;
  dealUrl: string;
}

export function renderDealerOfferWonEmail({
  contactName,
  vehicleRef,
  buyerFirstName,
  buyerLastInitial,
  dealUrl,
}: DealerOfferWonEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You Won — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">&#127881; Congratulations — Deal Won</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">Congratulations! Your offer for <strong>${vehicleRef}</strong> has been selected. The buyer has chosen your dealership.</p>
              <!-- Deal Info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="padding:16px 20px;background:#F8F9FB;border-bottom:1px solid #F0F9FF;">
                    <p style="margin:0;font-size:13px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Deal Summary</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;font-size:14px;color:#888888;width:140px;">Vehicle</td>
                        <td style="padding:6px 0;font-size:14px;color:#333333;font-weight:bold;">${vehicleRef}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:14px;color:#888888;">Buyer</td>
                        <td style="padding:6px 0;font-size:14px;color:#333333;">${buyerFirstName} ${buyerLastInitial}.</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px 0;font-size:14px;color:#555555;">Proceed to the deal page to review the next steps and begin the transaction process.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${dealUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Proceed to Deal &#8594;
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
