// Reusable admin skeleton loaders. Route segments render one of these from
// their loading.tsx so no admin page shows a blank screen during the server
// render / navigation. Variants approximate the three common admin layouts:
// list (header + filter + rows), detail (header + two-column), and dashboard
// (header + stat cards + panels).

function Bar({ className = "" }: { className?: string }) {
  return <div className={`bg-slate-200 rounded ${className}`} />;
}

export function AdminListSkeleton() {
  return (
    <div className="p-6 md:p-8 max-w-5xl animate-pulse" data-testid="admin-loading-skeleton">
      <div className="flex items-center justify-between mb-6 gap-3">
        <Bar className="h-7 w-48" />
        <Bar className="h-9 w-32 rounded-lg" />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bar key={i} className="h-7 w-20 rounded-lg" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
            <div className="flex-1 min-w-0 space-y-2">
              <Bar className="h-4 w-1/3" />
              <Bar className="h-3 w-1/2 bg-slate-100" />
            </div>
            <Bar className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminDetailSkeleton() {
  return (
    <div className="p-6 md:p-8 max-w-6xl animate-pulse" data-testid="admin-loading-skeleton">
      <div className="flex items-start justify-between mb-6">
        <div className="space-y-2">
          <Bar className="h-6 w-56" />
          <Bar className="h-3 w-40 bg-slate-100" />
        </div>
        <Bar className="h-8 w-24 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <Bar className="h-4 w-32" />
              {Array.from({ length: 3 }).map((_, j) => (
                <Bar key={j} className="h-3 w-full bg-slate-100" />
              ))}
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <Bar className="h-4 w-28" />
            <Bar className="h-20 w-full bg-slate-100 rounded-lg" />
            <Bar className="h-9 w-full rounded-lg" />
            <Bar className="h-9 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminDashboardSkeleton() {
  return (
    <div className="p-6 md:p-8 max-w-7xl animate-pulse" data-testid="admin-loading-skeleton">
      <div className="mb-8 space-y-3">
        <Bar className="h-7 w-64" />
        <Bar className="h-4 w-80 bg-slate-100" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <Bar className="h-4 w-4" />
            <Bar className="h-6 w-16" />
            <Bar className="h-3 w-20 bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <Bar className="h-4 w-32" />
            {Array.from({ length: 4 }).map((_, j) => (
              <Bar key={j} className="h-3 w-full bg-slate-100" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
