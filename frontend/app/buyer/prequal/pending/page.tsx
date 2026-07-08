import type { Metadata } from "next";

export const metadata: Metadata = { title: "Prequalification Pending", robots: { index: false, follow: false } };

import { Clock, Mail, CheckCircle2, Car, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PrequalPendingPage() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6 md:py-10" data-testid="prequal-pending-page">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
          <Clock size={30} className="text-amber-600" />
        </div>
        <h1 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 tracking-tight mb-2">Application under review</h1>
        <p className="text-slate-500 text-sm leading-relaxed mb-8">
          Your prequalification requires additional manual review. Our compliance team will process your application and notify you within 1-2 business days.
        </p>
      </div>
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-6 text-left">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em] mb-4">What happens next</p>
        <ul className="space-y-3 text-sm text-slate-600">
          <li className="flex items-start gap-3">
            <Mail size={16} className="text-al-primary mt-0.5 shrink-0" />
            You will receive an email notification when your review is complete
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle2 size={16} className="text-al-success mt-0.5 shrink-0" />
            No further action is required from you at this time
          </li>
          <li className="flex items-start gap-3">
            <Car size={16} className="text-slate-400 mt-0.5 shrink-0" />
            You can still browse our inventory while you wait
          </li>
        </ul>
      </div>
      <Button href="/buyer/search" size="lg" variant="outline" className="w-full mt-4" data-testid="pending-browse-btn">
        Browse inventory while you wait <ArrowRight size={16} />
      </Button>
    </div>
  );
}
