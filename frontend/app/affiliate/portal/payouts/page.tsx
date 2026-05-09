import { redirect } from "next/navigation";

// Payouts has been consolidated into Finance Hub.
// This redirect preserves direct-link access.
export default function AffiliatePayoutsPage() {
  redirect("/affiliate/portal/finance");
}
