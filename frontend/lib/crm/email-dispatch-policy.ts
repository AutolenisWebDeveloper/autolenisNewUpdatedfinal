// ---------------------------------------------------------------------------
// EMAIL DISPATCH POLICY (Fix C) — pure, no I/O
// ---------------------------------------------------------------------------
// The caller-supplied `type:'transactional'|'marketing'` label is controlled by
// Make and must NEVER, on its own, unlock a consent-free send. A send is treated
// as genuinely transactional ONLY if it declares 'transactional' AND uses one of
// the allowlisted template_keys below — emails the buyer needs regardless of
// marketing consent (e-sign, payment receipts, offer-ready, lifecycle
// confirmations). Marketing, a raw subject+html payload, or an UNLISTED
// template_key all collapse to effective 'marketing' → consent_email required.

export const TRANSACTIONAL_TEMPLATE_KEYS = new Set<string>([
  'esign_request',
  'deposit_receipt',
  'concierge_fee_receipt',
  'refund_receipt',
  'offer_ready',
  'auction_activated',
  'deal_selected',
  'deal_complete',
  'contract_approved',
  'contract_signed',
  'pickup_ready',
  'email_verified',
  'password_reset',
  'prequal_approved',
  'prequal_under_review',
  'adverse_action',
]);

export type EmailType = 'transactional' | 'marketing';

// Resolve the EFFECTIVE type that governs the consent decision.
export function computeEffectiveEmailType(
  declaredType: EmailType,
  templateKey: string | undefined | null,
): EmailType {
  if (declaredType === 'transactional' && templateKey && TRANSACTIONAL_TEMPLATE_KEYS.has(templateKey)) {
    return 'transactional';
  }
  return 'marketing';
}
