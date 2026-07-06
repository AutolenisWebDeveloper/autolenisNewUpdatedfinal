"use client";

// PART 2 — Interactive Prequal Budget Calculator
// UI-only: no database writes. maxOtdAmountCents is immutable and passed from server.

import { useState } from "react";
import { formatCents } from "@/lib/utils";
import { Calculator, RotateCcw, AlertTriangle, Info, Lock } from "lucide-react";

interface PrequalBudgetCalculatorProps {
  /** Immutable approved max out-the-door amount from PreQualification.maxOtdAmountCents */
  maxOtdAmountCents: number;
}

const TERM_OPTIONS = [24, 36, 48, 60, 72, 84] as const;
const DEFAULT_APR = 8.9;
const DEFAULT_TERM = 60;
const DEFAULT_TAXES_FEES_DOLLARS = 3000;

function calcMonthlyPaymentCents(
  principalCents: number,
  annualRatePercent: number,
  termMonths: number
): number {
  if (principalCents <= 0) return 0;
  if (termMonths <= 0) return 0;
  if (annualRatePercent === 0) return principalCents / termMonths;
  const r = annualRatePercent / 100 / 12;
  return (
    (principalCents * (r * Math.pow(1 + r, termMonths))) /
    (Math.pow(1 + r, termMonths) - 1)
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default function PrequalBudgetCalculator({
  maxOtdAmountCents,
}: PrequalBudgetCalculatorProps) {
  const maxDollars = Math.floor(maxOtdAmountCents / 100);

  const [vehicleDollars, setVehicleDollars] = useState(maxDollars);
  const [downPaymentDollars, setDownPaymentDollars] = useState(0);
  const [taxesFeesDollars, setTaxesFeesDollars] = useState(DEFAULT_TAXES_FEES_DOLLARS);
  const [apr, setApr] = useState(DEFAULT_APR);
  const [termMonths, setTermMonths] = useState<number>(DEFAULT_TERM);

  const vehicleCents = vehicleDollars * 100;
  const downPaymentCents = downPaymentDollars * 100;
  const taxesFeesCents = taxesFeesDollars * 100;

  const estimatedTotalOtdCents = vehicleCents + taxesFeesCents;
  const estimatedFinancedAmountCents = Math.max(0, estimatedTotalOtdCents - downPaymentCents);
  const monthlyPaymentCents = calcMonthlyPaymentCents(estimatedFinancedAmountCents, apr, termMonths);

  const exceedsApprovedBudget = estimatedTotalOtdCents > maxOtdAmountCents;
  const downExceedsBudget = downPaymentCents > maxOtdAmountCents;

  function reset() {
    setVehicleDollars(maxDollars);
    setDownPaymentDollars(0);
    setTaxesFeesDollars(DEFAULT_TAXES_FEES_DOLLARS);
    setApr(DEFAULT_APR);
    setTermMonths(DEFAULT_TERM);
  }

  function handleVehicleInput(raw: string) {
    const parsed = parseInt(raw.replace(/\D/g, ""), 10) || 0;
    setVehicleDollars(clamp(parsed, 0, maxDollars));
  }

  function handleDownPaymentInput(raw: string) {
    const parsed = parseInt(raw.replace(/\D/g, ""), 10) || 0;
    setDownPaymentDollars(clamp(parsed, 0, maxDollars));
  }

  function handleTaxesFeesInput(raw: string) {
    const parsed = parseInt(raw.replace(/\D/g, ""), 10) || 0;
    setTaxesFeesDollars(clamp(parsed, 0, 20000));
  }

  function handleAprInput(raw: string) {
    const parsed = parseFloat(raw) || 0;
    setApr(clamp(parsed, 0, 35));
  }

  return (
    <div
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm"
      data-testid="prequal-budget-calculator"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator size={18} className="text-al-primary" />
          <span className="font-semibold text-slate-900 text-sm">Budget Calculator</span>
          <span className="text-xs bg-al-primary/10 text-al-primary px-2 py-0.5 rounded-full font-medium">
            Estimate Only
          </span>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          aria-label="Reset calculator to defaults"
        >
          <RotateCcw size={12} />
          Reset
        </button>
      </div>

      <div className="p-6 space-y-6">
        {/* Locked approved max — read-only */}
        <div
          className="flex items-center justify-between bg-al-primary/5 border border-al-primary/20 rounded-xl px-4 py-3"
          data-testid="calc-approved-max"
        >
          <div className="flex items-center gap-2">
            <Lock size={14} className="text-al-primary" />
            <span className="text-sm font-semibold text-al-primary">Approved Max Budget — locked</span>
          </div>
          <span className="text-lg font-bold text-al-primary">
            {formatCents(maxOtdAmountCents)}
          </span>
        </div>

        {/* Inputs grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Vehicle / Budget Amount */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Vehicle / Budget Amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input
                type="text"
                inputMode="numeric"
                value={vehicleDollars.toLocaleString()}
                onChange={(e) => handleVehicleInput(e.target.value)}
                className="w-full pl-7 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
                data-testid="calc-vehicle-amount"
                aria-label="Vehicle or budget amount in dollars"
              />
            </div>
            <input
              type="range"
              min={0}
              max={maxDollars}
              step={500}
              value={vehicleDollars}
              onChange={(e) => setVehicleDollars(Number(e.target.value))}
              className="w-full accent-al-primary"
              aria-label="Vehicle amount slider"
            />
          </div>

          {/* Down Payment */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Down Payment
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input
                type="text"
                inputMode="numeric"
                value={downPaymentDollars.toLocaleString()}
                onChange={(e) => handleDownPaymentInput(e.target.value)}
                className="w-full pl-7 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
                data-testid="calc-down-payment"
                aria-label="Down payment in dollars"
              />
            </div>
            <input
              type="range"
              min={0}
              max={maxDollars}
              step={500}
              value={downPaymentDollars}
              onChange={(e) => setDownPaymentDollars(Number(e.target.value))}
              className="w-full accent-al-primary"
              aria-label="Down payment slider"
            />
          </div>

          {/* Estimated Taxes / Fees / Add-ons */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Estimated Taxes / Fees / Add-ons
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input
                type="text"
                inputMode="numeric"
                value={taxesFeesDollars.toLocaleString()}
                onChange={(e) => handleTaxesFeesInput(e.target.value)}
                className="w-full pl-7 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
                data-testid="calc-taxes-fees"
                aria-label="Estimated taxes, fees and add-ons in dollars"
              />
            </div>
            <input
              type="range"
              min={0}
              max={20000}
              step={100}
              value={taxesFeesDollars}
              onChange={(e) => setTaxesFeesDollars(Number(e.target.value))}
              className="w-full accent-al-primary"
              aria-label="Taxes and fees slider"
            />
          </div>

          {/* Estimated APR */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Estimated APR
              <span className="ml-1.5 text-slate-400 font-normal normal-case">(0–35%)</span>
            </label>
            <div className="relative">
              <input
                type="number"
                min={0}
                max={35}
                step={0.1}
                value={apr}
                onChange={(e) => handleAprInput(e.target.value)}
                className="w-full pr-8 pl-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
                data-testid="calc-apr"
                aria-label="Estimated APR percentage"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
            </div>
            <input
              type="range"
              min={0}
              max={35}
              step={0.1}
              value={apr}
              onChange={(e) => setApr(Number(e.target.value))}
              className="w-full accent-al-primary"
              aria-label="APR slider"
            />
          </div>
        </div>

        {/* Loan Term */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Loan Term
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Loan term selection">
            {TERM_OPTIONS.map((t) => (
              <button
                key={t}
                onClick={() => setTermMonths(t)}
                data-testid={`calc-term-${t}`}
                aria-pressed={termMonths === t}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  termMonths === t
                    ? "bg-al-primary text-white border-al-primary"
                    : "bg-white text-slate-600 border-slate-200 hover:border-al-primary/40 hover:text-al-primary"
                }`}
              >
                {t} mo
              </button>
            ))}
          </div>
        </div>

        {/* Results panel */}
        <div
          className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3"
          data-testid="calc-results"
        >
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Estimated Results
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ResultRow
              label="Estimated Monthly Payment"
              value={formatCents(Math.round(monthlyPaymentCents))}
              highlight
              testId="calc-monthly-payment"
            />
            <ResultRow
              label="Estimated Financed Amount"
              value={formatCents(estimatedFinancedAmountCents)}
              testId="calc-financed-amount"
            />
            <ResultRow
              label="Remaining Budget After Down Payment"
              value={formatCents(Math.max(0, maxOtdAmountCents - downPaymentCents))}
              testId="calc-remaining-budget"
            />
            <ResultRow
              label="Estimated Total OTD"
              value={formatCents(estimatedTotalOtdCents)}
              warn={exceedsApprovedBudget}
              testId="calc-total-otd"
            />
          </div>

          {/* Affordability warning */}
          {exceedsApprovedBudget && (
            <div
              className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-2"
              role="alert"
              data-testid="calc-budget-warning"
            >
              <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 leading-relaxed">
                Your estimated total OTD of{" "}
                <strong>{formatCents(estimatedTotalOtdCents)}</strong> exceeds your
                approved max budget of{" "}
                <strong>{formatCents(maxOtdAmountCents)}</strong>. Adjust your
                vehicle price or down payment to stay within your approved limit.
              </p>
            </div>
          )}

          {/* Down payment validation */}
          {downExceedsBudget && (
            <div
              className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg p-3"
              role="alert"
              data-testid="calc-down-payment-warning"
            >
              <AlertTriangle size={15} className="text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs text-red-800">
                Down payment cannot exceed your approved max budget of{" "}
                <strong>{formatCents(maxOtdAmountCents)}</strong>.
              </p>
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div className="flex items-start gap-2 text-xs text-slate-400 leading-relaxed">
          <Info size={13} className="mt-0.5 shrink-0" />
          <p>
            This calculator is an estimate only. Final payment depends on lender
            approval, taxes, fees, rate, term, vehicle price, and final contract
            terms. No values entered here affect your approved pre-qualification.
          </p>
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  label,
  value,
  highlight = false,
  warn = false,
  testId,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={[
        "flex flex-col gap-0.5 p-3 rounded-lg border",
        highlight ? "bg-al-primary/5" : "bg-white",
        warn ? "border-amber-300" : "border-slate-100",
      ].join(" ")}
    >
      <span className="text-xs text-slate-500">{label}</span>
      <span
        className={`text-base font-bold ${highlight ? "text-al-primary" : warn ? "text-amber-700" : "text-slate-900"}`}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}
