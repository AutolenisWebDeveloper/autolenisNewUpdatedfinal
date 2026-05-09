// lib/services/email/templates/dealer-auction-reminder.tsx
// Dealer Auction Reminder — sent to remind a dealer to submit an offer before deadline.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_AUCTION_REMINDER_SUBJECT = (
  hoursRemaining: number,
  year: number,
  make: string,
  model: string
) => `${hoursRemaining}h Left — Submit Your Offer for ${year} ${make} ${model}`;

export interface DealerAuctionReminderEmailProps {
  contactName: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  auctionUrl: string;
  hoursRemaining: number;
}

export function renderDealerAuctionReminderEmail({
  contactName,
  vehicleMake,
  vehicleModel,
  vehicleYear,
  auctionUrl,
  hoursRemaining,
}: DealerAuctionReminderEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Offer Deadline Reminder — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Auction Deadline Reminder</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 24px 0;">The auction for a <strong>${vehicleYear} ${vehicleMake} ${vehicleModel}</strong> is closing soon. Don't miss your opportunity to submit a competitive offer.</p>
              <!-- Countdown -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:20px;background:#fff8e6;border:1px solid #f5e0a0;border-radius:6px;text-align:center;">
                    <p style="margin:0;font-size:36px;font-weight:bold;color:#b07a00;">${hoursRemaining}h</p>
                    <p style="margin:4px 0 0 0;font-size:14px;color:#888888;">remaining to submit your offer</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px 0;font-size:14px;color:#555555;">Submit your offer now to stay competitive. Offers cannot be submitted after the auction window closes.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${auctionUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Submit Your Offer &#8594;
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
