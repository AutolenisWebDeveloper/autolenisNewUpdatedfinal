// lib/services/email/templates/auction-activated.tsx
// Auction Activated — sent when auction status transitions to ACTIVE.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const AUCTION_ACTIVATED_SUBJECT =
  "Your private auction is live — dealers are competing for you";

export interface AuctionActivatedEmailProps {
  firstName: string;
  auctionUrl: string;
}

export function renderAuctionActivatedEmail({
  firstName,
  auctionUrl,
}: AuctionActivatedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Auction Is Live — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Your Auction Is Live 🔨</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 16px 0;">Your private 48-hour auction has started. Up to 8 pre-vetted dealers in your area have been invited to submit competitive offers.</p>
              <!-- Countdown info box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="background:#F8F9FB;border-left:4px solid #0B5FD1;padding:16px 20px;border-radius:4px;text-align:center;">
                    <p style="margin:0;font-size:18px;font-weight:bold;color:#0B5FD1;">Auction closes in approximately 48 hours</p>
                  </td>
                </tr>
              </table>
              <!-- What dealers see -->
              <p style="margin:0 0 8px 0;font-weight:bold;color:#333333;">What dealers see</p>
              <p style="margin:0 0 20px 0;color:#555555;font-size:14px;">Dealers see your vehicle shortlist and pre-qualified budget — they compete to win your business with their best offer.</p>
              <!-- What you should do -->
              <p style="margin:0 0 8px 0;font-weight:bold;color:#333333;">What you should do</p>
              <p style="margin:0 0 24px 0;color:#555555;font-size:14px;">Sit back. We'll email you as soon as competitive offers are ready for you to review.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <a href="${auctionUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      View Auction Status &#8594;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f8f8;padding:24px 40px;text-align:center;border-top:1px solid #F0F9FF;">
              <p style="margin:0;font-size:13px;color:#888888;">AutoLenis Inc. &middot; <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a></p>
              <p style="margin:4px 0 0 0;font-size:12px;color:#aaaaaa;">This email was sent by AutoLenis, Inc.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
