import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import Link from "next/link";

export const metadata: Metadata = { title: "Buyer Journey Map — Admin" };
export const dynamic = "force-dynamic";

const STAGES = [
  { n:  1, id: "account",     label: "Account",      color: "blue",
    route: "/buyer/dashboard",
    trigger: "User account created",
    detail: "Buyer registered. User record exists in the database.",
    buyerSees: "Dashboard with account confirmation and next steps." },

  { n:  2, id: "onboarding",  label: "Onboarding",   color: "slate",
    route: "/buyer/onboarding",
    trigger: "buyer.onboardingComplete = true",
    detail: "Buyer accepted Terms of Service and completed the onboarding wizard.",
    buyerSees: "Onboarding wizard with terms acceptance and profile setup." },

  { n:  3, id: "prequal",     label: "Pre-Qual",     color: "purple",
    route: "/buyer/prequal",
    trigger: "PreQualification.decision = APPROVED and expiresAt > now",
    detail: "Buyer submitted income info. MicroBilt iPredict returned APPROVED.",
    buyerSees: "Pre-qualification form — income, employment, and financing goals." },

  { n:  4, id: "search",      label: "Search",       color: "indigo",
    route: "/buyer/search",
    trigger: "Auto-unlocked with prequal",
    detail: "Buyer has access to vehicle inventory search.",
    buyerSees: "Inventory search with filters for make, model, year, and price." },

  { n:  5, id: "shortlist",   label: "Shortlist",    color: "violet",
    route: "/buyer/shortlist",
    trigger: "Shortlist.items.length > 0",
    detail: "Buyer saved at least one vehicle to their shortlist.",
    buyerSees: "Shortlist view with saved vehicles, details, and comparison tools." },

  { n:  6, id: "deposit",     label: "Deposit",      color: "green",
    route: "/buyer/deposit",
    trigger: "Deposit.status = PAID",
    detail: "Buyer paid the $99 Auction Access Deposit via Stripe.",
    buyerSees: "Stripe payment form for the $99 refundable deposit." },

  { n:  7, id: "auction",     label: "Auction",      color: "amber",
    route: "/buyer/auctions",
    trigger: "Active deal exists (post-auction)",
    detail: "The 48-hour dealer auction ran. Buyer monitors live offers.",
    buyerSees: "Auction dashboard — live offers, time remaining, and dealer count." },

  { n:  8, id: "select-deal", label: "Select Deal",  color: "orange",
    route: "/buyer/deal",
    trigger: "Deal record created",
    detail: "Buyer reviewed all offers and selected one. Deal was created.",
    buyerSees: "Offer comparison — price, terms, financing options per dealer." },

  { n:  9, id: "financing",   label: "Financing",    color: "yellow",
    route: "/buyer/deal/financing",
    trigger: "deal.financingPath is set (DEALER | EXTERNAL | CASH)",
    detail: "Buyer chose a financing path.",
    buyerSees: "Financing options: dealer financing, pre-approval upload, or cash." },

  { n: 10, id: "fee",         label: "Service Fee",  color: "lime",
    route: "/buyer/fee",
    trigger: "deal.feePaidAt is set",
    detail: "Buyer paid the $499 AutoLenis Service Fee ($400 balance after $99 deposit).",
    buyerSees: "Service fee payment via Stripe — $400 balance." },

  { n: 11, id: "insurance",   label: "Insurance",    color: "teal",
    route: "/buyer/insurance",
    trigger: "deal.insuranceStatus != NOT_STARTED",
    detail: "Insurance step engaged. Required before contract review.",
    buyerSees: "Insurance options: get a quote, upload a policy, or mark as handled." },

  { n: 12, id: "contract",    label: "Contract",     color: "cyan",
    route: "/buyer/contracts",
    trigger: "deal.contractShieldStatus = PASS",
    detail: "Contract Shield review passed. Purchase agreement ready to sign.",
    buyerSees: "Contract review with Contract Shield annotations on key terms." },

  { n: 13, id: "sign",        label: "Sign",         color: "sky",
    route: "/buyer/esign",
    trigger: "deal.status = PICKUP_SCHEDULED or COMPLETED",
    detail: "Buyer signed the purchase agreement via DocuSign.",
    buyerSees: "DocuSign embedded signing interface for the purchase agreement." },

  { n: 14, id: "pickup",      label: "Pickup",       color: "rose",
    route: "/buyer/pickup",
    trigger: "deal.status = COMPLETED",
    detail: "Vehicle pickup or delivery completed. Deal marked COMPLETED.",
    buyerSees: "Pickup scheduling tool with QR code for vehicle collection." },
];

