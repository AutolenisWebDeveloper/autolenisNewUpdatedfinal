// lib/services/email/templates/deposit-confirmation.tsx
// Deposit Confirmation — sent when Stripe checkout.session.completed fires for a deposit.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

import { DEPOSIT_AMOUNT_CENTS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";

// Receipts show two-decimal currency to match Stripe receipt formatting.
const DEPOSIT_USD_WITH_CENTS = `$${(DEPOSIT_AMOUNT_CENTS / 100).toFixed(2)}`;

export const DEPOSIT_CONFIRMATION_SUBJECT = `Your ${DEPOSIT_AMOUNT_USD} AutoLenis Auction Access Fee is confirmed`;

export interface DepositConfirmationEmailProps {
  firstName: string;
  depositId: string;
  depositDate: string;
  auctionsUrl: string;
}

export function renderDepositConfirmationEmail({
  firstName,
  depositId,
  depositDate,
  auctionsUrl,
}: DepositConfirmationEmailProps): string {
  const ref = depositId.slice(-8).toUpperCase();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Auction Access Fee Confirmed — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Auction Access Fee Confirmed ✓</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 16px 0;">Your ${DEPOSIT_AMOUNT_USD} Limited-Time Auction Access Fee has been received. Your private auction is now active — dealers are being invited to compete for your business.</p>
              <!-- Receipt box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="background:#f9f9f9;padding:16px 20px;">
                    <p style="margin:0 0 12px 0;font-weight:bold;color:#333333;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Payment Receipt</p>
                    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#555555;">
                      <tr>
                        <td style="padding:4px 0;">Amount</td>
                        <td style="padding:4px 0;text-align:right;font-weight:600;color:#333333;">${DEPOSIT_USD_WITH_CENTS}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;">Status</td>
                        <td style="padding:4px 0;text-align:right;font-weight:600;color:#1a6b18;">Confirmed</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;">Date</td>
                        <td style="padding:4px 0;text-align:right;">${depositDate}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;">Reference</td>
                        <td style="padding:4px 0;text-align:right;font-family:monospace;">${ref}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- Refund disclosure -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="background:#F8F9FB;border-left:4px solid #0B5FD1;padding:14px 18px;border-radius:4px;">
                    <p style="margin:0;font-size:13px;color:#555555;line-height:1.6;">
                      If no valuable offer is received, <strong>you can request a refund of your ${DEPOSIT_AMOUNT_USD} Auction Access Fee — our team reviews every request</strong>. Otherwise it is credited toward your AutoLenis concierge fee when your deal closes.
                    </p>
                  </td>
                </tr>
              </table>
              <!-- What happens next -->
              <p style="margin:0 0 12px 0;font-weight:bold;color:#333333;">What happens next</p>
              <p style="margin:0 0 20px 0;color:#555555;font-size:14px;">Dealers have 48 hours to submit competitive offers. You'll receive an email as soon as your options are ready.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <a href="${auctionsUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      View Your Auction &#8594;
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
