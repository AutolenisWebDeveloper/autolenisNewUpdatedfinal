// Default buyer-portal loading skeleton (UI-28). Previously only the dashboard
// and shortlist had a loading.tsx, so navigating to requests/messages/documents/
// activity/auctions/deal showed a blank screen until the server component
// resolved. This route-group default gives every buyer page a skeleton; a page
// can still override it with its own loading.tsx.
export default function BuyerLoading() {
  return (
    <div className="w-full mx-auto p-6 md:p-8 max-w-3xl" data-testid="buyer-loading-skeleton">
      <div className="mb-8 animate-pulse">
        <div className="h-7 w-56 bg-slate-200 rounded mb-3" />
        <div className="h-4 w-72 bg-slate-100 rounded" />
      </div>

      <div className="space-y-3 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl px-5 py-4">
            <div className="h-4 w-1/3 bg-slate-200 rounded mb-2" />
            <div className="h-3 w-1/2 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
