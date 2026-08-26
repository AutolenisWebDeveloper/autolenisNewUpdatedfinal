// lib/services/esign/buyer-contract-certificate.service.ts
//
// Generates the tamper-evident electronic-signature evidence certificate PDF for
// a buyer's in-house purchase-contract signature and uploads it to the private
// Supabase Storage bucket "legal-documents". This mirrors the dealer-agreement
// certificate service (the established in-house pattern) but is adapted for the
// per-deal buyer contract: it certifies the SHA-256 hash of the exact document
// presented for signature, not a static agreement text.
//
// TRUTHFULNESS: this is an engineering evidence artifact. It records the facts
// AutoLenis actually captured (authenticated signer, affirmative consent, IP,
// user-agent, server timestamps, document hash). It deliberately does NOT assert
// ESIGN/UETA legal sufficiency or court-admissibility — that is a legal
// determination outside this system.
//
// Both exports are defensive: generation runs inside after() and MUST NOT throw.

import { logger } from "@/lib/logger";
import PDFDocument from "pdfkit";
import { createServiceSupabaseClient } from "@/lib/supabase";

const STORAGE_BUCKET = "legal-documents";
const BRAND_BLUE = "#0B5FD1";
const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes

export interface BuyerContractCertificatePayload {
  envelopeId: string;
  dealId: string;
  signerName: string;
  signerEmail: string;
  signerUserId: string;
  documentVersionId: string;
  documentVersion: number;
  documentHash: string;
  consentedAt: Date;
  signedAt: Date;
  ipAddress: string;
  userAgent: string;
}

function formatUtc(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function buildCertificatePdf(payload: BuyerContractCertificatePayload): Promise<Buffer> {
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
        doc.strokeColor("#D1D5DB").lineWidth(1)
          .moveTo(doc.page.margins.left, doc.y)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
        doc.moveDown(0.6);
      };
      const field = (label: string, value: string) => {
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151").text(`${label}: `, { continued: true });
        doc.font("Helvetica").fillColor("#111827").text(value);
        doc.moveDown(0.2);
      };
      const section = (title: string) => {
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(title);
        doc.moveDown(0.3);
      };

      doc.font("Helvetica-Bold").fontSize(24).fillColor(BRAND_BLUE).text("AutoLenis");
      doc.font("Helvetica").fontSize(13).fillColor("#111827").text("Electronic Signature Evidence Certificate");

      doc.moveDown(0.4);
      doc.font("Helvetica").fontSize(8).fillColor("#6B7280").text(
        "This certificate is a system-generated record of an electronic signature " +
          "executed within AutoLenis. It documents the evidence captured at signing. " +
          "It is not, by itself, a determination of legal sufficiency.",
        { width: contentWidth },
      );

      rule();

      section("SIGNER INFORMATION");
      field("Signer Name", payload.signerName);
      field("Signer Email", payload.signerEmail);
      field("Signer Role", "Buyer");
      field("Authenticated Account ID", payload.signerUserId);
      field("Deal Reference", payload.dealId);

      section("SIGNED DOCUMENT");
      field("Contract Version ID", payload.documentVersionId);
      field("Contract Version", String(payload.documentVersion));
      field("Document Hash (SHA-256)", payload.documentHash);

      section("SIGNATURE EVENT");
      field("Electronic Consent At (UTC)", formatUtc(payload.consentedAt));
      field("Signed At (UTC)", formatUtc(payload.signedAt));
      field("IP Address", payload.ipAddress);
      field("Browser / User Agent", payload.userAgent.slice(0, 120));
      field("Signature Record ID", payload.envelopeId);
      field("Signature Method", "Authenticated in-app adoption with affirmative electronic consent");

      rule();

      doc.font("Helvetica").fontSize(8).fillColor("#6B7280").text(
        "AutoLenis, LLC · 5830 Granite Parkway, Suite 100-356 · Plano, TX 75024 · support@autolenis.com",
        { width: contentWidth },
      );
      doc.moveDown(0.3);
      doc.font("Helvetica-Oblique").fontSize(7).fillColor("#9CA3AF").text(
        "The document hash above identifies the exact contract version that was " +
          "presented and signed. Any change to the contract produces a different " +
          "hash, so this record cannot be represented as a signature of a modified document.",
        { width: contentWidth },
      );

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Builds the buyer-contract evidence certificate and uploads it to the private
 * "legal-documents" bucket at buyer-contracts/{dealId}/{envelopeId}.pdf.
 * Returns the storage PATH on success, null on failure. Never throws, never
 * returns a URL.
 */
export async function generateAndUploadBuyerContractCertificate(
  payload: BuyerContractCertificatePayload,
): Promise<string | null> {
  try {
    const pdfBuffer = await buildCertificatePdf(payload);
    const storagePath = `buyer-contracts/${payload.dealId}/${payload.envelopeId}.pdf`;
    const supabase = createServiceSupabaseClient();
    // upsert:FALSE — the evidence certificate is immutable. If a concurrent/prior
    // generation already wrote this path, adopt it rather than overwriting.
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: false });
    if (!error) return storagePath;
    // Upload failed — if the object already exists, treat it as authoritative.
    const { data: existing } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath);
    if (existing) return storagePath;
    logger.error("[buyer-contract-certificate] upload failed:", error);
    return null;
  } catch (err) {
    logger.error("[buyer-contract-certificate] generation failed:", err);
    return null;
  }
}

/** Time-limited signed URL for a stored buyer-contract certificate. Never throws. */
export async function getBuyerContractCertificateUrl(
  storagePath: string,
  expirySeconds: number = DEFAULT_SIGNED_URL_EXPIRY_SECONDS,
): Promise<string | null> {
  try {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, expirySeconds);
    if (error || !data?.signedUrl) {
      logger.error("[buyer-contract-certificate] signed URL failed:", error);
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    logger.error("[buyer-contract-certificate] signed URL threw:", err);
    return null;
  }
}
