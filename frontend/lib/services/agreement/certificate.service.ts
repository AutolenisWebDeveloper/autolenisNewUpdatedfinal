// lib/services/agreement/certificate.service.ts
//
// Generates the tamper-evident Electronic Signature Certificate PDF for a
// signed dealer network participation agreement and uploads it to the private
// Supabase Storage bucket "legal-documents".
//
// Both exports are defensive: generateAndUploadCertificate runs inside after()
// (Next.js post-response work) and MUST NOT throw or it would crash the worker.
// On any failure it logs and returns null.

import { logger } from "@/lib/logger";
import PDFDocument from "pdfkit";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { DEALER_AGREEMENT_TEXT } from "@/lib/constants/dealer-agreement";

const STORAGE_BUCKET = "legal-documents";
const BRAND_BLUE = "#0B5FD1";
const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes

export interface CertificatePayload {
  signatureId: string;
  dealerId: string;
  signerName: string;
  signerEmail: string;
  dealershipName: string;
  ipAddress: string;
  userAgent: string;
  signedAt: Date;
  agreementVersion: string;
  agreementHash: string;
}

// Format a Date as "YYYY-MM-DD HH:MM:SS UTC".
function formatUtc(date: Date): string {
  const iso = date.toISOString(); // 2026-06-07T13:45:09.123Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

// Render the certificate to an in-memory Buffer.
function buildCertificatePdf(payload: CertificatePayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "LETTER", margin: 56 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const rule = () => {
        doc.moveDown(0.6);
        doc
          .strokeColor("#D1D5DB")
          .lineWidth(1)
          .moveTo(doc.page.margins.left, doc.y)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y)
          .stroke();
        doc.moveDown(0.6);
      };
      const field = (label: string, value: string) => {
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor("#374151")
          .text(`${label}: `, { continued: true });
        doc.font("Helvetica").fillColor("#111827").text(value);
        doc.moveDown(0.2);
      };
      const section = (title: string) => {
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(title);
        doc.moveDown(0.3);
      };

      // 1. Header
      doc.font("Helvetica-Bold").fontSize(24).fillColor(BRAND_BLUE).text("AutoLenis");
      doc
        .font("Helvetica")
        .fontSize(13)
        .fillColor("#111827")
        .text("Electronic Signature Certificate");

      // 2. Legal basis line
      doc.moveDown(0.4);
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#6B7280")
        .text(
          "This certificate evidences an electronic signature executed under the " +
            "U.S. ESIGN Act (15 U.S.C. § 7001) and the Uniform Electronic " +
            "Transactions Act (UETA), as adopted in Texas.",
          { width: contentWidth },
        );

      // 3. Horizontal rule
      rule();

      // 4. Signer information
      section("SIGNER INFORMATION");
      field("Signer Name", payload.signerName);
      field("Signer Email", payload.signerEmail);
      field("Dealership", payload.dealershipName);
      field("Dealer Record ID", payload.dealerId);

      // 5. Signature event
      section("SIGNATURE EVENT");
      field("Date & Time (UTC)", formatUtc(payload.signedAt));
      field("IP Address", payload.ipAddress);
      field("Browser / User Agent", payload.userAgent.slice(0, 120));
      field("Agreement Version", payload.agreementVersion);
      field("Document Hash (SHA-256)", payload.agreementHash);
      field("Signature Record ID", payload.signatureId);
      field("Signature Method", "Authenticated click-wrap — ESIGN Act compliant");
      field(
        "Electronic Consent",
        "Dealer affirmatively consented to electronic execution prior to signing",
      );

      // 6. Horizontal rule
      rule();

      // 7. Full text of agreement signed
      section("FULL TEXT OF AGREEMENT SIGNED");
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#1F2937")
        .text(DEALER_AGREEMENT_TEXT, { width: contentWidth, align: "left" });

      // 8. Horizontal rule
      rule();

      // 9. Footer
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#6B7280")
        .text(
          "AutoLenis, LLC · 5830 Granite Parkway, Suite 100-356 · Plano, TX 75024 · support@autolenis.com",
          { width: contentWidth },
        );
      doc.moveDown(0.3);
      doc
        .font("Helvetica-Oblique")
        .fontSize(7)
        .fillColor("#9CA3AF")
        .text(
          "This certificate is a system-generated record of an electronic " +
            "signature event and is retained as part of the AutoLenis legal " +
            "records. The document hash above can be used to verify the exact " +
            "agreement text that was signed.",
          { width: contentWidth },
        );

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Builds the certificate PDF and uploads it to the private "legal-documents"
 * bucket at dealer-agreements/{dealerId}/{signatureId}.pdf.
 * Returns the storage PATH on success, null on failure. Never returns a URL,
 * and never throws.
 */
export async function generateAndUploadCertificate(
  payload: CertificatePayload,
): Promise<string | null> {
  try {
    const pdfBuffer = await buildCertificatePdf(payload);
    const storagePath = `dealer-agreements/${payload.dealerId}/${payload.signatureId}.pdf`;

    const supabase = createServiceSupabaseClient();
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (error) {
      logger.error("[agreement/certificate] Upload failed:", error);
      return null;
    }

    return storagePath;
  } catch (err) {
    logger.error("[agreement/certificate] Certificate generation failed:", err);
    return null;
  }
}

/**
 * Creates a time-limited signed URL for a stored certificate.
 * Returns the signed URL string, or null on failure. Never throws.
 */
export async function getSignedCertificateUrl(
  storagePath: string,
  expirySeconds: number = DEFAULT_SIGNED_URL_EXPIRY_SECONDS,
): Promise<string | null> {
  try {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, expirySeconds);

    if (error || !data?.signedUrl) {
      logger.error("[agreement/certificate] Signed URL generation failed:", error);
      return null;
    }

    return data.signedUrl;
  } catch (err) {
    logger.error("[agreement/certificate] Signed URL generation threw:", err);
    return null;
  }
}
