// lib/services/email/dealer-agreement-confirmation.service.ts
//
// Sends the dealer their executed-copy confirmation email after an in-house
// electronic signature of the dealer network participation agreement.
//
// This runs inside after() (Next.js post-response work) so it MUST NOT throw —
// on any failure it logs and returns { success: false }.

import { Resend } from "resend";

const FROM = "AutoLenis Agreements <agreements@autolenis.com>";
const BRAND_BLUE = "#0B5FD1";
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

export interface DealerAgreementConfirmationParams {
  signatureId: string;
  contactName: string;
  dealershipName: string;
  email: string;
  pdfSignedUrl: string | null; // temporary signed URL for email
  signedAt: Date;
  agreementVersion: string;
}

// Lazy Resend client — keeps `next build` page-data collection from throwing
// when RESEND_API_KEY isn't in scope.
let resendInstance: Resend | null = null;
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) return null;
  if (!resendInstance) resendInstance = new Resend(apiKey);
  return resendInstance;
}

// Format a Date as "YYYY-MM-DD HH:MM:SS UTC".
function formatUtc(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function renderHtml(params: DealerAgreementConfirmationParams): string {
  const signedDate = formatUtc(params.signedAt);
  const settingsUrl = `${APP_URL}/dealer/dashboard`;

  const downloadBlock = params.pdfSignedUrl
    ? `
        <div style="text-align:center;margin:28px 0">
          <a href="${params.pdfSignedUrl}" style="display:inline-block;background:${BRAND_BLUE};color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Download Signed Certificate (PDF)</a>
        </div>
        <p style="color:#6B7280;font-size:12px;text-align:center">This download link is valid for 24 hours. Your certificate is also always available in your dealer dashboard under <strong>Settings → Agreement</strong>.</p>`
    : `
        <p style="background:#F8F9FB;border-left:3px solid ${BRAND_BLUE};padding:12px 16px;margin:20px 0;color:#4B5563;font-size:13px">Your signed certificate is being generated and will be available in your dealer dashboard within a few minutes.</p>`;

  return `
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff">
      <div style="background:${BRAND_BLUE};padding:32px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:22px">AutoLenis</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">Dealer Agreement — Executed Copy</p>
      </div>
      <div style="padding:32px;color:#1f2937;line-height:1.7;font-size:14px">
        <p>Hi ${params.contactName},</p>
        <p>Your <strong>AutoLenis Dealer Network Participation Agreement</strong> for <strong>${params.dealershipName}</strong> has been electronically executed. A copy of the signed agreement is below.</p>

        <div style="background:#F8F9FB;border:1px solid #E5E7EB;border-radius:8px;padding:20px;margin:24px 0">
          <p style="margin:0 0 12px;color:#111827;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Signature Record</p>
          <p style="margin:0 0 6px;color:#4B5563;font-size:13px"><strong style="color:#111827">Signed by:</strong> ${params.contactName} &lt;${params.email}&gt;</p>
          <p style="margin:0 0 6px;color:#4B5563;font-size:13px"><strong style="color:#111827">Date:</strong> ${signedDate}</p>
          <p style="margin:0 0 6px;color:#4B5563;font-size:13px"><strong style="color:#111827">Agreement Version:</strong> ${params.agreementVersion}</p>
          <p style="margin:0;color:#4B5563;font-size:13px"><strong style="color:#111827">Certificate ID:</strong> ${params.signatureId}</p>
        </div>

        ${downloadBlock}

        <p style="background:#F8F9FB;border-left:3px solid ${BRAND_BLUE};padding:12px 16px;margin:24px 0;color:#4B5563;font-size:12px">This agreement was executed using an authenticated electronic signature and is legally binding under the U.S. ESIGN Act (15 U.S.C. § 7001) and the Uniform Electronic Transactions Act (UETA).</p>

        <p>Welcome to the AutoLenis dealer network — we're glad to have ${params.dealershipName} on board.</p>

        <a href="${settingsUrl}" style="display:inline-block;color:${BRAND_BLUE};text-decoration:none;font-weight:600;font-size:13px">Go to your dealer dashboard →</a>

        <p style="margin-top:32px;color:#94A3B8;font-size:12px">AutoLenis, LLC · 5830 Granite Parkway, Suite 100-356 · Plano, TX 75024 · <a href="mailto:support@autolenis.com" style="color:#94A3B8">support@autolenis.com</a></p>
      </div>
    </div>
  `;
}

/**
 * Sends the executed-copy confirmation email. Returns the Resend message id on
 * success. Never throws.
 */
export async function sendDealerAgreementConfirmation(
  params: DealerAgreementConfirmationParams,
): Promise<{ success: boolean; messageId?: string }> {
  try {
    const resend = getResend();
    if (!resend) {
      console.warn(
        `[dealer-agreement-confirmation] RESEND_API_KEY not set or placeholder — email skipped. To: ${params.email}`,
      );
      return { success: false };
    }

    const result = await resend.emails.send({
      from: FROM,
      to: params.email,
      subject: "Your AutoLenis Dealer Agreement — Executed Copy",
      html: renderHtml(params),
    });

    if (result.error || !result.data?.id) {
      console.error(
        `[dealer-agreement-confirmation] Resend dispatch failed for ${params.email}:`,
        result.error ?? "no id returned",
      );
      return { success: false };
    }

    return { success: true, messageId: result.data.id };
  } catch (err) {
    console.error("[dealer-agreement-confirmation] Send threw:", err);
    return { success: false };
  }
}
