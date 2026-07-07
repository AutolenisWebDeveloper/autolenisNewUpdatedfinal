import { Skeleton } from "@/components/ui/kit";

// Segment-level loading UI for the whole affiliate portal (Phase 2, closes
// M-17: the portal's force-dynamic pages previously showed a blank/frozen
// main area until the DB round-trip resolved). Uses the promoted shared kit
// Skeleton so the placeholder matches the design system. Applies to every
// child route during navigation; individual pages may add a tailored
// loading.tsx later where a closer match is worthwhile.
export default function AffiliatePortalLoading() {
  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="affiliate-portal-loading" aria-busy="true">
      {/* header */}
      <div className="flex items-center gap-3 mb-6">
        <Skeleton style={{ width: 22, height: 22, borderRadius: 6 }} />
        <Skeleton style={{ width: 200, height: 22 }} />
      </div>

      {/* KPI / summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-white border border-slate-200 rounded-xl p-5"
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <Skeleton style={{ width: "60%", height: 12 }} />
            <Skeleton style={{ width: "80%", height: 24 }} />
          </div>
        ))}
      </div>

      {/* content block */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <Skeleton style={{ width: 160, height: 16, marginBottom: 16 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} style={{ width: "100%", height: 40 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
