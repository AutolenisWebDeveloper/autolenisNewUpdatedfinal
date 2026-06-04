// Server Component. Savings callout. A specific dollar figure is rendered ONLY when a
// real, substantiated average-savings number is supplied (FTC/Google YMYL). With no
// such data the section falls back to claim-free, qualitative copy — it never renders
// a fabricated or placeholder figure.

interface SavingsCalloutProps {
  /** City name for localized framing, or null on the state hub. */
  city?: string | null;
  /**
   * Real, documented average savings in whole dollars. The figure block renders only
   * when this is a positive, finite number backed by substantiated data. Leave
   * null/undefined until such data exists — the section then shows the clean fallback.
   */
  averageSavingsDollars?: number | null;
}

export default function SavingsCallout({
  city = null,
  averageSavingsDollars = null,
}: SavingsCalloutProps) {
  const where = city ? `${city} buyers` : "Texas buyers";
  const hasRealFigure =
    typeof averageSavingsDollars === "number" &&
    Number.isFinite(averageSavingsDollars) &&
    averageSavingsDollars > 0;

  return (
    <section id="savings" className="scroll-mt-20 bg-[#0B5FD1] py-16 text-white md:py-20">
      <div className="mx-auto max-w-4xl px-6 text-center md:px-12">
        <h2 className="text-2xl font-bold sm:text-3xl">How much could you save?</h2>
        <p className="mx-auto mt-4 max-w-2xl text-blue-50">
          When dealers compete in a private reverse auction, the out-the-door price tends to
          fall versus negotiating alone. {where} keep their time and their leverage.
        </p>

        {hasRealFigure && (
          <div className="mx-auto mt-8 max-w-md rounded-2xl bg-white/10 p-8">
            <div className="text-4xl font-extrabold sm:text-5xl">
              ${averageSavingsDollars!.toLocaleString("en-US")}
            </div>
            <p className="mt-2 text-sm text-blue-100">Average reported savings</p>
          </div>
        )}

        <p className="mx-auto mt-6 max-w-2xl text-xs text-blue-100">
          Savings vary based on vehicle, market conditions, dealer participation, and the offer
          you select. AutoLenis does not guarantee any specific savings outcome.
        </p>
      </div>
    </section>
  );
}
