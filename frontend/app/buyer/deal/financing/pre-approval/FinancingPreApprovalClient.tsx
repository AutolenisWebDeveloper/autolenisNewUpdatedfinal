// Feature 18 — Financing Pre-Approval Display Client Component
// Shows real data: ExternalPreApproval, Financing, FinancingScenario
// Monthly payment calculator shown as estimate-only fallback.
// No fake approvals — empty state when no data exists.
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CreditCard, CheckCircle2, AlertCircle, Clock, Calculator,
  ArrowRight, Building2, BadgeCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface PreApproval {
  id: string;
  status: string;
  lenderName: string | null;
  approvedAmountCents: number | null;
  aprRate: number | null;
  termMonths: number | null;
  expiryDate: string | null;
  createdAt: string;
  rejectionReason: string | null;
}

interface Financing {
  id: string;
  path: string;
  status: string;
  lenderName: string | null;
  approvedAmountCents: number | null;
  aprRate: number | null;
  termMonths: number | null;
  monthlyPaymentCents: number | null;
}

interface FinancingScenario {
  id: string;
  name: string;
  vehiclePriceCents: number;
  downPaymentCents: number;
  loanAmountCents: number;
  aprRate: number;
  termMonths: number;
  monthlyPaymentCents: number;
  totalCostCents: number;
  createdAt: string;
}

interface Props {
  data: {
    preApprovals: PreApproval[];
    activeDeal: { id: string; status: string; financingPath: string | null; financing: Financing | null } | null;
    scenarios: FinancingScenario[];
    dealPriceCents: number | null;
  };
}

const STATUS_BADGE: Record<string, { label: string; variant: "green" | "blue" | "secondary" | "destructive" }> = {
  APPROVED:               { label: "Approved", variant: "green" },
  SUBMITTED:              { label: "Submitted", variant: "blue" },
  REVIEWING:              { label: "Under Review", variant: "blue" },
  ADDITIONAL_INFO_REQUIRED: { label: "More Info Needed", variant: "secondary" },
  REJECTED:               { label: "Not Approved", variant: "destructive" },
  SELECTED:               { label: "Selected", variant: "green" },
  PENDING:                { label: "Pending", variant: "secondary" },
  DECLINED:               { label: "Declined", variant: "destructive" },
};

// Simple monthly payment formula: P * r * (1+r)^n / ((1+r)^n - 1)
function calcMonthlyPayment(principalCents: number, aprPercent: number, termMonths: number): number {
  if (aprPercent === 0) return Math.round(principalCents / termMonths);
  const r = aprPercent / 100 / 12;
  const pow = Math.pow(1 + r, termMonths);
  return Math.round(principalCents * r * pow / (pow - 1));
}

function calcTotalCost(monthlyPaymentCents: number, termMonths: number, downPaymentCents: number): number {
  return monthlyPaymentCents * termMonths + downPaymentCents;
}

