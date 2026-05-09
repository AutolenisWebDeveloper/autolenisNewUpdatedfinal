import type { Metadata } from "next";

export const metadata: Metadata = { title: "Prequalification Pending", robots: { index: false, follow: false } };

import { Clock } from "lucide-react";

export default function PrequalPendingPage() {
  return (
    <div className="p-6 md:p-8 max-w-lg" data-testid="prequal-pending-page">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <Clock size={32} className="text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Application under review</h1>
        <p className="text-slate-500 text-sm leading-relaxed mb-8">
          Your prequalification requires additional manual review. Our compliance team will process your application and notify you within 1-2 business days.
        </p>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-left text-sm text-slate-600">
          <p className="font-semibold text-slate-800 mb-2">What happens next</p>
          <ul className="space-y-1.5 text-slate-500">
            <li>• You will receive an email notification when your review is complete</li>
            <li>• No further action is required from you at this time</li>
            <li>• You can still browse our inventory while you wait</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