const CLR: Record<string, { card: string; dot: string; badge: string }> = {
  blue:   { card: "bg-blue-50 border-blue-200",   dot: "bg-blue-600 text-white border-blue-300",     badge: "bg-blue-100 text-blue-800"   },
  slate:  { card: "bg-slate-50 border-slate-200", dot: "bg-slate-600 text-white border-slate-300",   badge: "bg-slate-100 text-slate-800" },
  purple: { card: "bg-purple-50 border-purple-200", dot: "bg-purple-600 text-white border-purple-300", badge: "bg-purple-100 text-purple-800" },
  indigo: { card: "bg-indigo-50 border-indigo-200", dot: "bg-indigo-600 text-white border-indigo-300", badge: "bg-indigo-100 text-indigo-800" },
  violet: { card: "bg-violet-50 border-violet-200", dot: "bg-violet-600 text-white border-violet-300", badge: "bg-violet-100 text-violet-800" },
  green:  { card: "bg-green-50 border-green-200",  dot: "bg-green-600 text-white border-green-300",   badge: "bg-green-100 text-green-800"  },
  amber:  { card: "bg-amber-50 border-amber-200",  dot: "bg-amber-600 text-white border-amber-300",   badge: "bg-amber-100 text-amber-800"  },
  orange: { card: "bg-orange-50 border-orange-200", dot: "bg-orange-600 text-white border-orange-300", badge: "bg-orange-100 text-orange-800" },
  yellow: { card: "bg-yellow-50 border-yellow-200", dot: "bg-yellow-600 text-white border-yellow-300", badge: "bg-yellow-100 text-yellow-800" },
  lime:   { card: "bg-lime-50 border-lime-200",   dot: "bg-lime-700 text-white border-lime-300",     badge: "bg-lime-100 text-lime-800"   },
  teal:   { card: "bg-teal-50 border-teal-200",   dot: "bg-teal-600 text-white border-teal-300",     badge: "bg-teal-100 text-teal-800"   },
  cyan:   { card: "bg-cyan-50 border-cyan-200",   dot: "bg-cyan-600 text-white border-cyan-300",     badge: "bg-cyan-100 text-cyan-800"   },
  sky:    { card: "bg-sky-50 border-sky-200",     dot: "bg-sky-600 text-white border-sky-300",       badge: "bg-sky-100 text-sky-800"     },
  rose:   { card: "bg-rose-50 border-rose-200",   dot: "bg-rose-600 text-white border-rose-300",     badge: "bg-rose-100 text-rose-800"   },
};

export default async function BuyerJourneyMapPage() {
  await requireAdmin();

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Buyer Journey Map</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          All 14 stages of the AutoLenis buying process. Click{" "}
          <span className="font-semibold text-slate-700">Open Buyer Page</span> on any
          stage to see exactly what the buyer sees. Go to a buyer profile →
          Journey tab to unlock or complete individual stages.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: "Total Stages", value: "14" },
          { label: "Deposit Required", value: "Stage 6 — $99" },
          { label: "Service Fee Required", value: "Stage 10 — $499 total" },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-xs text-slate-400 mb-1">{s.label}</p>
            <p className="text-sm font-bold text-slate-800">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Stage cards with connector line */}
      <div className="relative">
        <div className="absolute left-[21px] top-6 bottom-6 w-0.5 bg-slate-200 z-0" />
        <div className="space-y-3 relative z-10">
          {STAGES.map(stage => {
            const c = CLR[stage.color] ?? CLR.slate;
            return (
              <div key={stage.id} className="flex items-start gap-4">
                {/* Stage number dot */}
                <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center shrink-0 ${c.dot}`}>
                  <span className="text-xs font-black">{stage.n}</span>
                </div>

                {/* Card */}
                <div className={`flex-1 border rounded-2xl overflow-hidden ${c.card}`}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 pt-3 pb-2 gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-sm text-slate-900">{stage.label}</span>
                      <code className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${c.badge}`}>
                        {stage.id}
                      </code>
                    </div>
                    {/* Open buyer page */}
                    <a href={stage.route} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-semibold text-[#0B5FD1] border border-[#0B5FD1]/30 bg-white px-3 py-1.5 rounded-lg hover:bg-[#0B5FD1]/5 whitespace-nowrap shrink-0">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                      Open Buyer Page
                    </a>
                  </div>
                  {/* Body */}
                  <div className="px-4 pb-3">
                    <p className="text-xs text-slate-600 leading-relaxed mb-1.5">{stage.detail}</p>
                    <p className="text-[10px] text-slate-400 mb-1.5">
                      <strong className="text-slate-500">Trigger:</strong> {stage.trigger}
                    </p>
                    <div className="bg-white/70 border border-slate-100 rounded-xl px-3 py-2">
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                        What the buyer sees
                      </p>
                      <p className="text-xs text-slate-600">{stage.buyerSees}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-8 bg-[#0B5FD1]/5 border border-[#0B5FD1]/20 rounded-2xl p-5">
        <p className="text-sm font-semibold text-[#0B5FD1] mb-1">Control a specific buyer&apos;s journey</p>
        <p className="text-xs text-slate-500 mb-3">
          Open any buyer profile → Journey tab to unlock stages, mark them complete,
          or advance the buyer through the entire process in one click.
        </p>
        <Link href="/admin/buyers"
          className="inline-flex items-center gap-2 bg-[#0B5FD1] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#0944a8]">
          Go to Buyer List →
        </Link>
      </div>
    </div>
  );
}
