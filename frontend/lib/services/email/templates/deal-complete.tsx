// lib/services/email/templates/deal-complete.tsx
// Deal Complete / Congratulations — sent when deal status reaches COMPLETED / pickup confirmed.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEAL_COMPLETE_SUBJECT = (firstName: string) =>
  `Congratulations ${firstName} — your AutoLenis deal is complete!`;

export interface DealCompleteEmailProps {
  firstName: string;
  completionDate: string;
  referralCode: string;
  dashboardUrl: string;
  feedbackUrl: string;
  referralUrl: string;
  unsubscribeUrl: string;
}

export function renderDealCompleteEmail({
  firstName,
  completionDate,
  referralCode,
  dashboardUrl,
  feedbackUrl,
  referralUrl,
  unsubscribeUrl,
}: DealCompleteEmailProps): string {
  void referralCode; // included in referralUrl, kept for potential future use
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Congratulations — AutoLenis</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <!-- Header — green accent for congratulations -->
          <tr>
            <td style="background:#0B5FD1;padding:32px;text-align:center;">
              <p style="color:#ffffff;font-size:26px;font-weight:bold;margin:0;letter-spacing:-0.5px;">AutoLenis</p>
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Congratulations! 🎊</p>
            </td>
          </tr>
          <!-- Green checkmark accent -->
          <tr>
            <td style="background:#e8f5e9;padding:20px;text-align:center;border-bottom:3px solid #4caf50;">
              <p style="margin:0;font-size:18px;font-weight:bold;color:#1a6b18;">✓ Your AutoLenis deal is complete</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 16px 0;">Your AutoLenis deal is complete. Enjoy your new vehicle!</p>
              <!-- Summary box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="background:#f9f9f9;padding:14px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#555555;">
                      <tr>
                        <td style="padding:4px 0;">Deal completed</td>
                        <td style="padding:4px 0;text-align:right;font-weight:600;color:#333333;">${completionDate}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;">Status</td>
                        <td style="padding:4px 0;text-align:right;font-weight:600;color:#1a6b18;">Complete ✓</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
                <tr>
                  <td>
                    <a href="${dashboardUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      View Your Deal Summary &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Feedback -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;border-top:1px solid #eeeeee;padding-top:24px;">
                <tr>
                  <td>
                    <p style="margin:0 0 8px 0;font-weight:bold;color:#333333;">How did we do?</p>
                    <p style="margin:0 0 8px 0;font-size:14px;color:#555555;">We'd love to hear about your experience.</p>
                    <a href="${feedbackUrl}" style="font-size:14px;color:#0B5FD1;text-decoration:underline;">Leave feedback &#8594;</a>
                  </td>
                </tr>
              </table>
              <!-- Referral -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FB;border-radius:6px;padding:16px 20px;">
                <tr>
                  <td>
                    <p style="margin:0 0 8px 0;font-weight:bold;color:#333333;">Refer a friend</p>
                    <p style="margin:0 0 8px 0;font-size:14px;color:#555555;">Know someone who needs a car? Share your referral link and earn 15% when they complete a deal.</p>
                    <a href="${referralUrl}" style="font-size:14px;color:#0B5FD1;text-decoration:underline;word-break:break-all;">${referralUrl}</a>
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
              <p style="margin:8px 0 0 0;font-size:12px;color:#aaaaaa;"><a href="${unsubscribeUrl}" style="color:#aaaaaa;">Unsubscribe</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
