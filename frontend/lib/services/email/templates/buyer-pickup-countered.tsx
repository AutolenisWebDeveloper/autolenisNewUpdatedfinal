// lib/services/email/templates/buyer-pickup-countered.tsx
// Buyer Pickup Countered — sent when the dealership proposes an alternative
// pickup time and the buyer needs to accept it or propose another.
// Plain HTML string (no react-dom/server — App Router incompatible).

export const BUYER_PICKUP_COUNTERED_SUBJECT = "The dealership proposed a new pickup time";

export interface BuyerPickupCounteredEmailProps {
  firstName: string;
  proposedWindow: string;
  pickupUrl: string;
}

export function renderBuyerPickupCounteredEmail({
  firstName,
  proposedWindow,
  pickupUrl,
}: BuyerPickupCounteredEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>A New Pickup Time — AutoLenis</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
        <tr>
          <td style="background:#0B5FD1;padding:32px;text-align:center;">
            <p style="color:#ffffff;font-size:26px;font-weight:bold;margin:0;letter-spacing:-0.5px;">AutoLenis</p>
            <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">New Pickup Time Proposed</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
            <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
            <p style="margin:0 0 24px 0;">The dealership proposed a different pickup time. You can <strong>accept it</strong> or suggest another time that works for you.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
              <tr><td style="padding:16px 20px;background:#F8F9FB;border-bottom:1px solid #F0F9FF;">
                <p style="margin:0;font-size:13px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Proposed Pickup</p>
              </td></tr>
              <tr><td style="padding:16px 20px;">
                <p style="margin:0;font-size:16px;color:#333333;font-weight:bold;">${proposedWindow}</p>
              </td></tr>
            </table>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
              <tr><td>
                <a href="${pickupUrl}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">Review Pickup Time &#8594;</a>
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
