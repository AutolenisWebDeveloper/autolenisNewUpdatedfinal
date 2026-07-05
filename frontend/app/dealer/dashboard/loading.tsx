// Dealer dashboard loading skeleton — mirrors the redesigned layout (header,
// 5 KPI cards, two list panels) so the transition from skeleton to content
// doesn't jump.
export default function DealerDashboardLoading() {
  return (
    <div className="w-full mx-auto max-w-6xl p-6 md:p-8 animate-pulse" data-testid="dealer-dashboard-loading">
      <div className="mb-8">
        <div className="flex gap-2 mb-3">
          <div className="h-5 w-16 bg-slate-200 rounded-full" />
          <div className="h-5 w-24 bg-slate-200 rounded-full" />
        </div>
        <div className="h-8 w-72 bg-slate-200 rounded mb-2" />
        <div className="h-4 w-56 bg-slate-100 rounded" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200/80 rounded-2xl p-5">
            <div className="w-9 h-9 bg-slate-100 rounded-xl mb-4" />
            <div className="h-6 w-14 bg-slate-200 rounded mb-3" />
            <div className="h-3 w-20 bg-slate-100 rounded" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200/80 rounded-2xl p-5">
            <div className="h-3 w-32 bg-slate-100 rounded mb-5" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="h-9 w-full bg-slate-50 rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
