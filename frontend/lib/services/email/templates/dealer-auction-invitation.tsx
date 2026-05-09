// lib/services/email/templates/dealer-auction-invitation.tsx
// Dealer Auction Invitation — sent when a dealer is invited to bid on a buyer auction.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).
// IMPORTANT: Only exposes buyer city/state — never buyer name, email, phone, or address.

export const DEALER_AUCTION_INVITATION_SUBJECT = (
  year: number,
  make: string,
  model: string
) => `New Auction Invitation — ${year} ${make} ${model}`;

export interface DealerAuctionInvitationEmailProps {
  contactName: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  vehicleTrim: string | null;
  buyerCity: string;
  buyerState: string;
  auctionUrl: string;
  expiryHours: number;
}

export function renderDealerAuctionInvitationEmail({
  contactName,
  vehicleMake,
  vehicleModel,
  vehicleYear,
  vehicleTrim,
  buyerCity,
  buyerState,
  auctionUrl,
  expiryHours,
}: DealerAuctionInvitationEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Auction Invitation — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">New Auction Invitation</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 24px 0;">A buyer in your area is looking for a vehicle that matches your inventory. You have been invited to submit a competitive offer.</p>
              <!-- Vehicle Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="padding:16px 20px;background:#F8F9FB;border-bottom:1px solid #F0F9FF;">
                    <p style="margin:0;font-size:13px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Vehicle</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:4px 0;font-size:14px;color:#888888;width:120px;">Year / Make / Model</td>
                        <td style="padding:4px 0;font-size:14px;color:#333333;font-weight:bold;">${vehicleYear} ${vehicleMake} ${vehicleModel}</td>
                      </tr>
                      ${vehicleTrim ? `<tr>
                        <td style="padding:4px 0;font-size:14px;color:#888888;width:120px;">Trim</td>
                        <td style="padding:4px 0;font-size:14px;color:#333333;">${vehicleTrim}</td>
                      </tr>` : ""}
                      <tr>
                        <td style="padding:4px 0;font-size:14px;color:#888888;width:120px;">Buyer Location</td>
                        <td style="padding:4px 0;font-size:14px;color:#333333;">${buyerCity}, ${buyerState}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- Countdown -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:14px 20px;background:#fff8e6;border:1px solid #f5e0a0;border-radius:6px;text-align:center;">
                    <p style="margin:0;font-size:22px;font-weight:bold;color:#b07a00;">${expiryHours}h remaining</p>
                    <p style="margin:4px 0 0 0;font-size:13px;color:#888888;">Submit your offer before the auction window closes.</p>
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${auctionUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Review &amp; Bid &#8594;
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
