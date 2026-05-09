// ENH-7 — Fast-track onboarding for buyer-shortlisted Lane 2 vehicles
// Triggered when a buyer shortlists a vehicle and the dealer hasn't yet completed onboarding

import { requireDealer } from "@/lib/auth/dealer-session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, ArrowRight } from "lucide-react";

export default async function FastTrackOnboardingPage() {
  await requireDealer();

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="fast-track-onboarding-page">
      <div className="flex items-center gap-3 mb-2">
        <Zap size={22} className="text-[#50D14E]" />
        <h1 className="text-xl font-bold text-slate-900">Fast-Track Onboarding</h1>
        <Badge variant="green">Expedited</Badge>
      </div>
      <p className="text-sm text-slate-500 mb-8">
        A buyer has shortlisted one of your vehicles. Complete these steps quickly to be eligible for their auction invitation.
      </p>

      <div className="bg-[#50D14E]/10 border border-[#50D14E]/30 rounded-xl p-5 mb-8" data-testid="fast-track-alert">
        <p className="text-sm font-semibold text-green-800">Buyer interest detected</p>
        <p className="text-sm text-green-700 mt-1">A buyer with a confirmed budget has added your vehicle to their shortlist. Complete onboarding to be invited when their auction launches.</p>
      </div>

      <div className="space-y-3 mb-8">
        {[
          { n: "01", t: "Verify dealership license", d: "Upload your dealer license number for quick verification." },
          { n: "02", t: "Confirm inventory listing", d: "Confirm the vehicle is still available and at the listed price." },
          { n: "03", t: "Set your availability", d: "Confirm you can respond to auction invitations within 48 hours." },
        ].map(step => (
          <div key={step.n} data-testid={`fast-track-step-${step.n}`} className="flex gap-4 p-4 bg-white border border-slate-200 rounded-xl">
            <span className="text-2xl font-bold text-[#0B5FD1]/20 shrink-0">{step.n}</span>
            <div>
              <p className="font-semibold text-slate-800 text-sm">{step.t}</p>
              <p className="text-xs text-slate-400 mt-0.5">{step.d}</p>
            </div>
          </div>
        ))}
      </div>

      <Button className="w-full" size="lg" href="/dealer/onboarding" data-testid="fast-track-continue-btn">
        Complete Fast-Track Setup <ArrowRight size={15} />
      </Button>
    </div>
  );
}
