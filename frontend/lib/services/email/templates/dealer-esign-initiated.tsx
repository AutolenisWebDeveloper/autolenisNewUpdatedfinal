// lib/services/email/templates/dealer-esign-initiated.tsx
// Dealer notice — the BUYER's e-signature request has been created for a deal.
// The buyer signs the purchase contract; the dealer does NOT sign it. This is an
// informational notice (no signing action for the dealer). Once the buyer signs,
// an executed copy becomes available on the dealer's deal page.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_ESIGN_INITIATED_SUBJECT =
  "Buyer signing started — no action needed";

export interface DealerEsignInitiatedEmailProps {
  contactName: string;
  vehicleRef: string;
  dealUrl: string;
}

export function renderDealerEsignInitiatedEmail({
  contactName,
  vehicleRef,
  dealUrl,
}: DealerEsignInitiatedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Buyer Signing Started — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Buyer Signing Started</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">The buyer has been asked to electronically sign the purchase contract for <strong>${vehicleRef}</strong>. No action is needed from you — the buyer signs the contract, and you'll receive an executed copy as soon as signing is complete.</p>
              <p style="margin:0 0 24px 0;font-size:14px;color:#555555;">You can track this deal's progress anytime from your dashboard.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${dealUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      View deal progress &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#888888;">Questions? Contact us at <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a>.</p>
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
