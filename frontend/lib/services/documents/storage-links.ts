// lib/services/documents/storage-links.ts
// Helpers for private Supabase Storage buckets holding sensitive documents
// (buyer/dealer documents, insurance proofs, pre-approval letters, dealer
// contracts). These buckets are private: objects are reached only via
// short-lived signed URLs generated at read time by an authorized caller.
//
// We persist the bare STORAGE PATH (e.g. "<ownerId>/<uuid>.pdf"), never a
// signed URL and never a public URL. `extractStoragePath` additionally accepts
// legacy rows that stored a full public URL, so the switch is non-breaking for
// data written before this change.

import { createServiceSupabaseClient } from "@/lib/supabase";

/** Default signed-URL lifetime for view links generated on read (1 hour). */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Normalize a stored document reference to a bare storage path for `bucket`.
 *
 * Accepts:
 *   - a bare path already ("<ownerId>/<uuid>.pdf") → returned unchanged
 *   - a full Supabase public URL (".../storage/v1/object/public/<bucket>/<path>")
 *   - a full Supabase signed URL (".../storage/v1/object/sign/<bucket>/<path>?token=...")
 *   - any absolute URL containing "/<bucket>/<path>"
 * Query strings (e.g. a signed-URL token) are stripped and the path is decoded.
 */
export function extractStoragePath(bucket: string, stored: string): string {
  if (!stored) return stored;

  const markers = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
    `/storage/v1/object/authenticated/${bucket}/`,
    `/object/public/${bucket}/`,
    `/object/sign/${bucket}/`,
  ];
  for (const marker of markers) {
    const idx = stored.indexOf(marker);
    if (idx !== -1) return stripQuery(stored.slice(idx + marker.length));
  }

  // Generic fallback: an absolute URL that still contains "/<bucket>/".
  const generic = `/${bucket}/`;
  const gi = stored.indexOf(generic);
  if (/^https?:\/\//i.test(stored) && gi !== -1) {
    return stripQuery(stored.slice(gi + generic.length));
  }

  // Already a bare storage path.
  return stored;
}

function stripQuery(rest: string): string {
  const q = rest.indexOf("?");
  const clean = q === -1 ? rest : rest.slice(0, q);
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

/**
 * Generate a short-lived signed URL for a stored document reference.
 * Returns null if the object cannot be signed (missing/invalid path or storage
 * error). Callers MUST enforce authorization/ownership before calling this and
 * MUST NOT persist the returned URL — sign fresh on each read.
 */
export async function createSignedDocumentUrl(
  bucket: string,
  stored: string,
  expiresInSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const path = extractStoragePath(bucket, stored);
  if (!path) return null;

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
