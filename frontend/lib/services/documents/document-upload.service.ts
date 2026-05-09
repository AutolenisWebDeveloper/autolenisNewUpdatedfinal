// lib/services/documents/document-upload.service.ts — OWASP secure upload
export interface UploadResult { url: string; mimeType: string; sizeBytes: number; isAllowed: boolean; rejectionReason?: string }

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

export function validateUpload(mimeType: string, sizeBytes: number): { valid: boolean; reason?: string } {
  if (!ALLOWED_TYPES.includes(mimeType)) return { valid: false, reason: `File type ${mimeType} not allowed` };
  if (sizeBytes > MAX_SIZE_BYTES) return { valid: false, reason: `File size exceeds ${MAX_SIZE_BYTES / 1024 / 1024}MB limit` };
  return { valid: true };
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-z0-9.-]/gi, "_").slice(0, 100);
}
