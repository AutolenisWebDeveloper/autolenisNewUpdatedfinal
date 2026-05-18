import type { Metadata } from "next";

export const metadata: Metadata = { title: "Prequalification Result", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { redirect } from "next/navigation";

// The rich approved dashboard lives on /buyer/prequal — this URL is kept only
// as a deep-link target (e.g. older PREQUAL_APPROVED notifications) and always
// redirects to a coherent surface for every decision state:
//   APPROVED → /buyer/prequal (canonical approved dashboard)
//   DECLINED → /buyer/prequal/declined (FCRA adverse action)
//   MANUAL_REVIEW / OFAC_REVIEW / OFAC_ESCALATED → /buyer/prequal/pending
//   anything else (no record, PENDING, expired) → /buyer/prequal
export default async function PrequalResultPage() {
  const buyer = await requireBuyer();
  const prequal = buyer?.preQualification;
  if (!prequal) redirect("/buyer/prequal");
  if (prequal.decision === "DECLINED") redirect("/buyer/prequal/declined");
  if (
    prequal.decision === "MANUAL_REVIEW" ||
    prequal.decision === "OFAC_REVIEW" ||
    prequal.decision === "OFAC_ESCALATED"
  ) {
    redirect("/buyer/prequal/pending");
  }
  // APPROVED (valid or expired) and any other state → canonical dashboard.
  redirect("/buyer/prequal");
}
