// lib/services/esign/executed-contract.service.ts
//
// Program 4 e-sign completion (§4/§5) — generates the durable EXECUTED CONTRACT
// artifact for a COMPLETED buyer signature and uploads it to the private Supabase
// bucket "contracts" at executed/{dealId}/{envelopeId}.pdf.
//
// This is the artifact the buyer/dealer download as "your signed contract". It is
// generated from the FROZEN per-attempt evidence (pinned ContractVersion + hash +
// consent snapshot + adopted signature/identity) — never from live app data — so
// later profile/email/Deal/template/consent-copy changes cannot alter it. It is a
// SUPERSET of the original contract: it embeds the exact approved contract text
// (identified by its SHA-256 hash) plus the execution/consent/signature evidence.
// It deliberately OMITS raw IP / user-agent / internal forensic metadata (§11) —
// those live only in the admin-scoped evidence certificate, which this artifact
// references. It does NOT assert ESIGN/UETA legal sufficiency.
//
// Reuses existing infra only: pdfkit (certificate service), unpdf/extract-text
// (Contract Shield), the service Supabase client. No new dependency, no parallel
// storage/evidence system.

import { logger } from "@/lib/logger";
import { createHash } from "crypto";
import PDFDocument from "pdfkit";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { extractContractText } from "@/lib/services/contract-shield/extract-text";
import type { ConsentSnapshot } from "./consent-policy";

const STORAGE_BUCKET = "contracts";
const BRAND_BLUE = "#0B5FD1";
const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes

export interface ExecutedContractPayload {
  envelopeId: string;
  dealId: string;
  signerName: string;
  signerEmail: string;
  signerUserId: string;
  signerRole: string;
  documentVersionId: string;
  documentVersion: number;
  documentUrl: string; // source of the approved contract content
  documentHash: string;
  signatureText: string;
  signedAt: Date;
  consentedAt: Date;
  consentPolicyVersion: string | null;
  consentSnapshot: ConsentSnapshot | null;
  // Reference (not the contents) of the admin-scoped evidence certificate.
  certificateReference: string; // storage path or envelope id
}

export interface ExecutedContractResult {
  key: string;
  hash: string;
}

