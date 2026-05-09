// lib/services/email/templates/contract-approved.tsx
// Contract Approved — sent when Contract Shield returns PASS and deal moves to SIGNING_PENDING.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const CONTRACT_APPROVED_SUBJECT = "Your contract is approved — ready to sign";

export interface ContractApprovedEmailProps {
  firstName: string;
  signUrl: string;
}

export function renderContractApprovedEmail({
  firstName,
  signUrl,
}: ContractApprovedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Contract Approved — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Contract Approved ✓</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 16px 0;">AutoLenis Contract Shield has reviewed your dealer contract and everything looks good. You're now ready to sign.</p>
              <!-- What was checked -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="background:#f9f9f9;padding:16px 20px;">
                    <p style="margin:0 0 12px 0;font-weight:bold;color:#333333;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">What Contract Shield Verified</p>
                    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#555555;">
                      <tr>
                        <td style="padding:5px 0;vertical-align:top;width:20px;color:#1a6b18;font-weight:bold;">&#10003;</td>
                        <td style="padding:5px 0;">APR accuracy</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 0;vertical-align:top;width:20px;color:#1a6b18;font-weight:bold;">&#10003;</td>
                        <td style="padding:5px 0;">Payment math</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 0;vertical-align:top;width:20px;color:#1a6b18;font-weight:bold;">&#10003;</td>
                        <td style="padding:5px 0;">OTD price integrity</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 0;vertical-align:top;width:20px;color:#1a6b18;font-weight:bold;">&#10003;</td>
                        <td style="padding:5px 0;">No junk fees</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 0;vertical-align:top;width:20px;color:#1a6b18;font-weight:bold;">&#10003;</td>
                        <td style="padding:5px 0;">All required disclosures present</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <a href="${signUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Sign My Documents &#8594;
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
