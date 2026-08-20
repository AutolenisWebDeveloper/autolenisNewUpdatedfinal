// lib/services/email/templates/dealer-pickup-proposed.tsx
// Dealer Pickup Proposed — sent when a buyer proposes a pickup time and the
// dealer needs to confirm it or propose an alternative.
// Plain HTML string (no react-dom/server — App Router incompatible).
// IMPORTANT: Only expose buyer city/state — never buyer name, email, phone, or address.

export const DEALER_PICKUP_PROPOSED_SUBJECT = (vehicleRef: string) =>
  `Action needed: confirm a pickup time — ${vehicleRef}`;

export interface DealerPickupProposedEmailProps {
  contactName: string;
  vehicleRef: string;
  buyerCity: string;
  buyerState: string;
  proposedWindow: string;
  dealUrl: string;
}

export function renderDealerPickupProposedEmail({
  contactName,
  vehicleRef,
  buyerCity,
  buyerState,
  proposedWindow,
  dealUrl,
}: DealerPickupProposedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirm a Pickup Time — AutoLenis</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
        <tr>
          <td style="background:#0B5FD1;padding:32px;text-align:center;">
            <p style="color:#ffffff;font-size:26px;font-weight:bold;margin:0;letter-spacing:-0.5px;">AutoLenis</p>
            <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Pickup Time Proposed</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
            <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
            <p style="margin:0 0 24px 0;">A buyer proposed a pickup time for <strong>${vehicleRef}</strong>. Please <strong>confirm it</strong> or propose an alternative that fits your availability.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
              <tr><td style="padding:16px 20px;background:#F8F9FB;border-bottom:1px solid #F0F9FF;">
                <p style="margin:0;font-size:13px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Proposed Pickup</p>
              </td></tr>
              <tr><td style="padding:16px 20px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:6px 0;font-size:14px;color:#888888;width:150px;">Vehicle</td><td style="padding:6px 0;font-size:14px;color:#333333;font-weight:bold;">${vehicleRef}</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#888888;">Buyer Location</td><td style="padding:6px 0;font-size:14px;color:#333333;">${buyerCity}, ${buyerState}</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#888888;">Proposed Time</td><td style="padding:6px 0;font-size:14px;color:#333333;font-weight:bold;">${proposedWindow}</td></tr>
                </table>
              </td></tr>
            </table>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
              <tr><td>
                <a href="${dealUrl}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">Review &amp; Confirm &#8594;</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f8f8;padding:24px 40px;text-align:center;border-top:1px solid #F0F9FF;">
            <p style="margin:0;font-size:13px;color:#888888;">AutoLenis, Inc. &middot; <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
