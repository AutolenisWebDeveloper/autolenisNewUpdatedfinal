// lib/services/email/templates/deal-selected.tsx
// Deal Selected — sent when buyer selects a deal from the Best Price Engine.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEAL_SELECTED_SUBJECT = (firstName: string) =>
  `Deal confirmed — here's what happens next, ${firstName}`;

export interface DealSelectedEmailProps {
  firstName: string;
  dashboardUrl: string;
}

export function renderDealSelectedEmail({
  firstName,
  dashboardUrl,
}: DealSelectedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Deal Confirmed — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Deal Confirmed ✓</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 24px 0;">You've selected your deal. Here's what happens next to complete your purchase.</p>
              <!-- Next steps checklist -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="background:#f9f9f9;padding:16px 20px;">
                    <p style="margin:0 0 14px 0;font-weight:bold;color:#333333;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Your Next Steps</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:7px 0;vertical-align:top;width:28px;">
                          <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">1</span>
                        </td>
                        <td style="padding:7px 0;font-size:14px;color:#333333;line-height:1.5;">
                          <strong>Financing</strong> — confirm your financing choice
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;vertical-align:top;width:28px;">
                          <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">2</span>
                        </td>
                        <td style="padding:7px 0;font-size:14px;color:#333333;line-height:1.5;">
                          <strong>Concierge Fee</strong> — resolve your AutoLenis service fee
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;vertical-align:top;width:28px;">
                          <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">3</span>
                        </td>
                        <td style="padding:7px 0;font-size:14px;color:#333333;line-height:1.5;">
                          <strong>Insurance</strong> — provide proof of insurance
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;vertical-align:top;width:28px;">
                          <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">4</span>
                        </td>
                        <td style="padding:7px 0;font-size:14px;color:#333333;line-height:1.5;">
                          <strong>Contract Review</strong> — AutoLenis Contract Shield reviews your contract
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;vertical-align:top;width:28px;">
                          <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">5</span>
                        </td>
                        <td style="padding:7px 0;font-size:14px;color:#333333;line-height:1.5;">
                          <strong>E-Sign</strong> — sign your documents digitally
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;vertical-align:top;width:28px;">
                          <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">6</span>
                        </td>
                        <td style="padding:7px 0;font-size:14px;color:#333333;line-height:1.5;">
                          <strong>Pickup</strong> — schedule your vehicle pickup
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <a href="${dashboardUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Continue Your Deal &#8594;
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
