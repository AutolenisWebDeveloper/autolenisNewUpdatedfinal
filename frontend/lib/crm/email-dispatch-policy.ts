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
  // --- LIVE nurture-seed lifecycle keys (migrations/09_nurture_templates_all.sql)
  // These are the template_keys the buyer lifecycle campaigns ACTUALLY dispatch.
  // Each is seeded with category 'transactional' and is an email the buyer needs
  // regardless of marketing consent (request received → auction live → offer in →
  // multiple offers → deal formed → deposit confirmed → contract signed). They
  // MUST be allowlisted or the effective-type gate downgrades them to 'marketing'
  // and consent-blocks a genuinely transactional send.
  'vr_received',
  'auction_live',
  'offer_in',
  'offer_multiple',
  'deal_formed',
  'deposit_confirmed',
  'contract_signed',
  // --- Direct/reserved transactional sends (e-sign, receipts, auth, prequal
  // notices). Not part of the nurture seed set; kept allowlisted for the
  // transactional senders that dispatch them by these stable keys.
  'esign_request',
  'deposit_receipt',
  'concierge_fee_receipt',
  'refund_receipt',
  'offer_ready',
  'auction_activated',
  'deal_selected',
  'deal_complete',
  'contract_approved',
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
