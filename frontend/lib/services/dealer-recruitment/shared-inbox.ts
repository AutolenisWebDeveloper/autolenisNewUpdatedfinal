// Block B / B2a — shared-inbox collapse.
//
// The SINGLE source of truth for "this address is a non-personal role/shared
// mailbox" and "these items reach the same mailbox". Imported by the contact
// waterfall (role walk-down), coverage (count a shared mailbox once), and the
// send path (send once per mailbox). Built here once — never reimplemented
// per caller (Block B locked decision, proof #4).

import { normalizeEmail } from "@/lib/utils/phone";

// Local-parts that denote a shared/role mailbox rather than a person. Matched
// after normalization + stripping separators (so "internet.sales" == "internetsales").
// This governs the shared-vs-personal classification only; the waterfall's ranked
// derive dictionary (B2b) governs which role prefix to try first.
export const SHARED_INBOX_LOCALPARTS = new Set<string>([
  "internetsales", "internet", "sales", "newsales", "usedsales", "presales",
  "fleetsales", "fleet", "bdc", "leads", "lead", "webleads",
  "info", "contact", "hello", "admin", "office", "general", "inquiries", "inquiry",
  "customerservice", "service", "support", "team", "dealer", "reception",
]);

/**
 * True when `email` is a shared/role mailbox (not a specific person). Fail-safe:
 * empty/invalid input returns false (treated as "not shared").
 */
export function isSharedInbox(email: string | null | undefined): boolean {
  const norm = normalizeEmail(email);
  if (!norm || !norm.includes("@")) return false;
  const local = norm.split("@")[0] ?? "";
  if (!local) return false;
  const base = local.split("+")[0]!.replace(/[._-]/g, "");
  return SHARED_INBOX_LOCALPARTS.has(local) || SHARED_INBOX_LOCALPARTS.has(base);
}

/**
 * Collapse items that reach the SAME mailbox (by normalized email) to a single
 * entry, keeping the first occurrence — so a rooftop with two contacts sharing
 * one inbox is counted / sent to once. Items without a usable email pass through
 * unchanged (there is no mailbox to collapse on). Callers that want a preference
 * order should pre-sort before calling.
 */
export function collapseByInbox<T>(
  items: T[],
  getEmail: (item: T) => string | null | undefined,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const norm = normalizeEmail(getEmail(item));
    if (!norm) {
      out.push(item);
      continue;
    }
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(item);
  }
  return out;
}
