import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import Link from "next/link";

export const metadata: Metadata = { title: "Buyer Journey Map — Admin" };
export const dynamic = "force-dynamic";

const STAGES = [
  { n:  1, id: "account",     label: "Account",      color: "blue",
    trigger: "User account created",
    detail:  "Buyer registered and a User record exists in the database.",
    logic:   "Always true once account is created." },
  { n:  2, id: "onboarding",  label: "Onboarding",   color: "slate",
    trigger: "buyer.onboardingComplete = true",
    detail:  "Buyer accepted Terms of Service and completed the onboarding wizard.",
    logic:   "buyer.onboardingComplete === true" },
  { n:  3, id: "prequal",     label: "Pre-Qual",     color: "purple",
    trigger: "PreQualification record exists",
    detail:  "Buyer submitted income info. MicroBilt iPredict returned a decision.",
    logic:   "buyer.preQualification != null" },
  { n:  4, id: "search",      label: "Search",       color: "indigo",
    trigger: "Auto-unlocked after prequal",
    detail:  "Buyer can browse inventory and search for vehicles.",
    logic:   "Same as prequal — unlocked simultaneously" },
  { n:  5, id: "shortlist",   label: "Shortlist",    color: "violet",
    trigger: "Shortlist.items.length > 0",
    detail:  "Buyer saved at least one vehicle to their shortlist.",
    logic:   "buyer.shortlists?.items?.length > 0" },
  { n:  6, id: "deposit",     label: "Deposit",      color: "green",
    trigger: "Deposit.status = PAID",
    detail:  "Buyer paid the $99 Auction Access Deposit via Stripe.",
    logic:   "deposits.some(d => d.status === 'PAID')" },
  { n:  7, id: "auction",     label: "Auction",      color: "amber",
    trigger: "Active deal exists (auction concluded)",
    detail:  "The 48-hour dealer auction ran and buyer has a deal record.",
    logic:   "activeDeal != null" },
  { n:  8, id: "select-deal", label: "Select Deal",  color: "orange",
    trigger: "Deal record created",
    detail:  "Buyer selected a dealer offer. A Deal row was created.",
    logic:   "activeDeal != null" },
  { n:  9, id: "financing",   label: "Financing",    color: "yellow",
    trigger: "deal.financingPath is set",
    detail:  "Buyer chose dealer financing, external pre-approval, or cash.",
    logic:   "activeDeal.financingPath != null" },
  { n: 10, id: "fee",         label: "Service Fee",  color: "lime",
    trigger: "deal.feePaidAt is set",
    detail:  "Buyer paid the $400 AutoLenis Service Fee.",
    logic:   "activeDeal.feePaidAt != null" },
  { n: 11, id: "insurance",   label: "Insurance",    color: "teal",
    trigger: "deal.insuranceStatus != NOT_STARTED",
    detail:  "Insurance step engaged. Required before contract.",
    logic:   "activeDeal.insuranceStatus !== 'NOT_STARTED'" },
  { n: 12, id: "contract",    label: "Contract",     color: "cyan",
    trigger: "deal.contractShieldStatus = PASS",
    detail:  "Contract Shield scan passed. Document approved.",
    logic:   "activeDeal.contractShieldStatus === 'PASS'" },
  { n: 13, id: "sign",        label: "Sign",         color: "sky",
    trigger: "deal.status = PICKUP_SCHEDULED or COMPLETED",
    detail:  "Buyer signed purchase agreement via DocuSign.",
    logic:   "activeDeal.status ∈ {PICKUP_SCHEDULED, PICKUP_COMPLETE, COMPLETED}" },
  { n: 14, id: "pickup",      label: "Pickup",       color: "rose",
    trigger: "deal.status = COMPLETED",
    detail:  "Vehicle pickup or delivery completed. Deal marked COMPLETED.",
    logic:   "activeDeal.status === 'COMPLETED'" },
];

const CLR: Record<string, string> = {
  blue:   "bg-blue-50 border-blue-200 text-blue-800",
  slate:  "bg-slate-50 border-slate-200 text-slate-700",
  purple: "bg-purple-50 border-purple-200 text-purple-800",
  indigo: "bg-indigo-50 border-indigo-200 text-indigo-800",
  violet: "bg-violet-50 border-violet-200 text-violet-800",
  green:  "bg-green-50 border-green-200 text-green-800",
  amber:  "bg-amber-50 border-amber-200 text-amber-800",
  orange: "bg-orange-50 border-orange-200 text-orange-800",
  yellow: "bg-yellow-50 border-yellow-200 text-yellow-800",
  lime:   "bg-lime-50 border-lime-200 text-lime-800",
  teal:   "bg-teal-50 border-teal-200 text-teal-800",
  cyan:   "bg-cyan-50 border-cyan-200 text-cyan-800",
  sky:    "bg-sky-50 border-sky-200 text-sky-800",
  rose:   "bg-rose-50 border-rose-200 text-rose-800",
};

export default async function BuyerJourneyMapPage() {
  await requireAdmin();

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Buyer Journey Map</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          All 14 stages in the AutoLenis buying process. Completion logic mirrors the live
          buyer journey-status system. Open any buyer → Journey tab to view and unlock.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: "Total Stages", value: "14" },
          { label: "Deposit Required", value: "Stage 6" },
          { label: "Service Fee Required", value: "Stage 10" },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-xs text-slate-400 mb-1">{s.label}</p>
            <p className="text-sm font-bold text-slate-800">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        <div className="absolute left-[21px] top-5 bottom-5 w-0.5 bg-slate-200 z-0" />
        <div className="space-y-2.5 relative z-10">
          {STAGES.map(stage => (
            <div key={stage.id} className="flex items-start gap-4">
              <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center shrink-0 ${CLR[stage.color]}`}>
                <span className="text-xs font-black">{stage.n}</span>
              </div>
              <div className={`flex-1 border rounded-2xl px-4 py-3 ${CLR[stage.color]}`}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-bold text-sm">{stage.label}</span>
                  <code className="text-[10px] font-mono opacity-50 bg-white/60 px-1.5 py-0.5 rounded">{stage.id}</code>
                </div>
                <p className="text-xs opacity-80 leading-relaxed">{stage.detail}</p>
                <p className="text-[10px] font-mono opacity-50 mt-1.5">
                  Trigger: {stage.trigger}
                </p>
                <p className="text-[10px] font-mono opacity-40 mt-0.5">
                  Logic: {stage.logic}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 bg-[#0B5FD1]/5 border border-[#0B5FD1]/20 rounded-2xl p-5">
        <p className="text-sm font-semibold text-[#0B5FD1] mb-1">
          View a specific buyer&apos;s journey
        </p>
        <p className="text-xs text-slate-500 mb-3">
          Open any buyer profile → Journey tab to see their stage-by-stage progress,
          unlock individual stages, or unlock the entire journey at once.
          All actions are logged to the admin audit trail.
        </p>
        <Link href="/admin/buyers"
          className="inline-flex items-center gap-2 bg-[#0B5FD1] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#0944a8]">
          Go to Buyer List →
        </Link>
      </div>
    </div>
  );
}
