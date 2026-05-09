// lib/services/email/templates/dealer-pickup-scheduled.tsx
// Dealer Pickup Scheduled — sent when a buyer confirms a pickup window.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).
// IMPORTANT: Only expose buyer city/state — never buyer name, email, phone, or address.

export const DEALER_PICKUP_SCHEDULED_SUBJECT = (vehicleRef: string) =>
  `Pickup Scheduled — ${vehicleRef}`;

export interface DealerPickupScheduledEmailProps {
  contactName: string;
  vehicleRef: string;
  buyerCity: string;
  buyerState: string;
  pickupWindow: string;
  dealUrl: string;
}

export function renderDealerPickupScheduledEmail({
  contactName,
  vehicleRef,
  buyerCity,
  buyerState,
  pickupWindow,
  dealUrl,
}: DealerPickupScheduledEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pickup Scheduled — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Pickup Scheduled</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 24px 0;">A buyer has confirmed a pickup window for <strong>${vehicleRef}</strong>. Please prepare the vehicle and ensure all paperwork is in order.</p>
              <!-- Pickup Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="padding:16px 20px;background:#F8F9FB;border-bottom:1px solid #F0F9FF;">
                    <p style="margin:0;font-size:13px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Pickup Details</p>
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
                        <td style="padding:6px 0;font-size:14px;color:#888888;">Buyer Location</td>
                        <td style="padding:6px 0;font-size:14px;color:#333333;">${buyerCity}, ${buyerState}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:14px;color:#888888;">Pickup Window</td>
                        <td style="padding:6px 0;font-size:14px;color:#333333;font-weight:bold;">${pickupWindow}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- Preparation Checklist -->
              <p style="margin:0 0 12px 0;font-weight:bold;color:#333333;font-size:14px;">Preparation Checklist</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;">
                <tr>
                  <td style="padding:6px 0;font-size:14px;color:#555555;vertical-align:top;">
                    <span style="color:#0B5FD1;font-weight:bold;margin-right:8px;">&#10003;</span> Ensure vehicle is clean and ready for handover.
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:14px;color:#555555;vertical-align:top;">
                    <span style="color:#0B5FD1;font-weight:bold;margin-right:8px;">&#10003;</span> Verify all paperwork is complete and signed.
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:14px;color:#555555;vertical-align:top;">
                    <span style="color:#0B5FD1;font-weight:bold;margin-right:8px;">&#10003;</span> Have keys and owner&#39;s manual available.
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:14px;color:#555555;vertical-align:top;">
                    <span style="color:#0B5FD1;font-weight:bold;margin-right:8px;">&#10003;</span> Confirm financing documents are signed.
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${dealUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      View Deal &#8594;
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
