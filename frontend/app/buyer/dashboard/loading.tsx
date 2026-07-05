// Buyer dashboard loading skeleton — mirrors the real layout (header, 3 KPI
// cards, next-step + quick-actions split) so the page doesn't flash blank
// while server data loads.
export default function BuyerDashboardLoading() {
  return (
    <div className="w-full mx-auto max-w-6xl p-6 md:p-8 animate-pulse" data-testid="buyer-dashboard-loading">
      <div className="mb-8">
        <div className="h-6 w-44 bg-slate-200 rounded-full mb-3" />
        <div className="h-8 w-72 bg-slate-200 rounded mb-2" />
        <div className="h-4 w-52 bg-slate-100 rounded" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200/80 rounded-2xl p-5">
            <div className="w-9 h-9 bg-slate-100 rounded-xl mb-4" />
            <div className="h-7 w-24 bg-slate-200 rounded mb-3" />
            <div className="h-3 w-32 bg-slate-100 rounded" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-3 bg-white border border-slate-200/80 rounded-2xl p-6">
          <div className="h-3 w-40 bg-slate-100 rounded mb-5" />
          <div className="h-6 w-56 bg-slate-200 rounded mb-3" />
          <div className="h-4 w-full bg-slate-100 rounded mb-2" />
          <div className="h-4 w-3/4 bg-slate-100 rounded mb-6" />
          <div className="h-11 w-48 bg-slate-200 rounded-xl" />
        </div>
        <div className="lg:col-span-2 bg-white border border-slate-200/80 rounded-2xl p-6">
          <div className="h-3 w-28 bg-slate-100 rounded mb-5" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-9 w-full bg-slate-50 rounded-xl" />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-52 bg-white border border-slate-200/80 rounded-2xl" />
        <div className="h-52 bg-slate-200 rounded-2xl" />
      </div>
    </div>
  );
}
