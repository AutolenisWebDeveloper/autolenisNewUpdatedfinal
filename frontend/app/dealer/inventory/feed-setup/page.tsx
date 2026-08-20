// DMS Feed Setup — automated DMS feed ingestion is not yet available.
//
// This page previously rendered a form whose submit was a setTimeout that then
// showed "Feed connected — your inventory will sync every N hours" WITHOUT any
// API call or persistence (success theater). There is no dealer-facing DMS feed
// ingestion backend to wire it to, and building one is out of scope. Rather than
// deceive dealers into believing sync is configured, this surface is honestly
// gated to "coming soon" and points to the inventory paths that DO work today
// (bulk upload and manual add).

import Link from "next/link";
import type { Metadata } from "next";
import { RefreshCw, Upload, Plus, Clock } from "lucide-react";

export const metadata: Metadata = { title: "DMS Feed Setup", robots: { index: false, follow: false } };

export default function DealerFeedSetupPage() {
  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="feed-setup-page">
      <div className="flex items-center gap-3 mb-6">
        <RefreshCw size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">DMS Feed Setup</h1>
      </div>

      <div
        className="bg-al-primary-subtle border border-slate-200 rounded-xl p-5 mb-6"
        data-testid="feed-coming-soon"
      >
        <div className="flex items-start gap-3">
          <Clock size={18} className="text-al-primary shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold text-slate-900">Automated DMS sync is coming soon</p>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">
              Direct Dealer Management System feed integration isn&apos;t available yet. When it
              launches you&apos;ll be able to connect your DMS export URL here and AutoLenis will pull
              your inventory on a schedule. In the meantime, use the options below to keep your
              inventory current.
            </p>
          </div>
        </div>
      </div>

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Add inventory now
      </p>
      <div className="grid gap-3">
        <Link
          href="/dealer/inventory/bulk-upload"
          data-testid="feed-alt-bulk-upload"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
        >
          <Upload size={18} className="text-al-primary shrink-0" aria-hidden="true" />
          <span>
            <span className="block text-sm font-semibold text-slate-900">Bulk upload (CSV)</span>
            <span className="block text-xs text-slate-500">Import many vehicles at once from a spreadsheet export.</span>
          </span>
        </Link>
        <Link
          href="/dealer/inventory/add"
          data-testid="feed-alt-manual-add"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
        >
          <Plus size={18} className="text-al-primary shrink-0" aria-hidden="true" />
          <span>
            <span className="block text-sm font-semibold text-slate-900">Add a vehicle manually</span>
            <span className="block text-xs text-slate-500">Enter a single vehicle&apos;s details by hand.</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
