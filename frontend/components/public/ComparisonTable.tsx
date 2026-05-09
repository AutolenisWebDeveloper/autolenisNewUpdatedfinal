import { CheckCircle2, XCircle } from "lucide-react";

interface ComparisonRow {
  feature: string;
  autolenis: string | true | false;
  traditional: string | true | false;
}

const ROWS: ComparisonRow[] = [
  { feature: "Dealer competition",       autolenis: "Up to 8 dealers compete",    traditional: false },
  { feature: "Fee transparency",         autolenis: "Contract Shield™",            traditional: false },
  { feature: "Financing guidance",       autolenis: "Total cost analysis",         traditional: "Monthly payment only" },
  { feature: "Soft credit pull",         autolenis: "Yes — no score impact",       traditional: false },
  { feature: "Remote buying",            autolenis: "100% remote capable",         traditional: false },
  { feature: "Pressure-free experience", autolenis: true,                          traditional: false },
];

function Cell({ value, isAutoLenis }: { value: string | true | false; isAutoLenis?: boolean }) {
  if (value === true)
    return (
      <span className="flex items-center gap-1.5 text-sm text-[#155724]">
        <CheckCircle2 size={15} className={`shrink-0 ${isAutoLenis ? "text-[#0B5FD1]" : "text-[#50D14E]"}`} aria-hidden />
        Included
      </span>
    );
  if (value === false)
    return (
      <span className="flex items-center gap-1.5 text-sm text-[#94A3B8]">
        <XCircle size={15} className="text-[#D1D5DB] shrink-0" aria-hidden />
        Not available
      </span>
    );
  if (isAutoLenis)
    return (
      <span className="flex items-center gap-1.5 text-sm text-[#111827] font-medium">
        <CheckCircle2 size={15} className="text-[#0B5FD1] shrink-0" aria-hidden />
        {value}
      </span>
    );
  return <span className="text-sm text-[#6B7280]">{value}</span>;
}

export default function ComparisonTable() {
  return (
    <section
      className="py-24 bg-[#F0F2F5]"
      data-testid="comparison-table-section"
      id="comparison"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <div className="mb-12 text-center">
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">The Advantage</span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
            AutoLenis vs Traditional Dealership Buying
          </h2>
          <p className="text-sm text-[#4B5563] mt-3 max-w-lg mx-auto">
            See how the AutoLenis experience stacks up against the old way of buying a car.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-[#E5E7EB] shadow-sm bg-white">
          <table
            className="w-full text-left"
            data-testid="comparison-table"
          >
            <thead>
              <tr className="border-b border-[#E5E7EB]">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#94A3B8] w-1/3">
                  Feature
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#0B5FD1] w-1/3 bg-[#EEF4FF] relative">
                  <span className="flex items-center gap-2">
                    AutoLenis
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-[#0B5FD1] text-white px-2 py-0.5 rounded-full">
                      Most Popular
                    </span>
                  </span>
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#94A3B8] w-1/3">
                  Traditional Dealer
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr
                  key={row.feature}
                  className={`border-b border-[#E5E7EB] last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"}`}
                  data-testid={`comparison-row-${i}`}
                >
                  <td className="px-6 py-4 text-sm font-medium text-[#4B5563]">{row.feature}</td>
                  <td className="px-6 py-4 bg-[#EEF4FF]">
                    <Cell value={row.autolenis} isAutoLenis />
                  </td>
                  <td className="px-6 py-4">
                    <Cell value={row.traditional} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
