import Link from "next/link";
import { SearchX, ArrowLeft } from "lucide-react";

// Buyer-portal not-found boundary.
//
// Nine buyer pages call notFound() — auction detail and its offers view, vehicle
// detail, request detail and its offer view, message thread, contract detail,
// deal receipt and deal complete. Without this file they fell through to the
// ROOT app/not-found.tsx, which renders a full-screen marketing 404 whose only
// action is "Return home" pointing at "/". An authenticated buyer following a
// stale link — an old auction, a superseded contract, a deleted listing — was
// therefore ejected from the portal entirely, with no route back into it.
//
// This renders INSIDE app/buyer/layout.tsx, so the sidebar and journey
// navigator stay put and the buyer never leaves their portal. It states plainly
// what happened (the item is gone or was never theirs — the pages call
// notFound() for both cases, and distinguishing them would leak whether another
// buyer's record exists) and offers real ways forward.
export default function BuyerNotFound() {
  return (
    <div
      data-testid="buyer-not-found"
      className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center"
    >
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mb-4">
        <SearchX className="text-slate-400" size={24} aria-hidden="true" />
      </div>
      <h2 className="text-xl font-semibold text-slate-900 mb-2">
        We couldn&apos;t find that
      </h2>
      <p className="text-sm text-slate-500 max-w-sm mb-6 leading-relaxed">
        This page may have moved, the item may no longer be available, or it may
        not belong to your account. Nothing is wrong with your account — you can
        pick up where you left off below.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/buyer/dashboard"
          data-testid="buyer-not-found-dashboard-btn"
          className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to my dashboard
        </Link>
        <Link
          href="/buyer/messages"
          data-testid="buyer-not-found-support-btn"
          className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-slate-200 text-slate-600 font-medium text-sm rounded-xl hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2"
        >
          Message support
        </Link>
      </div>
    </div>
  );
}
