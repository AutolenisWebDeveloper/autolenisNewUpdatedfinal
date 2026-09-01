// lib/services/contract-shield/extract-text.ts
// Contract Shield — resolve a stored contract document to its plain text so the
// junk-fee scanner runs on the REAL contract, not a placeholder. Contracts are
// uploaded to the private Supabase bucket "dealer-contracts" and persisted on
// ContractVersion.documentUrl as a bare storage path (see
// app/api/dealer/contracts/upload-file/route.ts); older/manual rows may hold a
// full http(s) URL. Both shapes are supported.

import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { fetchAllowedContract } from "@/lib/security/safe-fetch";

const CONTRACT_BUCKET = "dealer-contracts";

/** Fetch the raw PDF bytes for a documentUrl (http URL or Supabase storage path).
 * Exported so the in-house signing flow hashes the EXACT bytes Contract Shield
 * scanned/approved (one source of truth for the signed document). */
export async function loadContractPdfBytes(documentUrl: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(documentUrl)) {
    // SSRF guard: documentUrl can originate from a dealer-supplied field on
    // POST /api/dealer/contracts/upload. fetchAllowedContract enforces https,
    // an allowlisted storage host, no IP literals, and no redirects. The
    // Supabase storage-path branch below remains the preferred path.
    const res = await fetchAllowedContract(documentUrl);
    if (!res.ok) throw new Error(`Contract fetch failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  const { createServiceSupabaseClient } = await import("@/lib/supabase");
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.storage.from(CONTRACT_BUCKET).download(documentUrl);
  if (error || !data) throw new Error(`Contract download failed: ${error?.message ?? "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Extract the text of the contract PDF at documentUrl. Throws when the document
 * can't be fetched or parsed — callers MUST treat a throw as "scan could not
 * run" and fail closed (never auto-approve on a failed extraction).
 */
export async function extractContractText(documentUrl: string): Promise<string> {
  const bytes = await loadContractPdfBytes(documentUrl);
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join("\n") : text;
  const trimmed = merged.trim();
  // A scannable contract is never empty. An empty extraction (image-only scan,
  // corrupt text layer) is treated as a scan failure so we fail closed rather
  // than "PASS" a document we never actually read.
  if (trimmed.length < 20) {
    throw new Error("Contract text could not be extracted (empty or image-only PDF).");
  }
  return trimmed;
}
