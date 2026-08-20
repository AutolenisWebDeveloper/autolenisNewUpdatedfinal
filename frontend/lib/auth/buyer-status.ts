// Shared buyer access-status predicate.
//
// A buyer whose access has been disabled by an admin (`disabledAt` set) or whose
// PII has been purged (`purgedAt` set) must NOT retain authenticated access to
// protected buyer functionality — pages, APIs, or server-side mutations.
//
// This is the single source of truth for that rule so the API boundary
// (`getRequestBuyer`) and the page boundary (buyer layout) can never drift.
// It intentionally does NOT consider `isSuspended` — that older suspension
// mechanism is enforced separately at `requireBuyer`/proxy.ts (Supabase
// user_metadata) and keeps its own redirect UX.

export interface BuyerAccessStatusFields {
  disabledAt?: Date | null;
  purgedAt?: Date | null;
}

/** True when an authenticated buyer's access has been revoked by an admin. */
export function isBuyerAccessDisabled(
  buyer: BuyerAccessStatusFields | null | undefined,
): boolean {
  if (!buyer) return false;
  return Boolean(buyer.disabledAt || buyer.purgedAt);
}
