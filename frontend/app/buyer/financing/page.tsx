// Buyer — financing. Routes to the external-financing options for the buyer's active deal.
//
// PHASE 7 — THE LAST `credit_applications` READ IN THE TREE.
//
// This page used to read `creditApplication` and render its status: DRAFT, SUBMITTED,
// PENDING_LENDER, CONDITIONAL, APPROVED, DECLINED, ADVERSE_ACTION_PENDING, HUMAN_REVIEW,
// WITHDRAWN, together with the requested amount, term and approved amount. It was the fourth and
// last entry on the Phase 1 freeze allowlist (`prisma/__tests__/credit-applications-frozen.test.ts`),
// and removing it is what takes that allowlist to ZERO.
//
// §8.2a is the canonical account and it is worth restating here, because "the page stopped
// reading the model" is easy to mistake for "the rows went":
//
//   Phase 0  the WRITE path closed — `POST /api/buyer/financing/apply` became a bodyless 410, so
//            no SSN, income, employment or date of birth has been collected since.
//   Phase 1  the model was RECORDED AS FROZEN and the build-failing guard landed.
//   Phase 7  the read-only surfaces go, the guard is RE-VERIFIED against an empty allowlist, and
//            the table and every row are UNTOUCHED.
//   later    physical deletion, which needs separate retention, legal and owner approval
//            (§13-D9). It is not part of this series and no phase above performs it.
//
// The page is kept rather than deleted because a buyer who has this URL bookmarked, or who
// follows an old email link, must land somewhere that tells them what to do — not a 404. §12's
// financing paths are what actually exist, so that is where it sends them.
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BuyerFinancingPage({
  searchParams,
}: {
  searchParams: Promise<{ dealId?: string }>;
}) {
  const buyer = await requireBuyer();
  const { dealId } = await searchParams;

  // FINANCING_PENDING is Stage 12's own status. RECAP_PENDING is included because a buyer whose
  // dealership has reaffirmed will reasonably look for "financing" before the recap is confirmed,
  // and sending them to the dashboard at that point reads as though something has gone wrong.
  const deal = await prisma.deal.findFirst({
    where: {
      buyerId: buyer.id,
      status: { in: ["FINANCING_PENDING", "RECAP_PENDING"] },
      ...(dealId ? { id: dealId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-[var(--color-al-text)]">Financing</h1>

      {!deal ? (
        <p className="mt-4 text-[15px] text-[var(--color-al-text-muted)]">
          You don&apos;t have a deal at the financing stage right now. Once you&apos;ve accepted an
          offer and your dealership has confirmed it, your financing options appear here.
        </p>
      ) : (
        <section
          className="mt-6 rounded-lg border border-[var(--color-al-border)] p-5"
          data-testid="financing-options-redirect"
        >
          <h2 className="text-[13px] font-medium uppercase tracking-wide text-[var(--color-al-text-subtle)]">
            Choose how you&apos;ll pay
          </h2>
          <p className="mt-2 text-[15px] text-[var(--color-al-text-muted)]">
            All financing happens outside AutoLenis. Finance through the dealership, bring a
            pre-approval from your own bank or credit union, or pay cash — we coordinate, follow up
            and verify, and we never take an application or pull your credit.
          </p>
          <Link
            href={`/buyer/deal/${deal.id}/financing`}
            data-testid="financing-options-link"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-al-primary px-4 py-2 text-sm font-semibold text-white hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
          >
            Choose financing options
          </Link>
        </section>
      )}
    </main>
  );
}