export default function FinancingPreApprovalClient({ data }: Props) {
  const { preApprovals, activeDeal, scenarios, dealPriceCents } = data;
  const financing = activeDeal?.financing ?? null;

  // Calculator state
  const [calcPrice, setCalcPrice] = useState(dealPriceCents ? String(Math.round(dealPriceCents / 100)) : "");
  const [calcDown, setCalcDown] = useState("0");
  const [calcApr, setCalcApr] = useState("7.9");
  const [calcTerm, setCalcTerm] = useState("60");
  const [calcResult, setCalcResult] = useState<{ monthly: number; total: number; loan: number } | null>(null);

  function runCalculator() {
    const price = parseFloat(calcPrice) * 100;
    const down = parseFloat(calcDown) * 100;
    const apr = parseFloat(calcApr);
    const term = parseInt(calcTerm);
    if (!price || price < down || !apr || !term) return;
    const loan = price - down;
    const monthly = calcMonthlyPayment(loan, apr, term);
    const total = calcTotalCost(monthly, term, down);
    setCalcResult({ monthly, total, loan });
  }

  const hasRealData = preApprovals.length > 0 || financing !== null || scenarios.length > 0;

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="financing-pre-approval-page">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <CreditCard size={22} className="text-[#0B5FD1]" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Financing Pre-Approval</h1>
          <p className="text-sm text-slate-500">View your financing status and estimate monthly payments.</p>
        </div>
      </div>

      {/* Deal Financing Status */}
      {activeDeal && financing && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="deal-financing-status">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BadgeCheck size={16} className="text-[#0B5FD1]" />
              <h2 className="font-semibold text-slate-900 text-sm">Deal Financing</h2>
            </div>
            <Badge variant={STATUS_BADGE[financing.status]?.variant ?? "secondary"}>
              {STATUS_BADGE[financing.status]?.label ?? financing.status}
            </Badge>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <dt className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Path</dt>
              <dd className="text-sm font-semibold text-slate-800">{financing.path.replace(/_/g, " ")}</dd>
            </div>
            {financing.lenderName && (
              <div>
                <dt className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Lender</dt>
                <dd className="text-sm font-semibold text-slate-800">{financing.lenderName}</dd>
              </div>
            )}
            {financing.aprRate !== null && (
              <div>
                <dt className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">APR</dt>
                <dd className="text-sm font-semibold text-slate-800">{financing.aprRate.toFixed(2)}%</dd>
              </div>
            )}
            {financing.termMonths !== null && (
              <div>
                <dt className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Term</dt>
                <dd className="text-sm font-semibold text-slate-800">{financing.termMonths} months</dd>
              </div>
            )}
            {financing.approvedAmountCents !== null && (
              <div>
                <dt className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Approved Amount</dt>
                <dd className="text-sm font-semibold text-slate-800">
                  ${(financing.approvedAmountCents / 100).toLocaleString()}
                </dd>
              </div>
            )}
            {financing.monthlyPaymentCents !== null && (
              <div>
                <dt className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Monthly Payment</dt>
                <dd className="text-sm font-bold text-[#0B5FD1]">
                  ${(financing.monthlyPaymentCents / 100).toLocaleString()}/mo
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* External Pre-Approvals */}
      {preApprovals.length > 0 && (
        <div className="mb-6" data-testid="external-pre-approvals">
          <h2 className="font-semibold text-slate-900 mb-3 text-sm flex items-center gap-2">
            <Building2 size={15} className="text-slate-500" />
            Your Bank / Credit Union Pre-Approvals
          </h2>
          <div className="space-y-3">
            {preApprovals.map(pa => {
              const badge = STATUS_BADGE[pa.status] ?? { label: pa.status, variant: "secondary" as const };
              return (
                <div key={pa.id} data-testid={`pre-approval-${pa.id}`}
                  className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {pa.status === "APPROVED" ? (
                        <CheckCircle2 size={15} className="text-green-600" />
                      ) : pa.status === "REJECTED" ? (
                        <AlertCircle size={15} className="text-red-500" />
                      ) : (
                        <Clock size={15} className="text-blue-500" />
                      )}
                      <p className="font-semibold text-slate-900 text-sm">
                        {pa.lenderName ?? "Bank / Credit Union"}
                      </p>
                    </div>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>

                  {pa.status === "APPROVED" && (
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {pa.approvedAmountCents !== null && (
                        <div>
                          <dt className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Approved For</dt>
                          <dd className="text-sm font-bold text-green-700">
                            ${(pa.approvedAmountCents / 100).toLocaleString()}
                          </dd>
                        </div>
                      )}
                      {pa.aprRate !== null && (
                        <div>
                          <dt className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">APR</dt>
                          <dd className="text-sm font-semibold text-slate-800">{pa.aprRate.toFixed(2)}%</dd>
                        </div>
                      )}
                      {pa.termMonths !== null && (
                        <div>
                          <dt className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Term</dt>
                          <dd className="text-sm font-semibold text-slate-800">{pa.termMonths} mo</dd>
                        </div>
                      )}
                      {pa.expiryDate && (
                        <div>
                          <dt className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Expires</dt>
                          <dd className="text-sm font-semibold text-slate-800">
                            {new Date(pa.expiryDate).toLocaleDateString()}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}

                  {pa.status === "REJECTED" && pa.rejectionReason && (
                    <p className="text-xs text-red-600 mt-1">{pa.rejectionReason}</p>
                  )}

                  {pa.status === "ADDITIONAL_INFO_REQUIRED" && (
                    <p className="text-xs text-amber-700 mt-1 bg-amber-50 rounded p-2">
                      Additional information is required. Contact your lender for details.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Saved Financing Scenarios */}
      {scenarios.length > 0 && (
        <div className="mb-6" data-testid="financing-scenarios">
          <h2 className="font-semibold text-slate-900 mb-3 text-sm flex items-center gap-2">
            <Calculator size={15} className="text-slate-500" />
            Saved Financing Scenarios
          </h2>
          <div className="space-y-3">
            {scenarios.map(s => (
              <div key={s.id} data-testid={`scenario-${s.id}`}
                className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-slate-900 text-sm">{s.name}</p>
                  <p className="text-[#0B5FD1] font-bold text-sm">
                    ${(s.monthlyPaymentCents / 100).toLocaleString()}/mo
                  </p>
                </div>
                <div className="flex gap-4 text-xs text-slate-500">
                  <span>{s.aprRate.toFixed(2)}% APR</span>
                  <span>{s.termMonths} months</span>
                  <span>Down: ${(s.downPaymentCents / 100).toLocaleString()}</span>
                  <span>Total: ${(s.totalCostCents / 100).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state — no real pre-approval data */}
      {!hasRealData && !activeDeal?.financing && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 mb-6 text-center" data-testid="no-pre-approval">
          <CreditCard size={28} className="text-slate-300 mx-auto mb-3" />
          <p className="font-semibold text-slate-700 mb-1">No pre-approval on file</p>
          <p className="text-sm text-slate-500 mb-4 leading-relaxed">
            You haven&apos;t uploaded a bank or credit union pre-approval yet.
            If you&apos;re using dealer financing, your rate will appear here after your deal is confirmed.
          </p>
          <Button variant="secondary" size="sm" href="/buyer/deal/financing" data-testid="setup-financing-btn">
            Set up financing path <ArrowRight size={13} />
          </Button>
        </div>
      )}

      {/* Monthly Payment Calculator — always available as estimate tool */}
      <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="monthly-payment-calculator">
        <div className="flex items-center gap-2 mb-4">
          <Calculator size={16} className="text-[#0B5FD1]" />
          <h2 className="font-semibold text-slate-900 text-sm">Monthly Payment Calculator</h2>
          <span className="text-xs text-slate-400 ml-auto">Estimate only</span>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <Label htmlFor="calc-price" className="text-xs">Vehicle Price ($)</Label>
            <Input
              id="calc-price"
              data-testid="calc-price"
              type="number"
              className="mt-1 text-sm"
              placeholder="25000"
              value={calcPrice}
              onChange={e => { setCalcPrice(e.target.value); setCalcResult(null); }}
            />
          </div>
          <div>
            <Label htmlFor="calc-down" className="text-xs">Down Payment ($)</Label>
            <Input
              id="calc-down"
              data-testid="calc-down"
              type="number"
              className="mt-1 text-sm"
              placeholder="2000"
              value={calcDown}
              onChange={e => { setCalcDown(e.target.value); setCalcResult(null); }}
            />
          </div>
          <div>
            <Label htmlFor="calc-apr" className="text-xs">Est. APR (%)</Label>
            <Input
              id="calc-apr"
              data-testid="calc-apr"
              type="number"
              step="0.1"
              className="mt-1 text-sm"
              placeholder="7.9"
              value={calcApr}
              onChange={e => { setCalcApr(e.target.value); setCalcResult(null); }}
            />
          </div>
          <div>
            <Label htmlFor="calc-term" className="text-xs">Term (months)</Label>
            <Select
              id="calc-term"
              data-testid="calc-term"
              className="mt-1 text-sm"
              value={calcTerm}
              onChange={e => { setCalcTerm(e.target.value); setCalcResult(null); }}
            >
              <option value="24">24 months</option>
              <option value="36">36 months</option>
              <option value="48">48 months</option>
              <option value="60">60 months</option>
              <option value="72">72 months</option>
              <option value="84">84 months</option>
            </Select>
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full mb-3"
          onClick={runCalculator}
          disabled={!calcPrice || !calcApr || !calcTerm}
          data-testid="calc-run-btn"
        >
          <Calculator size={14} /> Calculate Payment
        </Button>

        {calcResult && (
          <div className="bg-[#0B5FD1]/5 border border-[#0B5FD1]/20 rounded-lg p-4" data-testid="calc-result">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xs text-slate-500 mb-1">Loan Amount</p>
                <p className="text-base font-bold text-slate-900" data-testid="calc-loan">
                  ${(calcResult.loan / 100).toLocaleString()}
                </p>
              </div>
              <div className="border-x border-[#0B5FD1]/20">
                <p className="text-xs text-slate-500 mb-1">Monthly</p>
                <p className="text-base font-bold text-[#0B5FD1]" data-testid="calc-monthly">
                  ${(calcResult.monthly / 100).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Total Cost</p>
                <p className="text-base font-bold text-slate-900" data-testid="calc-total">
                  ${(calcResult.total / 100).toLocaleString()}
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400 text-center mt-3">
              Estimate only — actual rate depends on lender approval. Does not constitute a loan offer.
            </p>
          </div>
        )}
      </div>

      {/* Link back to financing path */}
      <div className="mt-6 text-center">
        <Link href="/buyer/deal/financing" className="text-sm text-[#0B5FD1] hover:underline flex items-center gap-1 justify-center">
          Back to financing options <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
