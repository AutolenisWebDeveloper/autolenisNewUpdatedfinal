import type { Metadata } from "next";

export const metadata: Metadata = { title: "Application Status", robots: { index: false, follow: false } };

import Link from "next/link";
import { XCircle, Mail } from "lucide-react";

// FCRA adverse action language is a legal requirement on every DECLINED result page
export default function PrequalDeclinedPage() {
  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="prequal-declined-page">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <XCircle size={32} className="text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Application not approved</h1>
        <p className="text-slate-500 text-sm leading-relaxed">We were unable to pre-qualify you at this time. You have the right to know why.</p>
      </div>

      {/* FCRA adverse-action email confirmation — must be visible, not buried */}
      <div
        className="flex items-start gap-3 rounded-xl border border-[#0B5FD1]/30 bg-[#F8F9FB] p-4 mb-6"
        data-testid="adverse-action-email-notice"
      >
        <Mail size={20} className="text-[#0B5FD1] mt-0.5 shrink-0" />
        <div className="text-sm text-slate-700 leading-relaxed">
          <p className="mb-2">
            An adverse action notice has been sent to your email address explaining this decision and your rights under the Fair Credit Reporting Act.
          </p>
          <p>
            You have the right to obtain a free copy of your consumer report from <strong>MicroBilt Corporation</strong> (<a href="tel:18008844747" className="text-[#0B5FD1] hover:underline">1-800-884-4747</a>) within 60 days.
          </p>
        </div>
      </div>

      {/* FCRA Adverse Action Notice — LEGALLY REQUIRED */}
      <div className="border-2 border-slate-200 rounded-xl p-6 mb-6" data-testid="fcra-adverse-action-notice">
        <h2 className="font-semibold text-slate-900 mb-3 text-sm">Notice of Adverse Action — Fair Credit Reporting Act (FCRA)</h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-4">
          Your application was reviewed in whole or in part based on information obtained from a consumer reporting agency. You have the right to obtain a free copy of your consumer report from the agency below and to dispute the accuracy of any information in your report.
        </p>
        <div className="bg-slate-50 rounded-lg p-4 text-sm" data-testid="fcra-cra-info">
          <p className="font-semibold text-slate-800 mb-2">Consumer Reporting Agency Used:</p>
          <p className="text-slate-600"><strong>MicroBilt Corporation</strong></p>
          <p className="text-slate-600">1-800-884-4747</p>
          <p className="text-slate-600">
            <a href="https://www.microbilt.com" target="_blank" rel="noopener noreferrer" className="text-[#0B5FD1] hover:underline" data-testid="microbilt-link">
              www.microbilt.com
            </a>
          </p>
        </div>
        <p className="text-xs text-slate-400 mt-4">
          The agency did not make the adverse decision and cannot explain why it was made. You have the right to dispute inaccurate information under the Fair Credit Reporting Act (15 U.S.C. § 1681 et seq.).
        </p>
      </div>

      <div className="text-center space-y-3">
        <p className="text-sm text-slate-600">You may apply again in 30 days, or provide your own pre-approval from your bank or credit union.</p>
        <Link href="/buyer/prequal/external" data-testid="use-external-financing-link" className="text-sm text-[#0B5FD1] font-semibold hover:underline block">
          I have my own bank financing →
        </Link>
        <Link href="/buyer/dashboard" data-testid="back-to-dashboard-link" className="text-sm text-slate-400 hover:underline block">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
