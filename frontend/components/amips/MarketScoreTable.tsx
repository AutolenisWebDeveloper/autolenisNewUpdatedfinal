// AMIPS Phase 2 — Market Score display component.
//
// Renders the four-component AutoLenis Market Score plus the overall buyer
// advantage on every Tier C/D/E page, and emits the matching Dataset structured
// data so the public, defensible score is machine-readable. Server component —
// no client state.

import { JsonLd } from "@/lib/seo/jsonld";
import type { MarketScoreResult } from "@/lib/amips/market-score.service";

interface MarketScoreTableProps {
  result: MarketScoreResult;
  vehicle: string;
  metro: string;
  /** YYYY-MM-DD freshness label. Defaults to the score's computedAt date. */
  asOf?: string;
}

const ROWS: Array<{ key: keyof MarketScoreResult; label: string }> = [
  { key: "dealerCompetition", label: "Dealer Competition" },
  { key: "inventoryScore", label: "Inventory" },
  { key: "negotiationOpportunity", label: "Negotiation Opportunity" },
  { key: "financingIncentives", label: "Financing Incentives" },
];

export default function MarketScoreTable({
  result,
  vehicle,
  metro,
  asOf,
}: MarketScoreTableProps) {
  const asOfLabel = asOf ?? result.computedAt.slice(0, 10);

  const datasetSchema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `AutoLenis Market Score — ${vehicle} in ${metro}`,
    description:
      "Buyer-advantage score computed from dealer competition, inventory, negotiation difficulty, and financing incentives. Formula is public; score is never estimated.",
    variableMeasured: [
      ...ROWS.map((r) => ({
        "@type": "PropertyValue",
        name: r.label,
        value: result[r.key],
        maxValue: 10,
      })),
      {
        "@type": "PropertyValue",
        name: "Overall Buyer Advantage",
        value: result.overallBuyerAdvantage,
        maxValue: 10,
      },
    ],
    dateModified: result.computedAt,
  } as const;

  return (
    <section
      className="my-10 rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden"
      data-testid="amips-market-score"
    >
      <JsonLd id="amips-market-score-dataset" data={datasetSchema} />

      <div className="px-6 py-4 border-b border-[#E5E7EB] bg-[#F0F7FF]">
        <h2 className="text-lg font-bold text-[#111827] tracking-tight">
          AutoLenis Market Score — {vehicle} in {metro}
        </h2>
        <p className="text-xs text-[#6B7280] mt-1">
          Computed from market data, never estimated. Data as of{" "}
          <time dateTime={asOfLabel} data-testid="market-score-as-of">
            {asOfLabel}
          </time>
          .
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[#6B7280]">
            <th className="px-6 py-3 font-medium">Factor</th>
            <th className="px-6 py-3 font-medium text-right">Score (0–10)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {ROWS.map((r) => (
            <tr key={r.key}>
              <td className="px-6 py-3 text-[#374151]">{r.label}</td>
              <td className="px-6 py-3 text-right font-semibold text-[#111827]">
                {(result[r.key] as number).toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[#F9FAFB]">
            <td className="px-6 py-3 font-bold text-[#111827]">
              Overall Buyer Advantage
            </td>
            <td className="px-6 py-3 text-right font-bold text-[#0B5FD1]">
              {result.overallBuyerAdvantage.toFixed(1)}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
