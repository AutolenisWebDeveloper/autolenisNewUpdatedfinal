// Server Component. Factual, compliance-safe comparison of AutoLenis vs a
// dealership, Costco Auto, and listing marketplaces (TrueCar/Carvana-style).
// No disparagement; "Varies" where a category is genuinely mixed.

import { COMPARISON_ROWS } from "./content";

export default function ComparisonTable() {
  return (
    <section id="comparison" className="scroll-mt-20 bg-white py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-6 md:px-12">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          AutoLenis vs. dealerships, Costco Auto &amp; car marketplaces
        </h2>
        <p className="mt-3 max-w-2xl text-slate-600">
          A car concierge is not a car broker, a buying club, or a listings site. Here is how
          the buyer-side reverse-auction model compares.
        </p>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="py-3 pr-4 font-semibold text-slate-500"> </th>
                <th className="py-3 px-4 font-bold text-[#0B5FD1]">AutoLenis</th>
                <th className="py-3 px-4 font-semibold text-slate-700">Dealership</th>
                <th className="py-3 px-4 font-semibold text-slate-700">Costco Auto</th>
                <th className="py-3 px-4 font-semibold text-slate-700">Car marketplaces</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.feature} className="border-b border-slate-100 align-top">
                  <th scope="row" className="py-3 pr-4 font-medium text-slate-900">{row.feature}</th>
                  <td className="py-3 px-4 font-medium text-slate-900">{row.autolenis}</td>
                  <td className="py-3 px-4 text-slate-600">{row.dealership}</td>
                  <td className="py-3 px-4 text-slate-600">{row.costco}</td>
                  <td className="py-3 px-4 text-slate-600">{row.marketplace}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Comparison reflects AutoLenis&apos;s buyer-side model and common industry practices;
          specific programs vary by provider and region.
        </p>
      </div>
    </section>
  );
}
