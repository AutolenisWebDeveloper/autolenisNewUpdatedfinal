// Affiliate dashboard loading skeleton — mirrors the real layout (header,
// 4 KPI cards, two-column body) so the page doesn't flash blank while
// commission/network data loads.
export default function AffiliateDashboardLoading() {
  return (
    <div className="w-full mx-auto max-w-6xl p-6 md:p-8 animate-pulse" data-testid="affiliate-dashboard-loading">
      <div className="mb-8">
        <div className="h-5 w-40 bg-slate-200 rounded-full mb-3" />
        <div className="h-8 w-72 bg-slate-200 rounded mb-2" />
        <div className="h-4 w-56 bg-slate-100 rounded" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200/80 rounded-2xl p-5">
            <div className="w-9 h-9 bg-slate-100 rounded-xl mb-4" />
            <div className="h-6 w-20 bg-slate-200 rounded mb-3" />
            <div className="h-3 w-24 bg-slate-100 rounded" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          <div className="h-40 bg-white border border-slate-200/80 rounded-2xl" />
          <div className="h-36 bg-white border border-slate-200/80 rounded-2xl" />
        </div>
        <div className="h-80 bg-white border border-slate-200/80 rounded-2xl" />
      </div>
    </div>
  );
}
