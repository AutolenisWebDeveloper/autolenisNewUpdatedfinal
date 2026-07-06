// Feature 17 — Trade-In Valuation Widget (Phase 3 — Buyer Deal Confidence)
// Calculator-based estimator. No external market data — pure formula-based estimate.
// Clearly states: estimate only, not an offer.
"use client";

import { useState } from "react";
import { Calculator, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

// Rough base values by vehicle age for estimate computation.
// Formula: BASE_VALUE * DEPRECIATION^(age) * CONDITION_FACTOR * MILEAGE_FACTOR
// This is an internal calculator only — not sourced from any market API.

/** Annual depreciation rate for years 1–5 (~15% per year) */
const EARLY_DEPRECIATION_RATE = 0.85;
/** Annual depreciation rate for years 6+ (~10% per year) */
const LATE_DEPRECIATION_RATE = 0.90;
/** Number of years covered by early depreciation rate */
const EARLY_DEPRECIATION_YEARS = 5;
/** Average annual mileage used as baseline for mileage penalty/bonus */
const AVG_ANNUAL_MILEAGE = 12000;

const CONDITION_FACTOR: Record<string, { low: number; mid: number; high: number; label: string }> = {
  excellent: { low: 0.85, mid: 0.90, high: 0.95, label: "Excellent" },
  good:      { low: 0.68, mid: 0.75, high: 0.82, label: "Good" },
  fair:      { low: 0.48, mid: 0.55, high: 0.62, label: "Fair" },
  poor:      { low: 0.28, mid: 0.35, high: 0.42, label: "Poor" },
};

// Very rough MSRP anchors (USD) for common segments — used as starting estimate only
const SEGMENT_BASE: Record<string, number> = {
  default: 25000,
};

function estimateTradeInValue(
  year: number,
  mileage: number,
  condition: string,
): { low: number; mid: number; high: number } | null {
  if (!year || !mileage || !condition) return null;
  const currentYear = new Date().getFullYear();
  const age = Math.max(0, currentYear - year);

  // Depreciation: ~15% per year for first EARLY_DEPRECIATION_YEARS, ~10% thereafter
  let base = SEGMENT_BASE.default;
  for (let i = 0; i < age; i++) {
    base *= i < EARLY_DEPRECIATION_YEARS ? EARLY_DEPRECIATION_RATE : LATE_DEPRECIATION_RATE;
  }

  // Mileage penalty: above AVG_ANNUAL_MILEAGE/year average = additional discount
  const avgMileage = age * AVG_ANNUAL_MILEAGE;
  const mileageDelta = mileage - avgMileage;
  const mileageFactor = mileageDelta > 0
    ? Math.max(0.6, 1 - (mileageDelta / 100000) * 0.15)
    : Math.min(1.08, 1 + (Math.abs(mileageDelta) / 100000) * 0.05);

  base *= mileageFactor;

  const cf = CONDITION_FACTOR[condition] ?? CONDITION_FACTOR.good;
  return {
    low:  Math.round(base * cf.low / 100) * 100,
    mid:  Math.round(base * cf.mid / 100) * 100,
    high: Math.round(base * cf.high / 100) * 100,
  };
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 25 }, (_, i) => CURRENT_YEAR - i);

interface Props {
  /** Pre-fill from parent trade-in form */
  initialYear?: string;
  initialMileage?: string;
  initialCondition?: string;
}

export default function TradeInValuationWidget({ initialYear = "", initialMileage = "", initialCondition = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(initialYear);
  const [mileage, setMileage] = useState(initialMileage);
  const [condition, setCondition] = useState(initialCondition);
  const [result, setResult] = useState<{ low: number; mid: number; high: number } | null>(null);

  function calculate() {
    const y = parseInt(year);
    const m = parseInt(mileage);
    if (!y || !m || !condition) return;
    setResult(estimateTradeInValue(y, m, condition));
  }

  return (
    <div className="border border-slate-200 rounded-xl bg-white" data-testid="trade-in-valuation-widget">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        data-testid="trade-in-estimator-toggle"
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-al-primary/10 flex items-center justify-center">
            <Calculator size={15} className="text-al-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Estimate your trade-in value</p>
            <p className="text-xs text-slate-500">Calculator-based estimate — not a formal offer</p>
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4 space-y-4" data-testid="trade-in-estimator-form">
          {/* Disclaimer */}
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              <strong>Estimate only.</strong> This is a rough calculator-based estimate using standard depreciation formulas — not market data, not a dealer offer, and not a lender valuation. Actual trade-in value is determined by the dealer during the deal process.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="tiv-year">Model Year</Label>
              <Select
                id="tiv-year"
                data-testid="tiv-year"
                className="mt-1.5"
                value={year}
                onChange={e => { setYear(e.target.value); setResult(null); }}
              >
                <option value="">Year</option>
                {YEAR_OPTIONS.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="tiv-mileage">Mileage</Label>
              <Input
                id="tiv-mileage"
                data-testid="tiv-mileage"
                type="number"
                className="mt-1.5"
                placeholder="45000"
                value={mileage}
                min={0}
                onChange={e => { setMileage(e.target.value); setResult(null); }}
              />
            </div>
            <div>
              <Label htmlFor="tiv-condition">Condition</Label>
              <Select
                id="tiv-condition"
                data-testid="tiv-condition"
                className="mt-1.5"
                value={condition}
                onChange={e => { setCondition(e.target.value); setResult(null); }}
              >
                <option value="">Condition</option>
                <option value="excellent">Excellent</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="poor">Poor</option>
              </Select>
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={calculate}
            disabled={!year || !mileage || !condition}
            data-testid="tiv-calculate-btn"
            className="w-full"
          >
            <Calculator size={14} /> Estimate Value
          </Button>

          {result && (
            <div className="bg-al-primary/5 border border-al-primary/20 rounded-lg p-4" data-testid="tiv-result">
              <p className="text-xs font-semibold text-al-primary uppercase tracking-wider mb-3">Estimated Range</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Low</p>
                  <p className="text-lg font-bold text-slate-900" data-testid="tiv-low">
                    ${result.low.toLocaleString()}
                  </p>
                </div>
                <div className="border-x border-al-primary/20">
                  <p className="text-xs text-slate-500 mb-1">Mid</p>
                  <p className="text-lg font-bold text-al-primary" data-testid="tiv-mid">
                    ${result.mid.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">High</p>
                  <p className="text-lg font-bold text-slate-900" data-testid="tiv-high">
                    ${result.high.toLocaleString()}
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-400 text-center mt-3">
                Estimate based on {CONDITION_FACTOR[condition]?.label ?? condition} condition · {parseInt(mileage).toLocaleString()} miles · {year} model year
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
