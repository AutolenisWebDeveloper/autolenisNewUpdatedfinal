// lib/services/email/templates/dealer-payout-initiated.tsx
// Dealer Payout Initiated — sent when an ACH disbursement is queued.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_PAYOUT_INITIATED_SUBJECT = "Payout Initiated — AutoLenis";

export interface DealerPayoutInitiatedEmailProps {
  contactName: string;
  vehicleRef: string;
  amountCents: number;
  estimatedArrival: string;
}

export function renderDealerPayoutInitiatedEmail({
  contactName,
  vehicleRef,
  amountCents,
  estimatedArrival,
}: DealerPayoutInitiatedEmailProps): string {
  const formattedAmount = `$${(amountCents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payout Initiated — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Payout Initiated</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 24px 0;">Your ACH disbursement for the deal associated with <strong>${vehicleRef}</strong> has been queued and is on its way.</p>
              <!-- Payout Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="padding:16px 20px;background:#F8F9FB;border-bottom:1px solid #F0F9FF;">
                    <p style="margin:0;font-size:13px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Payout Details</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;font-size:14px;color:#888888;width:160px;">Vehicle</td>
                        <td style="padding:6px 0;font-size:14px;color:#333333;font-weight:bold;">${vehicleRef}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:14px;color:#888888;">Amount</td>
                        <td style="padding:6px 0;font-size:20px;color:#0B5FD1;font-weight:bold;">${formattedAmount}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:14px;color:#888888;">Estimated Arrival</td>
                        <td style="padding:6px 0;font-size:14px;color:#333333;font-weight:bold;">${estimatedArrival}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#888888;">If you have questions about your payout, contact us at <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a>.</p>
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
