// Server Component. Savings callout. ALL figures are owner-confirm placeholders
// — never fabricate savings numbers (FTC/Google YMYL violation).

interface SavingsCalloutProps {
  /** City name for localized framing, or null on the state hub. */
  city?: string | null;
}

export default function SavingsCallout({ city = null }: SavingsCalloutProps) {
  const where = city ? `${city} buyers` : "Texas buyers";
  return (
    <section id="savings" className="scroll-mt-20 bg-[#0B5FD1] py-16 text-white md:py-20">
      <div className="mx-auto max-w-4xl px-6 text-center md:px-12">
        <h2 className="text-2xl font-bold sm:text-3xl">How much could you save?</h2>
        <p className="mx-auto mt-4 max-w-2xl text-blue-50">
          When dealers compete in a private reverse auction, the out-the-door price tends to
          fall versus negotiating alone. {where} keep their time and their leverage.
        </p>

        <div className="mx-auto mt-8 max-w-md rounded-2xl bg-white/10 p-8">
          <div className="text-4xl font-extrabold sm:text-5xl">
            {/* {{CONFIRM_WITH_OWNER}} — verifiable average savings figure, or remove this block */}
            $&#123;&#123;CONFIRM_WITH_OWNER&#125;&#125;
          </div>
          <p className="mt-2 text-sm text-blue-100">
            Average reported savings ({"{{CONFIRM_WITH_OWNER}}"} — substantiate before publishing)
          </p>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-xs text-blue-100">
          Savings vary based on vehicle, market conditions, dealer participation, and the offer
          you select. AutoLenis does not guarantee any specific savings outcome.
        </p>
      </div>
    </section>
  );
}
