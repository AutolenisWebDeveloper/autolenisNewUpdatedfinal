"use client";

import { useId, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  ShieldAlert,
  AlertTriangle,
  ShieldCheck,
  Lock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  FEE_TYPES,
  US_STATES,
  analyzeFee,
  detectFeeType,
  getStateFeeRules,
  summarizeFees,
  formatCents,
  type FeeAnalysisResult,
  type Verdict,
} from "@/lib/tools/dealer-fees";
import { readContentAttribution } from "@/lib/analytics/attribution";
import { trackContentLead } from "@/lib/analytics/events";

// SSR-safe analytics shim. Phase C0 ships a richer events layer; until then we
// fire GA4 events directly with a window.gtag null-guard so the calculator is
// fully self-contained and never throws during SSR.
function track(
  event: string,
  params: Record<string, string | number | boolean>,
): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    gtag?: (command: string, eventName: string, params?: object) => void;
  };
  try {
    w.gtag?.("event", event, params);
  } catch {
    /* analytics must never break the tool */
  }
}

type Step = "state" | "fees" | "results" | "lead" | "done";

interface FeeRow {
  id: string;
  name: string;
  amount: string; // raw dollar string from the input
}

const TIMELINES: Array<{ value: string; label: string }> = [
  { value: "30_days", label: "Within 30 days" },
  { value: "1_3_months", label: "1-3 months" },
  { value: "3_6_months", label: "3-6 months" },
  { value: "researching", label: "Just researching" },
];

const VERDICT_STYLES: Record<
  Verdict | "ILLEGAL",
  { label: string; badge: string; icon: typeof ShieldCheck }
> = {
  REQUIRED: {
    label: "REQUIRED",
    badge: "bg-slate-100 text-slate-700 border-slate-200",
    icon: Lock,
  },
  LEGITIMATE: {
    label: "LEGITIMATE",
    badge: "bg-green-50 text-green-700 border-green-200",
    icon: ShieldCheck,
  },
  NEGOTIATE: {
    label: "NEGOTIATE",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    icon: AlertTriangle,
  },
  REJECT: {
    label: "REJECT",
    badge: "bg-red-50 text-red-700 border-red-200",
    icon: ShieldAlert,
  },
  ILLEGAL: {
    label: "ILLEGAL",
    badge: "bg-red-600 text-white border-red-700",
    icon: ShieldAlert,
  },
};

function newRow(): FeeRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: "",
    amount: "",
  };
}

