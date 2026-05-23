// Default dealer-portal loading skeleton. Each dealer route can override this
// by adding its own loading.tsx, but at minimum no page renders a blank
// screen while server data is loading.
export default function DealerLoading() {
  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="dealer-loading-skeleton">
      <div className="mb-8 animate-pulse">
        <div className="h-7 w-64 bg-slate-200 rounded mb-3" />
        <div className="flex gap-2">
          <div className="h-5 w-20 bg-slate-200 rounded-full" />
          <div className="h-5 w-24 bg-slate-200 rounded-full" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="h-4 w-4 bg-slate-200 rounded mb-3" />
            <div className="h-6 w-12 bg-slate-200 rounded mb-2" />
            <div className="h-3 w-16 bg-slate-200 rounded" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-pulse">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i}>
            <div className="h-4 w-32 bg-slate-200 rounded mb-3" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                  <div className="h-4 w-full bg-slate-100 rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
