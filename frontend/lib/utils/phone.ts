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

/**
 * A US number in strict E.164 form: "+1" followed by 10 digits = 12 chars.
 *
 * Lives HERE, next to normalizePhone, and not beside the Twilio client, because
 * it is pure and client-reachable. Importing it from sms/twilio.service pulled
 * the entire Twilio SDK into a browser bundle through one client component —
 * a build failure that, had it resolved, would have shipped a vendor SDK to the
 * browser. twilio.service re-exports this one; there is no second copy.
 */
export function isValidUsPhone(phone: string | null | undefined): boolean {
  return !!phone && phone.startsWith('+1') && phone.length === 12;
}
