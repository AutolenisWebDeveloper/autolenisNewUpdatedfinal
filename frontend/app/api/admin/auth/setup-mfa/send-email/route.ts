import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  verifyPreMfaToken,
  generateMfaEmailToken,
  MFA_EMAIL_TOKEN_TTL_MS,
  ADMIN_PREMFA_COOKIE,
} from "@/lib/admin-auth";
import { Resend } from "resend";

const RATE_LIMIT_MS = 60_000; // Minimum 60 seconds between email sends

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.includes("placeholder")) return null;
  return new Resend(key);
}

function renderMfaConfirmationEmail(params: {
  adminEmail: string;
  confirmUrl: string;
  expiresMinutes: number;
}): string {
  const { adminEmail, confirmUrl, expiresMinutes } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirm MFA Setup — AutoLenis Admin</title>
</head>
<body style="margin:0;padding:0;background:#F9F5FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #EAE0F5;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:#643293;padding:28px 32px;">
            <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">AutoLenis Admin</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Security notification</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 12px;color:#1A0833;font-size:18px;font-weight:700;">Confirm Google Authenticator Setup</h2>
            <p style="margin:0 0 20px;color:#5C4580;font-size:14px;line-height:1.6;">
              A request was made to set up Google Authenticator for your AutoLenis admin account
              (<strong>${adminEmail}</strong>).
            </p>
            <p style="margin:0 0 20px;color:#5C4580;font-size:14px;line-height:1.6;">
              Your email and password remain unchanged. Click the button below to confirm and
              continue with Google Authenticator enrollment.
            </p>
            <p style="margin:0 0 24px;color:#5C4580;font-size:14px;line-height:1.6;">
              This link expires in <strong>${expiresMinutes} minutes</strong> and can only be used once.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="background:#643293;border-radius:10px;padding:14px 28px;">
                  <a href="${confirmUrl}" style="color:#fff;font-weight:700;font-size:15px;text-decoration:none;display:block;">
                    Confirm MFA Setup →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;color:#9A85B8;font-size:12px;line-height:1.5;">
              If you did not request this, someone may have your admin password.
              Contact the platform owner immediately and do not click the link.
            </p>
            <p style="margin:0;color:#9A85B8;font-size:12px;">
              If the button doesn't work, copy this URL:<br/>
              <span style="word-break:break-all;color:#643293;">${confirmUrl}</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #EAE0F5;">
            <p style="margin:0;color:#9A85B8;font-size:11px;">
              AutoLenis Admin &bull; This is an automated security email &bull; Do not reply
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// POST /api/admin/auth/setup-mfa/send-email
// Sends a one-time email confirmation link to the admin's email before showing the QR code.
// Requires a valid pre-MFA session cookie (admin has completed password auth).
// Rate-limited: one email per 60 seconds per admin.
export async function POST(request: NextRequest) {
  void request;
  try {
    const cookieStore = await cookies();
    const preMfaToken = cookieStore.get(ADMIN_PREMFA_COOKIE)?.value;
    if (!preMfaToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const payload = await verifyPreMfaToken(preMfaToken);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    const admin = await prisma.admin.findUnique({
      where: { id: payload.adminId },
      include: { user: true },
    });
    if (!admin) {
      return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    }

    // If MFA is already enrolled, this endpoint is not applicable
    if (admin.totpEnabled) {
      return NextResponse.json(
        { error: "MFA already enrolled. Use /admin/security/mfa to manage." },
        { status: 400 }
      );
    }

    // Rate limit: check if a recent (< 60s) unused token already exists
    const recentToken = await prisma.adminMfaEmailToken.findFirst({
      where: {
        adminId: admin.id,
        usedAt: null,
        createdAt: { gt: new Date(Date.now() - RATE_LIMIT_MS) },
      },
    });
    if (recentToken) {
      return NextResponse.json(
        { error: "A confirmation email was sent recently. Please wait before requesting another." },
        { status: 429 }
      );
    }

    // Invalidate any previous unused tokens for this admin
    await prisma.adminMfaEmailToken.updateMany({
      where: { adminId: admin.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Generate a new single-use token
    const { plain, hash } = generateMfaEmailToken();
    const expiresAt = new Date(Date.now() + MFA_EMAIL_TOKEN_TTL_MS);

    await prisma.adminMfaEmailToken.create({
      data: {
        adminId: admin.id,
        tokenHash: hash,
        expiresAt,
      },
    });

    // Build the confirmation URL
    const appUrl =
      (process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ?? "https://autolenis.com");
    const confirmUrl = `${appUrl}/admin/auth/setup-mfa?emailToken=${plain}`;
    const expiresMinutes = Math.round(MFA_EMAIL_TOKEN_TTL_MS / 60_000);

    // Send the email
    const resend = getResend();
    if (resend) {
      await resend.emails.send({
        from: `AutoLenis <noreply@autolenis.com>`,
        to: admin.user.email,
        subject: "Confirm Google Authenticator Setup — AutoLenis Admin",
        html: renderMfaConfirmationEmail({
          adminEmail: admin.user.email,
          confirmUrl,
          expiresMinutes,
        }),
      });
    } else {
      // Development — log the confirmation URL to console
      logger.info(
        `[EMAIL DEV] MFA confirmation for ${admin.user.email}: ${confirmUrl}`
      );
    }

    return NextResponse.json({ sent: true, emailSentTo: admin.user.email });
  } catch (err) {
    logger.error("[setup-mfa/send-email] Error:", err);
    return NextResponse.json(
      { error: "Failed to send confirmation email. Please try again." },
      { status: 500 }
    );
  }
}
