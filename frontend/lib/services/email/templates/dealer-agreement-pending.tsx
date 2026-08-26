// lib/services/email/templates/dealer-agreement-pending.tsx
// Dealer Agreement Pending — sent when the agreement is ready for signing.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_AGREEMENT_PENDING_SUBJECT =
  "Action Required: Sign Your AutoLenis Dealer Agreement";

export interface DealerAgreementPendingEmailProps {
  contactName: string;
  dealershipName: string;
  signingUrl: string;
}

export function renderDealerAgreementPendingEmail({
  contactName,
  dealershipName,
  signingUrl,
}: DealerAgreementPendingEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign Your Dealer Agreement — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Action Required — Dealer Agreement</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">Your AutoLenis Dealer Agreement for <strong>${dealershipName}</strong> is ready for your signature.</p>
              <p style="margin:0 0 24px 0;">Please sign the agreement at your earliest convenience. Your dealer account will be fully activated once the agreement is signed and countersigned.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${signingUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Sign Agreement &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#888888;">If you have questions about the agreement, contact us at <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a>.</p>
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
