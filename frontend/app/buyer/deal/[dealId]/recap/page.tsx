// Buyer — §Stage 11, the final deal recap.
//
// "One consolidated recap is presented to both buyer and dealership — the platform equivalent of
// the worksheet a desk manager and a customer agree on before paperwork."
//
// THE ITEMISATION IS THE POINT, and §Stage 11 lists it component by component: vehicle price,
// discounts and incentives, documentation fee, taxes, title and registration, add-ons, delivery
// fee. Shown as a ledger that ADDS UP on screen, because a buyer who cannot reconcile the parts to
// the total has not been shown the total — they have been shown a number.
//
// TRADE EQUITY IS STATED PLAINLY, in words, because §Stage 11 says so: "Net trade equity or
// negative equity, stated plainly, and whether negative equity is being rolled into the amount
// financed." A negative number in a table is not plain. "You owe $2,300 more on your trade than it
// is worth, and that is being added to what you finance" is.
//
// THE STATE SET:
//   NO RECAP    the deal has not reached Stage 11. Says where the buyer actually is.
//   DECIDE      products outstanding and/or awaiting confirmation. The interactive half owns it.
//   WAITING     buyer confirmed, dealership has not. Says who is holding it.
//   DISPUTED    a corrected version is open; the superseded one is named so the buyer can see the
//               figures did not change under them.
//   DONE        both confirmed and the deal has moved to financing.
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { CheckCircle2, Clock } from "lucide-react";
import { currentRecap, allProductsDecided } from "@/lib/services/deal/deal-recap.service";
import { RecapConfirmClient, type RecapProduct } from "@/components/buyer/RecapConfirmClient";

export const dynamic = "force-dynamic";

interface Props { params: Promise<{ dealId: string }> }

