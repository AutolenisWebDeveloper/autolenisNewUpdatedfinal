// lib/services/email/templates/dealer-pickup-completed.tsx
// Dealer Pickup Completed — sent when QR check-in is completed and the deal is closed.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_PICKUP_COMPLETED_SUBJECT =
  "Pickup Confirmed — Payout Scheduled";

export interface DealerPickupCompletedEmailProps {
  contactName: string;
  vehicleRef: string;
  payoutSchedule: string;
}

export function renderDealerPickupCompletedEmail({
  contactName,
  vehicleRef,
  payoutSchedule,
}: DealerPickupCompletedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pickup Confirmed — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">&#10003; Pickup Confirmed</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">The QR check-in for <strong>${vehicleRef}</strong> has been completed successfully. The deal is now closed.</p>
              <!-- Payout Info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:20px;background:#f0faf0;border:1px solid #c0e0c0;border-radius:6px;">
                    <p style="margin:0;font-size:14px;font-weight:bold;color:#2e7d32;">Payout Scheduled</p>
                    <p style="margin:8px 0 0 0;font-size:15px;color:#333333;">${payoutSchedule}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#888888;">Thank you for completing this deal through AutoLenis. We look forward to working with you on future auctions.</p>
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
