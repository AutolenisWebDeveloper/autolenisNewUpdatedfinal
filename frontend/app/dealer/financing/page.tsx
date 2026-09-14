// Dealer — Finance Manager.
//
// §13-D22, PHASE 7. This page listed the buyer's full name (or email) and `approvedAmountCents`
// for every dealer-path financing on a deal that was not cancelled — at any stage, with no
// reaffirmation gate. It is the surface §13-D22 names by name, and it is now behind the same
// identity-firewall predicate as every other dealer surface: §Stage 10 releases buyer identity
// "at this moment and not before", and a Finance Manager screen is not an exception to that.
//
// The approved amount stays, and that is deliberate: once the firewall is open this dealership IS
// the counterparty and the lender's approved amount is a figure they need to write a contract
// against. What changes is that they cannot see it — or the buyer — before they have confirmed.
import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { FinancingStatus } from "@prisma/client";
import { dealerIdentityVisibleMany } from "@/lib/services/deal/identity-firewall.service";
import { CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageContainer, PageHeader, EmptyState, CARD } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// PHASE 7 — the label map, corrected. This mapped APPROVED / PENDING / DECLINED and a set of
// values that do not exist on `FinancingStatus` at all (ACTIVE, FUNDED, SUBMITTED, IN_REVIEW,
// PROCESSING, REJECTED, CANCELLED — parity row `deal-early/D-6`, "status-label heuristics with
// non-existent values"). Every one of the SEVEN checkpoint states the Phase 1 wave added fell
// through to the grey default, so the moment this phase started writing them a dealership would
// have seen "TERMS_LOCKED" as an unstyled grey pill with no idea whether that was good news.
//
// It is now exhaustive over `FinancingStatus`, so a future enum value is a TYPE ERROR here rather
// than a silent grey pill. Colour is never the only carrier — the label text is the status, and
// the tone is reinforcement (WCAG AA; "changed" cannot be a tint and nothing else).
const STATUS_TONE: Record<FinancingStatus, "green" | "amber" | "destructive" | "secondary"> = {
  // The checkpoint states.
  NOT_STARTED: "secondary",
  IN_PROGRESS: "amber",
  TERMS_LOCKED: "green",
  COMPLETED: "green",
  NOT_REQUIRED_CASH: "green",
  FAILED: "destructive",
  EXPIRED: "destructive",
  // §13-D18 keeps the four legacy values in the enum for rows that already carry one. Nothing
  // writes them, and a row still showing one is history rather than a current state.
  PENDING: "secondary",
  SELECTED: "secondary",
  APPROVED: "green",
  DECLINED: "destructive",
};

const STATUS_LABEL: Record<FinancingStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  TERMS_LOCKED: "Terms locked",
  COMPLETED: "Completed",
  NOT_REQUIRED_CASH: "Cash — no financing",
  FAILED: "Failed",
  EXPIRED: "Expired",
  PENDING: "Pending (legacy)",
  SELECTED: "Selected (legacy)",
  APPROVED: "Approved (legacy)",
  DECLINED: "Declined (legacy)",
};

export default async function DealerFinancingPage() {
  const dealer = await requireDealer();

  // Find Financing rows where the buyer chose dealer financing on a deal owned by this dealer.
  const financings = await prisma.financing.findMany({
    where: {
      path: "DEALER",
      deal: {
        status: { notIn: ["CANCELLED", "REFUNDED"] },
        offer: { dealerId: dealer.id },
      },
    },
    include: {
      deal: {
        include: {
          buyer: { include: { user: { select: { email: true } } } },
          offer: { select: { aprRate: true, termMonths: true, otdPriceCents: true } },
        },
      },
    },
    orderBy: { selectedAt: "desc" },
    take: 50,
  });

  // One firewall decision per deal, resolved before render. A row whose firewall is closed shows
  // the deal and its terms WITHOUT the buyer — the dealership still needs to know the work exists.
  // ONE BATCH, not one round-trip per row: this loop awaited `dealerIdentityVisible` per financing
  // and that predicate makes up to three queries, so 50 rows meant up to 150 SERIALISED queries
  // before the page rendered. `dealerIdentityVisibleMany` is the same predicate over the whole set.
  const decisions = await dealerIdentityVisibleMany(
    financings.map((f) => f.dealId),
    dealer.id,
  );
  const visibility = new Map<string, boolean>(
    financings.map((f) => [f.dealId, decisions.get(f.dealId)?.visible === true]),
  );

  return (
    <PageContainer testId="dealer-financing-page">
      <PageHeader
        title="Finance Manager"
        subtitle="Deals where the buyer chose dealer financing with you."
        actions={<Badge variant="secondary">{financings.length} active</Badge>}
      />

      {financings.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No active financing deals"
          body="Financing details appear here when buyers select dealer financing on their deals."
          testId="financing-empty"
        />
      ) : (
        <div className={cn(CARD, "overflow-x-auto")}>
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-slate-50 text-[11px] text-slate-400 uppercase tracking-[0.14em]">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Buyer</th>
                <th className="text-left px-5 py-3 font-semibold">APR</th>
                <th className="text-left px-5 py-3 font-semibold">Term</th>
                <th className="text-left px-5 py-3 font-semibold">Monthly</th>
                <th className="text-left px-5 py-3 font-semibold">Approved</th>
                <th className="text-left px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {financings.map(f => {
                const apr = f.aprRate ?? f.deal.offer?.aprRate ?? null;
                const term = f.termMonths ?? f.deal.offer?.termMonths ?? null;
                const identityVisible = visibility.get(f.dealId) === true;
                const buyerName = identityVisible
                  ? [f.deal.buyer?.firstName, f.deal.buyer?.lastName].filter(Boolean).join(" ") ||
                    f.deal.buyer?.user?.email ||
                    "—"
                  : "Released when you confirm";
                return (
                  <tr key={f.id} className="hover:bg-slate-50 transition-colors" data-testid={`financing-row-${f.id}`}>
                    <td className={cn("px-5 py-3", identityVisible ? "text-slate-700" : "text-slate-400 italic")}>
                      {buyerName}
                    </td>
                    <td className="px-5 py-3 font-mono tabular-nums text-slate-900">
                      {apr !== null ? `${apr.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-700 tabular-nums">
                      {term !== null ? `${term} mo` : "—"}
                    </td>
                    <td className="px-5 py-3 font-mono tabular-nums text-slate-900">
                      {f.monthlyPaymentCents
                        ? `$${(f.monthlyPaymentCents / 100).toFixed(0)}/mo`
                        : "—"}
                    </td>
                    <td className="px-5 py-3 font-mono tabular-nums text-slate-700">
                      {identityVisible && f.approvedAmountCents
                        ? `$${(f.approvedAmountCents / 100).toLocaleString()}`
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={STATUS_TONE[f.status]} className="text-xs">
                        {STATUS_LABEL[f.status]}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