function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const v = Math.abs(cents) / 100;
  const s = `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return cents < 0 ? `−${s}` : s;
}

export default async function RecapPage({ params }: Props) {
  const { dealId } = await params;
  const buyer = await requireBuyer();

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    select: {
      id: true,
      status: true,
      vin: true,
      offer: {
        select: {
          vehicleYear: true,
          vehicleMake: true,
          vehicleModel: true,
          vehicleTrim: true,
          odometer: true,
          vehicleCondition: true,
        },
      },
      coBuyer: { select: { legalFirstName: true, legalLastName: true, isRequiredSigner: true } },
      tradeInSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { year: true, make: true, model: true, mileage: true, condition: true, vin: true },
      },
    },
  });
  if (!deal) notFound();

  const recap = await currentRecap(dealId);

  if (!recap) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-[24px] font-semibold leading-tight text-al-text">Your final numbers</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-al-text-muted" data-testid="recap-not-ready">
          Your recap is prepared once the dealership has confirmed it can do this deal and you have
          acknowledged the condition report. You are not there yet — nothing is missing.
        </p>
        <Link
          href={`/buyer/deal/${deal.id}/reaffirmation`}
          className="mt-4 inline-flex min-h-[48px] items-center rounded-al-md bg-al-primary px-5 py-3 text-[15px] font-semibold text-al-primary-fg hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
        >
          See where my deal is
        </Link>
      </main>
    );
  }

  const vehicle =
    [deal.offer?.vehicleYear, deal.offer?.vehicleMake, deal.offer?.vehicleModel, deal.offer?.vehicleTrim]
      .filter(Boolean)
      .join(" ") || "your vehicle";
  const bothConfirmed = !!recap.buyerConfirmedAt && !!recap.dealerConfirmedAt;
  const products = recap.optionalProducts as RecapProduct[];
  const trade = deal.tradeInSubmissions[0] ?? null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-4 text-[13px]">
        <Link
          href="/buyer/deal"
          className="text-al-text-subtle underline-offset-2 hover:text-al-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
        >
          ← Back to my deal
        </Link>
      </nav>

      <h1 className="text-[24px] font-semibold leading-tight text-al-text">Your final numbers</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-al-text-muted">
        {vehicle}
        {recap.version > 1 ? ` · version ${recap.version}` : ""}
      </p>

      {recap.version > 1 && (
        <p
          className="mt-4 rounded-al-md border border-al-warning/30 bg-al-warning-subtle px-4 py-3 text-[14px] leading-relaxed text-al-warning-fg"
          data-testid="recap-revision-notice"
        >
          This is version {recap.version}. A figure was disputed and corrected — the earlier version
          is kept on the record, so nothing changed without you seeing it.
        </p>
      )}

      {/* THE LEDGER — components that reconcile to the total on screen. */}
      <section
        aria-labelledby="itemised-heading"
        className="mt-6 rounded-al-lg border border-al-border bg-al-surface"
      >
        <header className="border-b border-al-border px-5 py-4 sm:px-6">
          <h2 id="itemised-heading" className="text-[17px] font-semibold text-al-text">
            Out-the-door, itemised
          </h2>
        </header>
        <div className="overflow-x-auto">
          <dl className="min-w-[320px] divide-y divide-al-border" data-testid="recap-itemised">
            {(recap.itemised?.lines ?? []).map((line) => (
              <div key={line.key} className="flex items-baseline justify-between gap-4 px-5 py-3 sm:px-6">
                <dt className="text-[15px] text-al-text-muted">{line.label}</dt>
                <dd className="shrink-0 text-[15px] tabular-nums text-al-text">{money(line.amountCents)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 bg-al-bg px-5 py-4 sm:px-6">
              <dt className="text-[16px] font-semibold text-al-text">Out-the-door total</dt>
              <dd
                className="shrink-0 text-[18px] font-bold tabular-nums text-al-text"
                data-testid="recap-otd-total"
              >
                {money(recap.itemised?.otdCents ?? null)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* THE TRADE, IN WORDS. */}
      {trade && (
        <section
          aria-labelledby="trade-heading"
          className="mt-6 rounded-al-lg border border-al-border bg-al-surface px-5 py-5 sm:px-6"
          data-testid="recap-trade"
        >
          <h2 id="trade-heading" className="text-[17px] font-semibold text-al-text">
            Your trade-in
          </h2>
          <p className="mt-1 text-[15px] text-al-text-muted">
            {[trade.year, trade.make, trade.model].filter(Boolean).join(" ")}
            {trade.mileage ? ` · ${trade.mileage.toLocaleString("en-US")} mi` : ""}
            {trade.vin ? ` · VIN ${trade.vin}` : ""}
          </p>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
            <dt className="text-al-text-muted">Dealer&apos;s preliminary allowance</dt>
            <dd className="tabular-nums text-al-text">{money(recap.preliminaryAllowanceCents)}</dd>
            {recap.payoffGoodThroughDate && (
              <>
                <dt className="text-al-text-muted">Payoff good through</dt>
                <dd className="text-al-text">{recap.payoffGoodThroughDate.toDateString()}</dd>
              </>
            )}
          </dl>
          {recap.equityCents != null && (
            <p
              className={`mt-3 rounded-al-md px-4 py-3 text-[15px] font-medium leading-relaxed ${
                recap.equityCents < 0
                  ? "border border-al-warning/30 bg-al-warning-subtle text-al-warning-fg"
                  : "border border-al-success/30 bg-al-success-subtle text-al-success-fg"
              }`}
              data-testid="recap-equity"
            >
              {recap.equityCents < 0
                ? `You owe ${money(Math.abs(recap.equityCents))} more on your trade than the dealership is allowing for it.${
                    recap.negativeEquityRolledIn
                      ? " That amount is being added to what you finance, so you will be borrowing it."
                      : ""
                  }`
                : `Your trade is worth ${money(recap.equityCents)} more than you owe on it. That goes toward this purchase.`}
            </p>
          )}
        </section>
      )}

      {/* MONEY AND PATH. */}
      <section
        aria-labelledby="money-heading"
        className="mt-6 rounded-al-lg border border-al-border bg-al-surface px-5 py-5 sm:px-6"
      >
        <h2 id="money-heading" className="text-[17px] font-semibold text-al-text">
          How this is being paid
        </h2>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
          <dt className="text-al-text-muted">Down payment</dt>
          <dd className="tabular-nums text-al-text">{money(recap.downPaymentCents)}</dd>
          <dt className="text-al-text-muted">Path</dt>
          <dd className="text-al-text">
            {recap.financingPath === "CASH"
              ? "Cash purchase"
              : recap.financingPath === "DEALER"
                ? "Dealer-arranged financing"
                : recap.financingPath === "EXTERNAL"
                  ? "Your own lender"
                  : "Not yet chosen"}
          </dd>
          {recap.financingPath !== "CASH" && (
            <>
              <dt className="text-al-text-muted">Expected amount financed</dt>
              <dd className="tabular-nums text-al-text">{money(recap.amountFinancedCents)}</dd>
              <dt className="text-al-text-muted">Estimated monthly payment</dt>
              <dd className="tabular-nums text-al-text" data-testid="recap-monthly">
                {recap.estimatedPaymentCents == null
                  ? "— terms not yet locked"
                  : `${money(recap.estimatedPaymentCents)}/mo`}
              </dd>
            </>
          )}
          <dt className="text-al-text-muted">Your plan</dt>
          <dd className="text-al-text">{recap.plan === "PREMIUM" ? "Premium concierge" : "Standard"}</dd>
        </dl>
        <p className="mt-4 text-[13px] leading-relaxed text-al-text-subtle">
          No money passes from you to the dealership before your contract is executed. No holding
          deposits, no card on file — everything payable to them is collected at or after signing.
        </p>
      </section>

      {/* WHO HAS CONFIRMED. */}
      {bothConfirmed ? (
        <section
          className="mt-6 rounded-al-lg border border-al-success/30 bg-al-surface px-5 py-5 sm:px-6"
          data-testid="recap-both-confirmed"
        >
          <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-al-success-fg">
            <CheckCircle2 size={16} aria-hidden="true" />
            You and the dealership have both confirmed
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-al-text-muted">
            Next is your financing path — dealer-arranged, your own lender, or cash. Your contract
            is prepared once the terms are locked.
          </p>
          <Link
            href={`/buyer/deal/${deal.id}/financing`}
            className="mt-4 inline-flex min-h-[48px] items-center rounded-al-md bg-al-primary px-5 py-3 text-[15px] font-semibold text-al-primary-fg hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
            data-testid="recap-to-financing"
          >
            Continue to financing
          </Link>
        </section>
      ) : recap.buyerConfirmedAt ? (
        <section
          className="mt-6 rounded-al-lg border border-al-border bg-al-surface px-5 py-5 sm:px-6"
          data-testid="recap-waiting-dealer"
        >
          <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-al-text">
            <Clock size={16} aria-hidden="true" />
            Waiting on the dealership
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-al-text-muted">
            You have confirmed these numbers. The dealership confirms the same recap, and then your
            deal moves to financing. There is nothing for you to do.
          </p>
        </section>
      ) : (
        <div className="mt-6">
          <RecapConfirmClient
            dealId={deal.id}
            products={products}
            baseOtdCents={recap.itemised?.otdCents ?? 0}
            alreadyConfirmed={false}
          />
        </div>
      )}

      {/* The co-buyer is named because §Stage 11's first line names them. */}
      {deal.coBuyer && (
        <p className="mt-6 text-[13px] leading-relaxed text-al-text-subtle" data-testid="recap-co-buyer">
          Co-buyer on this deal:{" "}
          {[deal.coBuyer.legalFirstName, deal.coBuyer.legalLastName].filter(Boolean).join(" ") || "on file"}
          {deal.coBuyer.isRequiredSigner ? " — they will need to sign." : "."}
        </p>
      )}

      {!allProductsDecided(recap) && !recap.buyerConfirmedAt && (
        <p className="sr-only" role="status">
          Some optional products still need an answer before you can confirm.
        </p>
      )}
    </main>
  );
}
