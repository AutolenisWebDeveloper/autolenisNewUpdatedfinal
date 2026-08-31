// Streaming fallback for the Content Engine.
//
// The dashboard is force-dynamic and runs seven parallel aggregate queries
// before first paint; without this the operator got a blank frame for the whole
// round trip. Mirrors the real page's shape so the layout does not jump.

export default function Loading() {
  return (
    <div className="p-6 md:p-8" data-testid="content-loading">
      <span className="sr-only" role="status">
        Loading the content engine…
      </span>
      <div className="animate-pulse space-y-6" aria-hidden>
        <div className="space-y-3">
          <div className="h-6 w-56 rounded bg-slate-200" />
          <div className="h-4 w-96 max-w-full rounded bg-slate-100" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-11 w-36 rounded-al-md bg-slate-100" />
          ))}
        </div>
        <div className="h-14 rounded-al-lg bg-slate-100" />
        <div className="h-96 rounded-al-lg bg-slate-100" />
      </div>
    </div>
  );
}
