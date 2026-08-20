// Buyer — financing application. Shown while the buyer's deal is in FINANCING_PENDING.
// If an application already exists we show its status; otherwise the application form.
// PII is submitted to the encrypting API and never rendered back here.
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { FinancingApplicationForm } from "@/components/buyer/FinancingApplicationForm";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, string> = {
  DRAFT: "Started — not yet submitted.",
  SUBMITTED: "Submitted. We're sending it to lenders.",
  PENDING_LENDER: "Under review by the lender.",
  CONDITIONAL: "Conditionally approved — our team is reviewing the conditions.",
  APPROVED: "Approved. You're all set to continue your deal.",
  DECLINED: "Not approved. Our team is reviewing next steps with you.",
  ADVERSE_ACTION_PENDING: "Not approved. A required notice is being prepared.",
  HUMAN_REVIEW: "Our team is reviewing your application.",
  WITHDRAWN: "Withdrawn.",
};

function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default async function BuyerFinancingPage({ searchParams }: { searchParams: Promise<{ dealId?: string }> }) {
  const buyer = await requireBuyer();
  const { dealId } = await searchParams;

  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id, status: "FINANCING_PENDING", ...(dealId ? { id: dealId } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const application = deal
    ? await prisma.creditApplication.findFirst({
        where: { dealId: deal.id, buyerId: buyer.id },
        orderBy: { createdAt: "desc" },
        select: { status: true, amountRequestedCents: true, termMonths: true, aprRate: true, monthlyPaymentCents: true, approvedAmountCents: true },
      })
    : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-[var(--color-al-text)]">Financing</h1>

      {!deal ? (
        <p className="mt-4 text-[15px] text-[var(--color-al-text-muted)]">
          You don't have a deal at the financing stage right now. Once you've accepted an offer and
          your deal reaches financing, you can apply here.
        </p>
      ) : application ? (
        <section className="mt-6 rounded-lg border border-[var(--color-al-border)] p-5">
          <h2 className="text-[13px] font-medium uppercase tracking-wide text-[var(--color-al-text-subtle)]">
            Application status
          </h2>
          <p className="mt-1 text-[17px] font-medium text-[var(--color-al-text)]">
            {STATUS_COPY[application.status] ?? application.status}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-[14px]">
            <div>
              <dt className="text-[var(--color-al-text-subtle)]">Requested</dt>
              <dd className="text-[var(--color-al-text)]">{money(application.amountRequestedCents)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-al-text-subtle)]">Term</dt>
              <dd className="text-[var(--color-al-text)]">{application.termMonths ? `${application.termMonths} mo` : "—"}</dd>
            </div>
            {application.status === "APPROVED" && (
              <>
                <div>
                  <dt className="text-[var(--color-al-text-subtle)]">Approved amount</dt>
                  <dd className="text-[var(--color-al-text)]">{money(application.approvedAmountCents)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-al-text-subtle)]">Est. monthly</dt>
                  <dd className="text-[var(--color-al-text)]">{money(application.monthlyPaymentCents)}</dd>
                </div>
              </>
            )}
          </dl>
        </section>
      ) : (
        <FinancingApplicationForm dealId={deal.id} />
      )}
    </main>
  );
}
