// W0-A — pure deposit-activation decision policy.
// Dependency-free (no server-only / prisma imports) so the activation contract
// is unit-testable. The reconciler in deposit-activation.service.ts re-exports
// and drives these.

export type ActivationAction =
  | 'skip'            // not PAID / refunded / terminal — nothing to do
  | 'create_auction'  // PAID deposit, no auction row
  | 'launch'          // auction PENDING — launch (sets ACTIVE + endsAt)
  | 'invite'          // auction ACTIVE, zero invitations — invite dealers
  | 'close'           // ACTIVE, zero invitations past the no-dealer grace — close (NO refund; deposit retained)
  | 'ok';             // already populated

export interface ActivationState {
  depositStatus: string;
  depositRefunded: boolean;
  hasAuction: boolean;
  auctionStatus?: string;
  invitationCount: number;
  offerCount: number;
  auctionAgeMinutes: number;
  // Grace after which a no-dealer ACTIVE auction is closed out (terminal state).
  // The $99 Auction Access Deposit is NEVER auto-refunded — it is refundable on
  // request, subject to manual AutoLenis review.
  noDealerCloseGraceMinutes: number;
}

// What is the NEXT action to converge this deposit's activation toward the
// invariant: a confirmed $99 always reaches a populated ACTIVE auction OR a
// terminal CLOSED state. The deposit is never auto-refunded.
export function classifyActivation(s: ActivationState): ActivationAction {
  if (s.depositStatus !== 'PAID' || s.depositRefunded) return 'skip';
  if (!s.hasAuction) return 'create_auction';
  if (s.auctionStatus === 'PENDING') return 'launch';
  if (s.auctionStatus === 'ACTIVE') {
    if (s.invitationCount > 0 || s.offerCount > 0) return 'ok';
    // ACTIVE with zero invitations AND zero offers
    if (s.auctionAgeMinutes >= s.noDealerCloseGraceMinutes) return 'close';
    return 'invite';
  }
  // CLOSED / CANCELLED — terminal; F-001 owns post-close.
  return 'skip';
}