function formatUtc(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function buildExecutedPdf(payload: ExecutedContractPayload, contractText: string | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // Fix CreationDate/ModDate to the FROZEN signing timestamp so the artifact's
      // content is driven only by the frozen evidence (not wall-clock time). The
      // artifact is generated exactly once — the DB reference is written under a
      // null-only guard — so its stored hash is stable regardless of any residual
      // per-generation metadata (e.g. pdfkit's document /ID).
      const doc = new PDFDocument({
        size: "LETTER",
        margin: 56,
        info: { CreationDate: payload.signedAt, ModDate: payload.signedAt },
      });
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
        doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text(title);
        doc.moveDown(0.3);
      };

      // ── Execution cover ──
      doc.font("Helvetica-Bold").fontSize(24).fillColor(BRAND_BLUE).text("AutoLenis");
      doc.font("Helvetica").fontSize(13).fillColor("#111827").text("Executed Purchase Contract");
      doc.moveDown(0.4);
      doc.font("Helvetica").fontSize(8).fillColor("#6B7280").text(
        "This is the executed record of the purchase contract electronically signed " +
          "by the buyer within AutoLenis. It reproduces the approved contract that was " +
          "presented for signature (identified by the SHA-256 hash below) together with " +
          "the signer's adopted signature and consent record. It is not, by itself, a " +
          "determination of legal sufficiency.",
        { width: contentWidth },
      );
      rule();

      section("PARTIES");
      field("Buyer (Signer)", payload.signerName);
      field("Buyer Email", payload.signerEmail);
      field("Signer Role", payload.signerRole || "Buyer");
      field("Deal Reference", payload.dealId);

      section("SIGNED DOCUMENT IDENTITY");
      field("Contract Version ID", payload.documentVersionId);
      field("Contract Version", String(payload.documentVersion));
      field("Document Hash (SHA-256)", payload.documentHash);
      field("Evidence Certificate Reference", payload.certificateReference);

      section("EXECUTION");
      field("Adopted Signature", payload.signatureText);
      field("Signed At (UTC)", formatUtc(payload.signedAt));
      field("Consent Recorded At (UTC)", formatUtc(payload.consentedAt));
      field("Consent Policy Version", payload.consentPolicyVersion ?? "unversioned");

      // ── Consent record (exact acknowledgments) ──
      if (payload.consentSnapshot?.acknowledgments?.length) {
        section("CONSENT RECORD");
        doc.font("Helvetica").fontSize(8).fillColor("#6B7280").text(
          "The buyer affirmatively accepted each of the following acknowledgments before signing:",
          { width: contentWidth },
        );
        doc.moveDown(0.3);
        for (const ack of payload.consentSnapshot.acknowledgments) {
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827").text(`✓ ${ack.title}`);
          doc.font("Helvetica").fontSize(9).fillColor("#374151").text(ack.text, { width: contentWidth });
          doc.moveDown(0.3);
        }
      }

      rule();

      // ── Contract content ──
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text("PURCHASE CONTRACT (as signed)");
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(8).fillColor("#6B7280").text(
        `Contract version ${payload.documentVersion}. The exact bytes presented for signature are ` +
          `identified by SHA-256 hash ${payload.documentHash}. Any change to the contract produces a ` +
          "different hash, so this executed record cannot represent a signature of a modified document.",
        { width: contentWidth },
      );
      doc.moveDown(0.5);
      if (contractText) {
        doc.font("Helvetica").fontSize(9).fillColor("#111827").text(contractText, {
          width: contentWidth,
          align: "left",
        });
      } else {
        doc.font("Helvetica-Oblique").fontSize(9).fillColor("#374151").text(
          "The approved contract is a non-text (image-based) document and could not be reproduced as " +
            "extractable text here. It is identified and bound by the contract version and SHA-256 hash " +
            "above; the exact signed document is retained in AutoLenis document storage.",
          { width: contentWidth },
        );
      }

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Generate the executed-contract artifact from FROZEN attempt evidence and upload
 * it to the private "contracts" bucket. Returns { key, hash } on success (hash is
 * a SHA-256 over the generated artifact bytes, so the executed copy is itself
 * tamper-evident), or null on failure. Never throws (runs off the request path).
 * Content extraction failure is non-fatal — the artifact still binds the source by
 * hash + version.
 */
export async function generateAndUploadExecutedContract(
  payload: ExecutedContractPayload,
): Promise<ExecutedContractResult | null> {
  try {
    let contractText: string | null = null;
    try {
      contractText = await extractContractText(payload.documentUrl);
    } catch (err) {
      logger.warn("[executed-contract] contract text extraction failed (binding by hash only):", err);
    }

    const pdfBuffer = await buildExecutedPdf(payload, contractText);
    const hash = createHash("sha256").update(pdfBuffer).digest("hex");
    const storagePath = `executed/${payload.dealId}/${payload.envelopeId}.pdf`;
    const supabase = createServiceSupabaseClient();
    // upsert:FALSE — the executed artifact is immutable. A concurrent or prior
    // generation that already wrote this path must NEVER be overwritten (pdfkit
    // assigns a random document /ID per run, so re-uploaded bytes would differ and
    // the recorded hash would stop matching the stored file).
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: false });
    if (!error) {
      // We wrote the object → our in-memory bytes ARE the stored bytes.
      return { key: storagePath, hash };
    }
    // Upload failed. The overwhelmingly common cause is "already exists" (a
    // concurrent/prior generation won). Adopt the STORED object as authoritative
    // and derive the hash from ITS bytes, so the recorded hash always matches what
    // is actually stored. If we can't read it back, the write genuinely failed.
    const { data: existing, error: dlErr } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath);
    if (dlErr || !existing) {
      logger.error("[executed-contract] upload failed and stored artifact is unreadable:", error, dlErr);
      return null;
    }
    const storedBytes = new Uint8Array(await existing.arrayBuffer());
    const storedHash = createHash("sha256").update(Buffer.from(storedBytes)).digest("hex");
    return { key: storagePath, hash: storedHash };
  } catch (err) {
    logger.error("[executed-contract] generation failed:", err);
    return null;
  }
}

/** Time-limited signed URL for a stored executed contract. Never throws. */
export async function getExecutedContractUrl(
  storagePath: string,
  expirySeconds: number = DEFAULT_SIGNED_URL_EXPIRY_SECONDS,
): Promise<string | null> {
  try {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, expirySeconds);
    if (error || !data?.signedUrl) {
      logger.error("[executed-contract] signed URL failed:", error);
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    logger.error("[executed-contract] signed URL threw:", err);
    return null;
  }
}
