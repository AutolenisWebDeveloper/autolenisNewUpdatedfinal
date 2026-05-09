"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Calculator } from "lucide-react";

const TERMS = [24, 36, 48, 60, 72];

function calcMonthlyPayment(principal: number, aprPct: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (aprPct <= 0) return principal / termMonths;
  const r = aprPct / 100 / 12;
  return (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

export default function SavingsCalculator() {
  const [vehiclePrice, setVehiclePrice] = useState("35000");
  const [downPayment, setDownPayment] = useState("5000");
  const [tradeIn, setTradeIn] = useState("0");
  const [apr, setApr] = useState("6.9");
  const [termMonths, setTermMonths] = useState("60");

  const parseMoney = (raw: string): number => {
    const stripped = raw.replace(/[^0-9.]/g, "");
    const parts = stripped.split(".");
    const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : stripped;
    return parseFloat(normalized) || 0;
  };

  const principal = Math.max(0, parseMoney(vehiclePrice) - parseMoney(downPayment) - parseMoney(tradeIn));
  const term = parseInt(termMonths) || 60;
  const aprVal = parseFloat(apr) || 0;
  const monthly = calcMonthlyPayment(principal, aprVal, term);
  const totalLoan = principal;
  const totalPaid = monthly * term;
  const totalInterest = Math.max(0, totalPaid - principal);
  const totalCost = totalPaid + parseMoney(downPayment) + parseMoney(tradeIn);

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const inputClass =
    "w-full pl-7 pr-4 py-3 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30 focus:border-[#0B5FD1] bg-white text-[#111827] placeholder:text-[#94A3B8]";
  const labelClass = "block text-xs font-semibold text-[#111827] mb-1.5";

  return (
    <section
      className="py-24 bg-[#F8F9FB]"
      data-testid="savings-calculator-section"
      id="calculator"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">
              <Calculator size={13} aria-hidden />
              Payment Calculator
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#111827] mt-3">
              Smart Buyers Focus on Total Cost
            </h2>
            <p className="text-sm text-[#4B5563] mt-3 max-w-lg mx-auto">
              Enter your details to see monthly payment, total interest, and true cost of ownership.
            </p>
          </div>

          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
              {/* Vehicle Price */}
              <div>
                <label htmlFor="calc-vehicle-price" className={labelClass}>Vehicle Price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#94A3B8]">$</span>
                  <input
                    id="calc-vehicle-price"
                    type="text"
                    inputMode="numeric"
                    placeholder="35,000"
                    value={vehiclePrice}
                    onChange={(e) => setVehiclePrice(e.target.value)}
                    className={inputClass}
                    data-testid="calc-vehicle-price"
                  />
                </div>
              </div>

              {/* Down Payment */}
              <div>
                <label htmlFor="calc-down-payment" className={labelClass}>Down Payment</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#94A3B8]">$</span>
                  <input
                    id="calc-down-payment"
                    type="text"
                    inputMode="numeric"
                    placeholder="5,000"
                    value={downPayment}
                    onChange={(e) => setDownPayment(e.target.value)}
                    className={inputClass}
                    data-testid="calc-down-payment"
                  />
                </div>
              </div>

              {/* Trade-In Value */}
              <div>
                <label htmlFor="calc-trade-in" className={labelClass}>Trade-In Value</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#94A3B8]">$</span>
                  <input
                    id="calc-trade-in"
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={tradeIn}
                    onChange={(e) => setTradeIn(e.target.value)}
                    className={inputClass}
                    data-testid="calc-trade-in"
                  />
                </div>
              </div>

              {/* APR */}
              <div>
                <label htmlFor="calc-apr" className={labelClass}>Estimated APR (%)</label>
                <div className="relative">
                  <input
                    id="calc-apr"
                    type="number"
                    min="0"
                    max="30"
                    step="0.1"
                    value={apr}
                    onChange={(e) => setApr(e.target.value)}
                    className="w-full pr-8 pl-4 py-3 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30 focus:border-[#0B5FD1] bg-white text-[#111827]"
                    data-testid="calc-apr"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#94A3B8]">%</span>
                </div>
              </div>

              {/* Loan Term */}
              <div className="sm:col-span-1 lg:col-span-2">
                <label className={labelClass}>Loan Term</label>
                <div className="flex gap-2 flex-wrap">
                  {TERMS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTermMonths(String(t))}
                      data-testid={`calc-term-${t}`}
                      className={`px-4 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                        termMonths === String(t)
                          ? "bg-[#0B5FD1] border-[#0B5FD1] text-white"
                          : "bg-white border-[#E5E7EB] text-[#4B5563] hover:border-[#0B5FD1] hover:text-[#0B5FD1]"
                      }`}
                    >
                      {t} mo
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Results — live calculated */}
            <div
              className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2"
              data-testid="calc-results"
            >
              <div className="bg-[#EEF4FF] border border-[#BFDBFE] rounded-xl p-5 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0B5FD1] mb-1">Monthly Payment</p>
                <p className="text-2xl font-bold text-[#0B5FD1]" data-testid="calc-monthly">
                  {fmt(monthly)}
                </p>
              </div>
              <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-5 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-1">Total Loan</p>
                <p className="text-2xl font-bold text-[#111827]" data-testid="calc-total-loan">
                  {fmt(totalLoan)}
                </p>
              </div>
              <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-5 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-1">Total Interest</p>
                <p className="text-2xl font-bold text-[#111827]" data-testid="calc-interest">
                  {fmt(totalInterest)}
                </p>
              </div>
              <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-5 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-1">Total Cost</p>
                <p className="text-2xl font-bold text-[#111827]" data-testid="calc-total">
                  {fmt(totalCost)}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <p className="text-[11px] text-[#94A3B8]">
                * Estimate only. Actual lender terms vary.
              </p>
              <Link
                href="/auth/signup"
                className="inline-flex items-center gap-2 text-sm font-semibold text-[#0B5FD1] hover:text-[#1A6FE0] transition-colors"
                data-testid="calc-cta"
              >
                Get prequalified to see your real rate <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
