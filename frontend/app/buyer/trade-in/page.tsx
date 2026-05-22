// System 18 — Trade-In
// Buyer trade-in submission with pre-fill support via URL params
// Feature 17 (Phase 3): Trade-In Valuation Widget added below the form

"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { CheckCircle2, Car } from "lucide-react";
import TradeInValuationWidget from "@/components/buyer/TradeInValuationWidget";

const CONDITIONS = ["Excellent — like new, no mechanical issues", "Good — minor wear, fully functional", "Fair — visible wear, some issues", "Poor — significant issues"];
const LOAN_STATUSES = ["Paid off — no loan", "Have a loan — positive equity", "Have a loan — negative equity (underwater)", "Unsure"];

type ExistingTradeIn = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  status: string;
  valuationCents: number | null;
};

export default function TradeInPage() {
  const searchParams = useSearchParams();
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [existingTradeIn, setExistingTradeIn] = useState<ExistingTradeIn | null>(null);
  const [form, setForm] = useState({
    vin: "", year: "", make: "", model: "", trim: "", mileage: "",
    condition: "", loanStatus: "", loanBalance: "", notes: ""
  });

  // Check for existing trade-in submission on mount
  useEffect(() => {
    let cancelled = false;
    fetch("/api/buyer/trade-in")
      .then((r) => r.json())
      .then((d: { success?: boolean; data?: { tradeIns?: ExistingTradeIn[] } }) => {
        if (cancelled) return;
        const latest = d.data?.tradeIns?.[0];
        if (latest) setExistingTradeIn(latest);
      })
      .catch(() => { /* non-fatal — buyer can still submit */ })
      .finally(() => { if (!cancelled) setLoadingExisting(false); });
    return () => { cancelled = true; };
  }, []);

  // Pre-fill support via URL params
  useEffect(() => {
    const prefill = {
      vin: searchParams.get("vin") ?? "",
      year: searchParams.get("year") ?? "",
      make: searchParams.get("make") ?? "",
      model: searchParams.get("model") ?? "",
    };
    if (Object.values(prefill).some(Boolean)) {
      setForm(prev => ({ ...prev, ...prefill }));
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/buyer/trade-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vin: form.vin || undefined, year: parseInt(form.year), make: form.make, model: form.model,
        trim: form.trim || undefined, mileage: form.mileage ? parseInt(form.mileage) : undefined,
        condition: form.condition.toUpperCase(),
        loanStatus: form.loanStatus || undefined,
        loanBalanceCents: form.loanBalance ? Math.round(parseFloat(form.loanBalance) * 100) : undefined,
        notes: form.notes || undefined,
      }),
    });
    setLoading(false);
    if (res.ok) setSubmitted(true);
    else { const d = await res.json() as { error?: { message?: string } }; setError(d.error?.message ?? "Submission failed"); }
  }

  if (loadingExisting) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="trade-in-loading">
        <div className="h-7 w-48 bg-slate-100 rounded-md animate-pulse mb-6" />
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (submitted || existingTradeIn) {
    const ti = existingTradeIn;
    return (
      <div className="p-6 md:p-8 max-w-lg" data-testid="trade-in-success">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={28} className="text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Trade-in submitted</h2>
          <p className="text-slate-500 text-sm leading-relaxed mb-6">
            Your trade-in information has been saved. Dealers will see this when reviewing your auction and can factor it into their offers.
          </p>
        </div>
        {ti && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 text-left space-y-2" data-testid="trade-in-summary">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your trade-in</p>
            <p className="text-base font-semibold text-slate-900">
              {ti.year} {ti.make} {ti.model}{ti.trim ? ` ${ti.trim}` : ""}
            </p>
            <p className="text-xs text-slate-500">
              Status: <span className="font-medium text-slate-700">{ti.status.replace(/_/g, " ")}</span>
            </p>
            {ti.valuationCents != null && (
              <p className="text-sm text-slate-700">
                Estimated trade value:{" "}
                <span className="font-semibold text-emerald-700">
                  ${(ti.valuationCents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="trade-in-page">
      <div className="flex items-center gap-3 mb-6">
        <Car size={22} className="text-[#0B5FD1]" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Trade-In Vehicle</h1>
          <p className="text-sm text-slate-500">Dealers will see your trade-in details during the auction.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} data-testid="trade-in-form" className="space-y-5">
        {/* VIN */}
        <div>
          <Label htmlFor="ti-vin">VIN (Vehicle Identification Number)</Label>
          <Input id="ti-vin" data-testid="trade-in-vin" className="mt-1.5 font-mono" placeholder="1HGCM82633A004352"
            value={form.vin} onChange={e => setForm({...form, vin: e.target.value.toUpperCase()})} maxLength={17} />
          <p className="text-xs text-slate-400 mt-1">17-character VIN from your title or dashboard</p>
        </div>

        {/* Vehicle details */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="ti-year">Year</Label>
            <Input id="ti-year" type="number" data-testid="trade-in-year" className="mt-1.5" placeholder="2018"
              value={form.year} onChange={e => setForm({...form, year: e.target.value})} required />
          </div>
          <div>
            <Label htmlFor="ti-make">Make</Label>
            <Input id="ti-make" data-testid="trade-in-make" className="mt-1.5" placeholder="Honda"
              value={form.make} onChange={e => setForm({...form, make: e.target.value})} required />
          </div>
          <div>
            <Label htmlFor="ti-model">Model</Label>
            <Input id="ti-model" data-testid="trade-in-model" className="mt-1.5" placeholder="Accord"
              value={form.model} onChange={e => setForm({...form, model: e.target.value})} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ti-trim">Trim (optional)</Label>
            <Input id="ti-trim" data-testid="trade-in-trim" className="mt-1.5" placeholder="Sport"
              value={form.trim} onChange={e => setForm({...form, trim: e.target.value})} />
          </div>
          <div>
            <Label htmlFor="ti-mileage">Mileage</Label>
            <Input id="ti-mileage" type="number" data-testid="trade-in-mileage" className="mt-1.5" placeholder="45000"
              value={form.mileage} onChange={e => setForm({...form, mileage: e.target.value})} required />
          </div>
        </div>

        {/* Condition */}
        <div>
          <Label htmlFor="ti-condition">Vehicle condition</Label>
          <Select id="ti-condition" data-testid="trade-in-condition" className="mt-1.5"
            value={form.condition} onChange={e => setForm({...form, condition: e.target.value})} required>
            <option value="">Select condition</option>
            {CONDITIONS.map(c => <option key={c} value={c.split(" — ")[0].toLowerCase()}>{c}</option>)}
          </Select>
        </div>

        {/* Loan status */}
        <div>
          <Label htmlFor="ti-loan-status">Current loan status</Label>
          <Select id="ti-loan-status" data-testid="trade-in-loan-status" className="mt-1.5"
            value={form.loanStatus} onChange={e => setForm({...form, loanStatus: e.target.value})} required>
            <option value="">Select loan status</option>
            {LOAN_STATUSES.map(l => <option key={l}>{l}</option>)}
          </Select>
        </div>

        {form.loanStatus && !form.loanStatus.startsWith("Paid") && (
          <div>
            <Label htmlFor="ti-loan-balance">Approximate loan balance ($)</Label>
            <Input id="ti-loan-balance" type="number" data-testid="trade-in-loan-balance" className="mt-1.5" placeholder="8500"
              value={form.loanBalance} onChange={e => setForm({...form, loanBalance: e.target.value})} />
          </div>
        )}

        {/* Notes */}
        <div>
          <Label htmlFor="ti-notes">Additional notes (optional)</Label>
          <Textarea id="ti-notes" data-testid="trade-in-notes" className="mt-1.5"
            placeholder="Recent repairs, known issues, service history…"
            value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md" data-testid="trade-in-error">{error}</p>}

        <Button type="submit" className="w-full" size="lg" data-testid="trade-in-submit-btn" disabled={loading}>
          {loading ? "Submitting…" : "Submit Trade-In Details"}
        </Button>
        <p className="text-xs text-slate-400 text-center">
          Trade-in information is visible to dealers during auction only. It does not affect your $99 deposit or prequalification.
        </p>
      </form>

      {/* Feature 17 — Trade-In Valuation Widget (calculator-based estimate only) */}
      <div className="mt-8">
        <TradeInValuationWidget
          initialYear={form.year}
          initialMileage={form.mileage}
          initialCondition={form.condition}
        />
      </div>
    </div>
  );
}
