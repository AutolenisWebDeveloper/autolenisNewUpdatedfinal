// §23.2a TOUCHPOINT 2 — the second Premium mention, alongside the Best Price Report.
//
// §8c parity row C11: "Best Price Report delivered with the second LIGHT Premium mention". Light is
// the requirement, not a style note — this is the second of five asks a buyer will see across one
// transaction, and §23.2b's "how the ask stays honest" governs every word of it.
//
// PAY-72 IS THE CONSTRAINT THAT SHAPED THE COPY: "never sold on fear". Nothing here may imply the
// deal goes worse on Standard, that these offers are weaker without it, or that any gate is slower.
// None of that is true — everything §23 guarantees a buyer is guaranteed on both plans — and this
// sits directly above the ranked offers, which is the single place where a fear-shaped sentence
// would do the most damage. So it names what Premium ADDS, states that the deposit already counts
// toward it, and says plainly that nothing is required.
//
// IT IS NOT A DIALOG, A BANNER OVER THE CARDS, OR ANYTHING THAT MUST BE DISMISSED. §23.2b: "the
// in-app option remains available without further prompting."

import Link from "next/link";

export default function PremiumReportMention({ balanceDueUsd }: { balanceDueUsd: string }) {
  return (
    <div
      className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
      data-testid="premium-report-mention"
    >
      <p className="text-sm text-slate-600">
        Everything below is yours to choose from on your current plan.{" "}
        <span className="text-slate-700">
          If you&apos;d rather have a concierge handle financing, paperwork and pickup for you, Premium
          is {balanceDueUsd} more — your $99 deposit counts toward it.
        </span>{" "}
        <Link
          href="/buyer/plan/premium"
          className="font-semibold text-al-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-al-primary rounded"
          data-testid="premium-report-mention-link"
        >
          See what&apos;s included
        </Link>
      </p>
    </div>
  );
}
