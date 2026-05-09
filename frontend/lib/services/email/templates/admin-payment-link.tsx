// lib/services/email/templates/admin-payment-link.tsx
// Payment link emails sent by admin to buyers.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEPOSIT_PAYMENT_LINK_SUBJECT =
  "Action Required — Complete Your $99 AutoLenis Deposit";

export const CONCIERGE_FEE_PAYMENT_LINK_SUBJECT =
  "Action Required — $400 Concierge Fee Due";

export interface DepositPaymentLinkEmailProps {
  firstName: string;
  checkoutUrl: string;
  appUrl?: string;
}

export interface ConciergeFeePaymentLinkEmailProps {
  firstName: string;
  checkoutUrl: string;
  appUrl?: string;
}

export function renderDepositPaymentLinkEmail({
  firstName,
  checkoutUrl,
  appUrl = "https://autolenis.com",
}: DepositPaymentLinkEmailProps): string {
  const prefsUrl = `${appUrl}/buyer/notifications/preferences`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Action Required — AutoLenis Deposit</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Action Required</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 16px 0;">Your AutoLenis specialist has sent you a secure payment link to complete your <strong>$99 Auction Access Deposit</strong>.</p>
              <p style="margin:0 0 16px 0;">Click the button below to pay securely through Stripe. This link expires in 24 hours.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td>
                    <a href="${checkoutUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Pay $99 Deposit Now &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#888888;">If you did not request this, please contact <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a>.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f8f8;padding:24px 40px;text-align:center;border-top:1px solid #F0F9FF;">
              <p style="margin:0;font-size:13px;color:#888888;">AutoLenis Inc. &middot; <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a></p>
              <p style="margin:4px 0 0 0;font-size:12px;color:#aaaaaa;">You received this because an AutoLenis specialist initiated a payment link on your behalf. <a href="${prefsUrl}" style="color:#aaaaaa;">Manage preferences</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderConciergeFeePaymentLinkEmail({
  firstName,
  checkoutUrl,
  appUrl = "https://autolenis.com",
}: ConciergeFeePaymentLinkEmailProps): string {
  const prefsUrl = `${appUrl}/buyer/notifications/preferences`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Action Required — AutoLenis Concierge Fee</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Action Required</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 16px 0;">Your AutoLenis specialist has sent you a secure payment link to complete your <strong>$499 Premium Concierge Fee</strong>.</p>
              <p style="margin:0 0 16px 0;">Your $99 deposit has been credited — <strong>$400 is due</strong>. Click the button below to pay securely.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td>
                    <a href="${checkoutUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Pay $400 Now &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#888888;">If you did not request this, please contact <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a>.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f8f8;padding:24px 40px;text-align:center;border-top:1px solid #F0F9FF;">
              <p style="margin:0;font-size:13px;color:#888888;">AutoLenis Inc. &middot; <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a></p>
              <p style="margin:4px 0 0 0;font-size:12px;color:#aaaaaa;">You received this because an AutoLenis specialist initiated a payment link on your behalf. <a href="${prefsUrl}" style="color:#aaaaaa;">Manage preferences</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
