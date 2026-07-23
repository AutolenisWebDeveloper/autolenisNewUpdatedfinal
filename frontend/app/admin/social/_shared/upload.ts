// Shared compose-image upload helper used by the Compose and Bulk drawers.
// Extracted verbatim from SocialDashboardClient.tsx (decomposition).
import { fetchJson } from "./fetchJson";

export function uploadComposeImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  return fetchJson<{ imageUrl: string }>("/api/admin/social/compose/upload-image", {
    method: "POST",
    body: fd,
  }).then((r) => r.imageUrl);
}
