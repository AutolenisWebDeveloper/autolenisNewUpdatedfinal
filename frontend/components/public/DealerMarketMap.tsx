"use client";

import { useEffect, useState } from "react";
import { Building2, MapPin } from "lucide-react";

interface CoverageEntry {
  state: string;
  count: number;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "Washington D.C.",
};

export default function DealerMarketMap() {
  const [coverage, setCoverage] = useState<CoverageEntry[] | null>(null);
  const [totalDealers, setTotalDealers] = useState(0);

  useEffect(() => {
    fetch("/api/public/dealer-coverage")
      .then((r) => r.json())
      .then((d: { success: boolean; data: CoverageEntry[] }) => {
        if (d.success) {
          setCoverage(d.data);
          setTotalDealers(d.data.reduce((acc, e) => acc + e.count, 0));
        }
      })
      .catch(() => setCoverage([]));
  }, []);

  // Safe empty state when not yet loaded
  if (coverage === null) return null;

  return (
    <section
      className="py-24 bg-white"
      data-testid="dealer-market-map-section"
      id="dealer-coverage"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">
              <MapPin size={13} aria-hidden />
              Dealer Coverage
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
              Verified dealers across the country
            </h2>
          </div>
          {totalDealers > 0 && (
            <div className="flex items-center gap-2 text-[#0B5FD1] bg-[#EFF6FF] border border-[#DBEAFE] rounded-full px-5 py-2.5 shrink-0">
              <Building2 size={16} aria-hidden />
              <span className="text-sm font-bold">{totalDealers.toLocaleString()} active dealers</span>
            </div>
          )}
        </div>

        {coverage.length === 0 ? (
          <div
            className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-2xl p-12 text-center"
            data-testid="dealer-coverage-empty"
          >
            <Building2 size={32} className="text-[#93C5FD] mx-auto mb-4" aria-hidden />
            <p className="text-sm font-semibold text-[#4B5563]">Coverage map coming soon</p>
            <p className="text-xs text-[#94A3B8] mt-1">We&apos;re actively onboarding dealers in new markets.</p>
          </div>
        ) : (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
            data-testid="dealer-coverage-grid"
          >
            {coverage.map((entry) => (
              <div
                key={entry.state}
                className="flex items-center justify-between bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl px-4 py-3 hover:border-[#93C5FD] hover:bg-[#EFF6FF] transition-all"
                data-testid={`dealer-coverage-${entry.state.toLowerCase()}`}
              >
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">
                    {entry.state}
                  </p>
                  <p className="text-xs text-[#4B5563] leading-tight">
                    {STATE_NAMES[entry.state] ?? entry.state}
                  </p>
                </div>
                <span className="text-sm font-bold text-[#0B5FD1] font-[family-name:var(--font-mono)]">
                  {entry.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
