// Phone number normalization to E.164. North American default (+1).

export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';

  const trimmed = String(raw).trim();
  const startsWithPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (!digits) return '';

  if (startsWithPlus) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (digits.length > 11) {
    return `+${digits}`;
  }
  return '';
}

export function isValidE164(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim().toLowerCase();
  return cleaned || null;
}
