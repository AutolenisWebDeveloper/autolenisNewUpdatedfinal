// Route-level loading skeleton for the buyer shortlist (server-fetched page).
export default function Loading() {
  return (
    <div data-testid="shortlist-loading" className="p-6 space-y-4">
      <div className="h-7 w-48 rounded bg-slate-200 animate-pulse" />
      <div className="h-4 w-72 rounded bg-slate-100 animate-pulse" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="h-32 w-full rounded-lg bg-slate-200 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-slate-200 animate-pulse" />
            <div className="h-4 w-1/2 rounded bg-slate-100 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
