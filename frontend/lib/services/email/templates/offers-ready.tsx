// lib/services/email/templates/offers-ready.tsx
// Offers Ready — sent when Best Price Engine produces ranked outputs.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const OFFERS_READY_SUBJECT = (firstName: string) =>
  `Your options are ready — ${firstName}, choose your best deal`;

export interface OffersReadyEmailProps {
  firstName: string;
  offersUrl: string;
}

export function renderOffersReadyEmail({ firstName, offersUrl }: OffersReadyEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Options Are Ready — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Your Options Are Ready 🎉</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 24px 0;">Great news. Dealers have submitted their best offers and we've ranked them for you.</p>
              <!-- Three offer type cards -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:0 6px 0 0;width:33.3%;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#f0eafc;border-radius:6px;padding:16px;text-align:center;">
                          <p style="margin:0 0 4px 0;font-size:11px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Best for</p>
                          <p style="margin:0;font-size:14px;font-weight:bold;color:#333333;">Cash Buyers</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="padding:0 3px;width:33.3%;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#f0eafc;border-radius:6px;padding:16px;text-align:center;">
                          <p style="margin:0 0 4px 0;font-size:11px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Best</p>
                          <p style="margin:0;font-size:14px;font-weight:bold;color:#333333;">Monthly Payment</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="padding:0 0 0 6px;width:33.3%;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#f0eafc;border-radius:6px;padding:16px;text-align:center;">
                          <p style="margin:0 0 4px 0;font-size:11px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Best</p>
                          <p style="margin:0;font-size:14px;font-weight:bold;color:#333333;">Overall Value</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${offersUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      View My Options &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Urgency note -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#fff8e6;border-left:4px solid #e0a100;padding:12px 16px;border-radius:4px;">
                    <p style="margin:0;font-size:13px;color:#7a5800;">
                      <strong>Your options are held for 72 hours.</strong> After that, the auction may be re-opened.
                    </p>
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
