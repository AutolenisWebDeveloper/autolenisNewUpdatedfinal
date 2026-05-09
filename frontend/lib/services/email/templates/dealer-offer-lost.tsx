// lib/services/email/templates/dealer-offer-lost.tsx
// Dealer Offer Lost — sent when a dealer's offer is not selected.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).
// IMPORTANT: Never expose competitor identities or competitor offer amounts.

export const DEALER_OFFER_LOST_SUBJECT =
  "Auction Closed — Your Offer Was Not Selected";

export interface DealerOfferLostEmailProps {
  contactName: string;
  vehicleRef: string;
  yourPosition: number;
  totalOffers: number;
  insightsUrl: string;
}

export function renderDealerOfferLostEmail({
  contactName,
  vehicleRef,
  yourPosition,
  totalOffers,
  insightsUrl,
}: DealerOfferLostEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Auction Closed — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Auction Results</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">The auction for <strong>${vehicleRef}</strong> has closed. Unfortunately, your offer was not selected this time.</p>
              <!-- Position Context -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:16px 20px;background:#F8F9FB;border:1px solid #F0F9FF;border-radius:6px;text-align:center;">
                    <p style="margin:0;font-size:14px;color:#0B5FD1;font-weight:bold;">Your Position</p>
                    <p style="margin:4px 0 0 0;font-size:22px;font-weight:bold;color:#333333;">${yourPosition} of ${totalOffers} offers submitted</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px 0;font-size:14px;color:#555555;">Review post-auction insights to understand how your pricing compares to the market and improve your next offer.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${insightsUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      View Post-Auction Insights &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#888888;">New auction invitations are sent regularly. Stay competitive and keep an eye on your inbox.</p>
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
