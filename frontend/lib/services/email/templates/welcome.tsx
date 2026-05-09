// lib/services/email/templates/welcome.tsx
// Welcome / Email Verification — sent at buyer sign-up.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const WELCOME_EMAIL_SUBJECT = (firstName: string) =>
  `Welcome to AutoLenis, ${firstName} — Verify Your Email`;

export interface WelcomeEmailProps {
  firstName: string;
  verificationUrl: string;
}

export function renderWelcomeEmail({ firstName, verificationUrl }: WelcomeEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to AutoLenis — Verify Your Email</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Welcome to AutoLenis</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 16px 0;">Thanks for joining AutoLenis. You're one step away from accessing the smartest way to buy a car.</p>
              <p style="margin:0 0 24px 0;">Please verify your email address to activate your account.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${verificationUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Verify My Email &#8594;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 32px 0;font-size:13px;color:#888888;">This link expires in 24 hours. If you did not create an account, you can safely ignore this email.</p>
              <!-- What happens next -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eeeeee;padding-top:24px;margin-top:8px;">
                <tr>
                  <td>
                    <p style="margin:0 0 16px 0;font-weight:bold;color:#333333;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">What happens next</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;width:28px;">
                          <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">1</span>
                        </td>
                        <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                          <strong>Verify</strong> your email address using the button above.
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;width:28px;">
                          <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">2</span>
                        </td>
                        <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                          <strong>Prequalify</strong> with a soft credit check — no impact to your score.
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;width:28px;">
                          <span style="display:inline-block;background:#0B5FD1;color:#ffffff;border-radius:50%;width:20px;height:20px;text-align:center;font-size:12px;font-weight:bold;line-height:20px;">3</span>
                        </td>
                        <td style="padding:8px 0;color:#555555;font-size:14px;line-height:1.5;">
                          <strong>Browse &amp; Buy</strong> — dealers compete in a private 48-hour auction for your business.
                        </td>
                      </tr>
                    </table>
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
