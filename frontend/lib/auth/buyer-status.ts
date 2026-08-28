// Shared buyer access-status predicate.
//
// A buyer whose access has been disabled by an admin (`disabledAt` set) or whose
// PII has been purged (`purgedAt` set) must NOT retain authenticated access to
// protected buyer functionality — pages, APIs, or server-side mutations.
//
// This is the single source of truth for that rule so the API boundary
// (`getRequestBuyer`) and the page boundary (buyer layout) can never drift.
// It intentionally does NOT consider `isSuspended` — that older suspension
// mechanism has its own redirect UX at `requireBuyer` (to /buyer/suspended), so
// folding it in here would turn a redirect into a blank access-denied screen.

export interface BuyerAccessStatusFields {
  disabledAt?: Date | null;
  purgedAt?: Date | null;
}

export interface BuyerApiAccessFields extends BuyerAccessStatusFields {
  isSuspended?: boolean | null;
}

/** True when an authenticated buyer's access has been revoked by an admin. */
export function isBuyerAccessDisabled(
  buyer: BuyerAccessStatusFields | null | undefined,
): boolean {
  if (!buyer) return false;
  return Boolean(buyer.disabledAt || buyer.purgedAt);
}

/**
 * True when a buyer must be denied at the API boundary.
 *
 * P0 authorization gap this closes: suspension was enforced ONLY on pages —
 * `requireBuyer` redirects a suspended buyer to /buyer/suspended, and proxy.ts's
 * suspension gate explicitly excludes `/api/buyer/` — while the shared API
 * boundary checked `isBuyerAccessDisabled`, which deliberately ignores
 * `isSuspended`. A suspended buyer was therefore locked out of every buyer PAGE
 * but retained full authenticated WRITE access to every `/api/buyer/**` route:
 * deposits, offer selection, document uploads, profile mutations. Suspension
 * that only hides the UI is not suspension.
 *
 * The redirect UX is unaffected — that still comes from `requireBuyer`.
 */
export function isBuyerBlockedFromApi(
  buyer: BuyerApiAccessFields | null | undefined,
): boolean {
  if (!buyer) return false;
  return isBuyerAccessDisabled(buyer) || Boolean(buyer.isSuspended);
}
