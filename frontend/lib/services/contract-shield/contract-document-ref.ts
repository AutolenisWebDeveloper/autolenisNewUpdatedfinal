// lib/services/contract-shield/contract-document-ref.ts
//
// The one definition of what a valid `ContractVersion.documentUrl` INPUT looks
// like, shared by every route that attaches a contract.
//
// Contracts live in the PRIVATE Supabase bucket "dealer-contracts" and are
// persisted as a BARE STORAGE PATH — `${ownerId}/${dealId}/${uuid}.pdf` — which is
// what the upload routes return and what loadContractPdfBytes downloads through
// the service-role client (see extract-text.ts).
//
// The routes previously validated this field with `z.string().url()`, which is
// exactly inverted for it:
//   • it REJECTED the storage path, the only shape the system produces, and
//   • it ACCEPTED any absolute URL, which loadContractPdfBytes then fetches
//     server-side with no host restriction — an SSRF reaching cloud-metadata
//     endpoints (169.254.169.254), loopback services, and file:// .
//
// So input is restricted to stored paths and every absolute URL is refused. There
// is deliberately no host allow-list: nothing legitimate posts a URL here, so an
// allow-list would be configuration to maintain and a hole to widen. Reading is
// unchanged — extract-text still tolerates legacy http(s) rows written before this
// — but no new one can be created.

import { z } from "zod";

/** Max stored-path length. Supabase keys are far shorter; this is a sanity bound. */
const MAX_PATH_LENGTH = 512;

/**
 * A stored contract object key: slash-separated segments ending in `.pdf`.
 *
 * Rejects, by construction: any scheme (`https:`, `file:`) because `:` is not in
 * the character class; absolute paths and empty segments because a segment must
 * start with an alphanumeric; backslashes and control characters for the same
 * reason. `..` traversal is checked separately so the intent is explicit rather
 * than an emergent property of the pattern.
 */
const STORED_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.pdf$/i;

export const CONTRACT_DOCUMENT_PATH_MESSAGE =
  "documentUrl must be a stored contract storage path such as " +
  "\"<owner>/<dealId>/<file>.pdf\" — absolute URLs are not accepted.";

/**
 * True when `value` is a well-formed key for an object in the contracts bucket.
 * Pure and side-effect free: it proves the SHAPE is safe to hand to the storage
 * client, not that the object exists.
 */
export function isStoredContractPath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) return false;
  // A `..` segment would escape the deal's prefix inside the bucket.
  if (value.split("/").some((segment) => segment === "..")) return false;
  return STORED_PATH.test(value);
}

/** Zod schema for the documentUrl field on contract-attach routes. */
export const contractDocumentPathSchema = z
  .string()
  .refine(isStoredContractPath, { message: CONTRACT_DOCUMENT_PATH_MESSAGE });
