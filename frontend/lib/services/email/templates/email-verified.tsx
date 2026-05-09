// lib/services/email/templates/email-verified.tsx
// Email Verification Confirmation — sent after buyer clicks verification link and it succeeds.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const EMAIL_VERIFIED_SUBJECT = (firstName: string) =>
  `Your email is verified — let's get started, ${firstName}`;

export interface EmailVerifiedProps {
  firstName: string;
  prequalUrl: string;
}

export function renderEmailVerifiedEmail({ firstName, prequalUrl }: EmailVerifiedProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Email Is Verified — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">You're Verified ✓</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 16px 0;">Your email has been verified. You're now ready to check your buying power.</p>
              <p style="margin:0 0 24px 0;">Complete your pre-qualification in under 3 minutes — it's a soft pull only and won't affect your credit score.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${prequalUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Check My Buying Power &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Trust strip -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="background:#F8F9FB;padding:14px 20px;text-align:center;">
                    <p style="margin:0;font-size:13px;color:#0B5FD1;font-weight:600;">
                      Soft pull only &nbsp;&bull;&nbsp; No credit score impact &nbsp;&bull;&nbsp; Results in 60 seconds
                    </p>
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
