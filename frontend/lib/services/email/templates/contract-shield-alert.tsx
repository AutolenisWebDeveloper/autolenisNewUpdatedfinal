// lib/services/email/templates/contract-shield-alert.tsx
// Contract Shield Alert — sent when Contract Shield scan returns FAIL or WARNING.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const CONTRACT_SHIELD_ALERT_SUBJECT =
  "Action needed — your contract has issues that need fixing";

export interface ContractShieldAlertEmailProps {
  firstName: string;
  issueCount: number;
  contractUrl: string;
}

export function renderContractShieldAlertEmail({
  firstName,
  issueCount,
  contractUrl,
}: ContractShieldAlertEmailProps): string {
  const issuePlural = issueCount === 1 ? "issue" : "issues";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Contract Review — Action Required</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Contract Review — Action Required ⚠️</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 16px 0;">AutoLenis Contract Shield has reviewed your dealer contract and found ${issueCount} ${issuePlural} that need to be resolved before you can proceed.</p>
              <!-- Issue summary box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="background:#fff3cd;border-left:4px solid #e0a100;padding:16px 20px;border-radius:4px;text-align:center;">
                    <p style="margin:0;font-size:24px;font-weight:bold;color:#7a5800;">${issueCount}</p>
                    <p style="margin:4px 0 0 0;font-size:14px;font-weight:600;color:#7a5800;">${issueCount === 1 ? "Issue" : "Issues"} Found</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px 0;color:#555555;">We've sent the fix list to your dealer. Once they correct the ${issuePlural} and resubmit, we'll notify you immediately.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <a href="${contractUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      View Contract Status &#8594;
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
