// Feature 15 — Financing Scenario Tool
// CRITICAL: maxOtdAmountCents is READ-ONLY — the configurator NEVER emits or modifies this value
// D1 equivalent: maxOtdAmountCents from iPredict is immutable — no UI control can modify it

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, CreditCard } from "lucide-react";

const FINANCING_PATHS = [
  { id: "DEALER", label: "Dealer Financing", desc: "Finance through the dealer — rate included in your offer. Quick approval, may include APR options." },
  { id: "EXTERNAL", label: "Own Bank / Credit Union", desc: "Use a pre-approval from your own bank or credit union. Upload your approval letter." },
  { id: "CASH", label: "Cash Purchase", desc: "Pay the full out-the-door price in cash or via wire transfer. No financing needed." },
];

export default function FinancingPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [initialPath, setInitialPath] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/buyer/deal/financing")
      .then(r => r.json())
      .then((d: { success: boolean; data?: { financingPath?: string } }) => {
        if (d.success && d.data?.financingPath) {
          setSelected(d.data.financingPath);
          setInitialPath(d.data.financingPath);
        }
      })
      .catch((err: unknown) => { console.error("[financing] Failed to load current financing path:", err); })
      .finally(() => setLoadingInitial(false));
  }, []);

  async function saveChoice() {
    if (!selected) return;
    setLoading(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/buyer/deal/financing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financingPath: selected }),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setSaveError(body.error?.message ?? "We couldn't save your financing choice. Please try again.");
      }
    } catch {
      setSaveError("Network error — please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (saved) {
    return (
      <div className="p-6 md:p-8 max-w-lg" data-testid="financing-saved">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-[#ECFDF5] flex items-center justify-center">
            <CheckCircle2 size={20} className="text-[#10B981]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#111827]">Financing confirmed</p>
            <p className="text-xs text-[#6B7280]">
              {selected === "DEALER"   && "Dealer financing — rate included in your offer."}
              {selected === "EXTERNAL" && "Your own bank / credit union financing."}
              {selected === "CASH"     && "Cash purchase — no financing needed."}
            </p>
          </div>
        </div>
        {selected === "EXTERNAL" && (
          <div className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-xl p-5 mb-6">
            <p className="text-sm font-semibold text-[#111827] mb-1">Upload your pre-approval letter</p>
            <p className="text-xs text-[#4B5563] mb-3">
              Upload your lender pre-approval letter or submit your financing details for verification.
            </p>
            <a href="/buyer/prequal/external"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#0B5FD1] hover:text-[#0A4DB8] transition-colors">
              Submit pre-approval details →
            </a>
          </div>
        )}
        <a href="/buyer/deal/payment"
          className="flex items-center justify-center gap-2 w-full py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
          data-testid="financing-continue-btn">
          Continue to Fee Payment
        </a>
        <p className="text-xs text-center text-[#9CA3AF] mt-3">
          You can change your financing selection at any time before signing.
        </p>
      </div>
    );
  }

  if (loadingInitial) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="financing-loading">
        <div className="h-7 w-56 bg-slate-100 rounded-md animate-pulse mb-2" />
        <div className="h-4 w-72 bg-slate-100 rounded-md animate-pulse mb-6" />
        <div className="space-y-3 mb-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="financing-page">
      <h1 className="text-xl font-bold text-slate-900 mb-2">Choose Your Financing</h1>
      <p className="text-sm text-slate-500 mb-6">Select how you&apos;d like to pay for your vehicle.</p>

      {/* Note: maxOtdAmountCents is read-only from iPredict — no UI allows modifying it */}
      <div className="space-y-3 mb-6">
        {FINANCING_PATHS.map(path => (
          <button
            key={path.id}
            onClick={() => setSelected(path.id)}
            data-testid={`financing-option-${path.id.toLowerCase()}`}
            className={`w-full text-left p-5 rounded-xl border-2 transition-colors ${selected === path.id ? "border-[#0B5FD1] bg-[#0B5FD1]/5" : "border-slate-200 hover:border-slate-300 bg-white"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900 text-sm">{path.label}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{path.desc}</p>
              </div>
              {selected === path.id && <CheckCircle2 size={18} className="text-[#0B5FD1] shrink-0 mt-0.5" />}
            </div>
          </button>
        ))}
      </div>

      {/* Feature 18 — Link to Pre-Approval Display */}
      <div className="flex items-center justify-between mb-6 p-3 bg-slate-50 rounded-lg border border-slate-200">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <CreditCard size={14} className="text-[#0B5FD1]" />
          <span>View pre-approvals &amp; payment calculator</span>
        </div>
        <Link
          href="/buyer/deal/financing/pre-approval"
          data-testid="view-pre-approval-link"
          className="text-xs text-[#0B5FD1] font-semibold hover:underline flex items-center gap-1"
        >
          Open <ArrowRight size={11} />
        </Link>
      </div>

      {saveError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-md mb-3" data-testid="financing-save-error">
          {saveError}
        </p>
      )}

      <Button className="w-full" size="lg" onClick={saveChoice} disabled={!selected || loading} data-testid="financing-save-btn">
        {loading ? "Saving…" : initialPath ? "Update Financing Choice" : "Confirm Financing Choice"} <ArrowRight size={15} />
      </Button>
    </div>
  );
}