function toCents(dollars: string): number | null {
  const cleaned = dollars.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export default function DealerFeeCalculator() {
  const [step, setStep] = useState<Step>("state");
  const [state, setState] = useState("");
  const [rows, setRows] = useState<FeeRow[]>([newRow(), newRow(), newRow()]);
  const [results, setResults] = useState<FeeAnalysisResult[]>([]);

  // Lead form
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadTimeline, setLeadTimeline] = useState("");
  const [leadVehicle, setLeadVehicle] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leadError, setLeadError] = useState("");

  const datalistId = useId();

  const stateName = useMemo(() => getStateFeeRules(state).stateName, [state]);
  const stateRules = useMemo(() => getStateFeeRules(state), [state]);
  const totals = useMemo(() => summarizeFees(results), [results]);

  function addRow() {
    setRows((r) => [...r, newRow()]);
  }
  function removeRow(id: string) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.id !== id) : r));
  }
  function updateRow(id: string, patch: Partial<FeeRow>) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function startCalculator() {
    if (!state) return;
    track("calculator_use", {
      calculator_name: "dealer_fee_calculator",
      state,
      step: "start",
    });
    setStep("fees");
  }

  function analyze() {
    const analyzed: FeeAnalysisResult[] = [];
    for (const row of rows) {
      const cents = toCents(row.amount);
      if (cents === null || !row.name.trim()) continue;
      const detected = detectFeeType(row.name);
      // Default unknown names to doc_fee analysis only when they clearly read
      // like a doc fee; otherwise pass through as an unrecognized fee.
      const feeTypeId = detected?.id ?? "unknown";
      const result = analyzeFee(feeTypeId, cents, state);
      analyzed.push({ ...result, displayName: detected ? result.displayName : row.name.trim() });
    }
    setResults(analyzed);
    track("calculator_use", {
      calculator_name: "dealer_fee_calculator",
      state,
      step: "complete",
    });
    setStep("results");
  }

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    setLeadError("");
    if (!leadName.trim() || !leadEmail.includes("@") || !leadTimeline) {
      setLeadError("Please add your name, a valid email, and your buying timeline.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/tools/dealer-fee-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: leadName.trim(),
          email: leadEmail.trim(),
          phone: leadPhone.trim() || undefined,
          buyerTimeline: leadTimeline,
          vehicleInterest: leadVehicle.trim() || undefined,
          state,
          smsOptIn,
          sourceUrl:
            typeof window !== "undefined" ? window.location.href : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setLeadError("Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      track("calculator_use", {
        calculator_name: "dealer_fee_calculator",
        state,
        step: "lead_capture",
      });
      // Phase C-Attribution — fire the content_lead conversion event with the
      // article dimensions if the buyer arrived from a buying-guide page.
      const attr = readContentAttribution();
      trackContentLead({
        articleSlug: attr?.slug,
        cluster: attr?.cluster,
        city: attr?.city,
        state: attr?.state ?? state,
        metro: attr?.metro,
        source: "tool:dealer_fee_calculator",
        buyerTimeline: leadTimeline,
      });
      setStep("done");
    } catch {
      setLeadError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="dealer-fee-calculator"
      className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8 shadow-sm"
    >
      {/* ── STEP A — STATE SELECTION ─────────────────────────────────────── */}
      {step === "state" && (
        <div data-testid="state-selector">
          <h2 className="text-xl font-bold text-slate-900">
            Where are you buying your car?
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Dealer fee rules and legal caps vary by state. We&apos;ll apply the
            rules for the state you select.
          </p>
          <div className="mt-5 max-w-sm">
            <Label htmlFor="fee-state">Your state</Label>
            <Select
              id="fee-state"
              className="mt-1.5"
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">Select a state…</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            className="mt-6"
            disabled={!state}
            onClick={startCalculator}
          >
            Continue <ArrowRight size={16} />
          </Button>
        </div>
      )}

      {/* ── STEP B — ADD FEES ────────────────────────────────────────────── */}
      {step === "fees" && (
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Add each fee from the dealer worksheet
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Type the fee name as it appears, plus the amount. We&apos;ll
                detect the fee type automatically for {stateName}.
              </p>
            </div>
          </div>

          <datalist id={datalistId}>
            {FEE_TYPES.flatMap((f) => [f.displayName, ...f.commonNames]).map(
              (n) => (
                <option key={n} value={n} />
              ),
            )}
          </datalist>

          <div className="mt-5 space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor={`fee-name-${row.id}`} className="text-xs">
                    Fee name
                  </Label>
                  <Input
                    id={`fee-name-${row.id}`}
                    list={datalistId}
                    placeholder="e.g. Doc fee, Market adjustment"
                    value={row.name}
                    onChange={(e) => updateRow(row.id, { name: e.target.value })}
                  />
                </div>
                <div className="w-32">
                  <Label htmlFor={`fee-amt-${row.id}`} className="text-xs">
                    Amount ($)
                  </Label>
                  <Input
                    id={`fee-amt-${row.id}`}
                    inputMode="decimal"
                    placeholder="0"
                    value={row.amount}
                    onChange={(e) =>
                      updateRow(row.id, { amount: e.target.value })
                    }
                  />
                </div>
                <button
                  type="button"
                  aria-label="Remove fee"
                  onClick={() => removeRow(row.id)}
                  className="mb-1 rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0B5FD1] hover:underline"
          >
            <Plus size={16} /> Add another fee
          </button>

          <div className="mt-6 flex items-center gap-3">
            <Button variant="outline" onClick={() => setStep("state")}>
              <ArrowLeft size={16} /> Back
            </Button>
            <Button
              onClick={analyze}
              disabled={!rows.some((r) => r.name.trim() && toCents(r.amount))}
            >
              Analyze My Fees <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP C — RESULTS ─────────────────────────────────────────────── */}
      {step === "results" && (
        <div data-testid="fee-results-panel">
          <h2 className="text-xl font-bold text-slate-900">
            Based on {stateName} dealer fee rules:
          </h2>

          <div className="mt-5 space-y-3">
            {results.map((r, i) => {
              const styleKey: Verdict | "ILLEGAL" = r.illegal
                ? "ILLEGAL"
                : r.verdict;
              const s = VERDICT_STYLES[styleKey];
              const Icon = s.icon;
              return (
                <div
                  key={i}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {r.displayName}
                      </p>
                      <p className="text-sm text-slate-500">
                        {formatCents(r.amountCents)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${s.badge}`}
                    >
                      <Icon size={13} /> {s.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{r.explanation}</p>
                  <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                    <span className="font-semibold">What to do: </span>
                    {r.tip}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Totals */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Total fees entered
              </p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {formatCents(totals.totalCents)}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Non-negotiable (state required)
              </p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {formatCents(totals.nonNegotiableCents)}
              </p>
            </div>
            <div className="rounded-xl bg-green-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-green-700">
                Potentially removable
              </p>
              <p className="mt-1 text-xl font-bold text-green-700">
                {formatCents(totals.removableCents)}
              </p>
            </div>
          </div>

          {/* State note */}
          <p className="mt-4 rounded-lg border border-[#0B5FD1]/20 bg-[#0B5FD1]/5 p-3 text-sm text-slate-700">
            <span className="font-semibold">{stateName} doc fee info: </span>
            {stateRules.docFeeNotes}
          </p>

          <div className="mt-6 flex items-center gap-3">
            <Button variant="outline" onClick={() => setStep("fees")}>
              <ArrowLeft size={16} /> Edit fees
            </Button>
            <Button onClick={() => setStep("lead")}>
              Get My Negotiation Strategy <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP D — LEAD CAPTURE ────────────────────────────────────────── */}
      {step === "lead" && (
        <form data-testid="lead-capture-form" onSubmit={submitLead}>
          <h2 className="text-xl font-bold text-slate-900">
            Want a custom negotiation strategy for your deal?
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Markist, our founder, will send you a tailored plan for {stateName}{" "}
            — what to say, what to push back on, and how to win.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="lead-name">Name *</Label>
              <Input
                id="lead-name"
                className="mt-1.5"
                value={leadName}
                onChange={(e) => setLeadName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="lead-email">Email *</Label>
              <Input
                id="lead-email"
                type="email"
                className="mt-1.5"
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="lead-phone">Phone (optional)</Label>
              <Input
                id="lead-phone"
                type="tel"
                className="mt-1.5"
                value={leadPhone}
                onChange={(e) => setLeadPhone(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="lead-timeline">When are you buying? *</Label>
              <Select
                id="lead-timeline"
                className="mt-1.5"
                value={leadTimeline}
                onChange={(e) => setLeadTimeline(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {TIMELINES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="lead-vehicle">Vehicle interest (optional)</Label>
              <Input
                id="lead-vehicle"
                className="mt-1.5"
                placeholder="e.g. Toyota RAV4"
                value={leadVehicle}
                onChange={(e) => setLeadVehicle(e.target.value)}
              />
            </div>
          </div>

          <label className="mt-4 flex items-start gap-2.5 text-sm text-slate-600">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0B5FD1] focus:ring-[#0B5FD1]"
              checked={smsOptIn}
              onChange={(e) => setSmsOptIn(e.target.checked)}
            />
            <span>
              Send me car buying tips by text (optional).
              <span className="block text-xs text-slate-400">
                AutoLenis may send helpful tips via SMS. Msg &amp; data rates
                apply. Reply STOP to unsubscribe.
              </span>
            </span>
          </label>

          {leadError && (
            <p className="mt-3 text-sm font-medium text-red-600">{leadError}</p>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("results")}
            >
              <ArrowLeft size={16} /> Back
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Sending…
                </>
              ) : (
                <>Get My Negotiation Strategy</>
              )}
            </Button>
          </div>
        </form>
      )}

      {/* ── DONE ─────────────────────────────────────────────────────────── */}
      {step === "done" && (
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto text-green-500" size={48} />
          <h2 className="mt-4 text-xl font-bold text-slate-900">
            Check your inbox
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            We&apos;ll send a custom strategy to{" "}
            <span className="font-semibold">{leadEmail}</span>. In the meantime,
            the fastest way to skip the fee games is to let dealers compete for
            your business.
          </p>
          <Button className="mt-6" href="/request-a-car">
            Get Dealers to Compete <ArrowRight size={16} />
          </Button>
        </div>
      )}

      {/* COMPLIANCE DISCLAIMER — always visible */}
      <p className="mt-8 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-400">
        Results are estimates based on typical market conditions for{" "}
        {stateName}. Actual fees and negotiability vary. Not financial or legal
        advice. {stateName} fee caps are based on publicly available state
        regulations.
      </p>
    </div>
  );
}
