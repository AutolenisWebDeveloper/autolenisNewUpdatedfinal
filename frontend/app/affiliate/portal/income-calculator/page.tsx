// Feature 8 — Affiliate Income Planner (projection calculator + shareable card)
// Commission rates sourced from lib/constants.ts ONLY — never hardcoded
// Shareable card: copy-link button AND download PNG button (AutoLenis branding, projections, sub-affiliate CTA)

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS } from "@/lib/constants";
import { Copy, Download, DollarSign } from "lucide-react";

// Rates from COMMISSION_RATES in lib/constants.ts — never inline
const L1_RATE = COMMISSION_RATES.LEVEL_1;
const L2_RATE = COMMISSION_RATES.LEVEL_2;
const L3_RATE = COMMISSION_RATES.LEVEL_3;
const FEE = PREMIUM_FEE_CENTS / 100; // $499

// Generate styled PNG using Canvas API — no external dependencies
// Card: AutoLenis branding, projection numbers, sub-affiliate enrollment CTA
function downloadProjectionPng(
  projection: { l1: number; l2: number; l3: number; total: number },
  enrollUrl: string
) {
  const W = 680, H = 420;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // ── Background ──────────────────────────────────────────────────────────────
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#0B5FD1");
  grad.addColorStop(1, "#0B5FD1");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ── Decorative stripe ────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, H - 80, W, 80);

  // ── Logo stripes (3 angled bars) ─────────────────────────────────────────────
  const drawBar = (x: number, color: string) => {
    ctx.save();
    ctx.translate(x, 40);
    ctx.rotate(-0.7);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-6, 0, 12, 36, 3);
    ctx.fill();
    ctx.restore();
  };
  drawBar(36, "#50D14E");
  drawBar(52, "#53C8E7");
  drawBar(68, "#2667BF");

  // ── Brand name ───────────────────────────────────────────────────────────────
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText("AutoLenis", 88, 58);

  // ── Label ────────────────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText("AFFILIATE MONTHLY PROJECTION", 40, 100);

  // ── Total earning ────────────────────────────────────────────────────────────
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 60px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText(`$${projection.total.toFixed(2)}`, 40, 175);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText("estimated / month", 40, 200);

  // ── Separator ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, 220); ctx.lineTo(W - 40, 220); ctx.stroke();

  // ── Level breakdown ──────────────────────────────────────────────────────────
  const levels = [
    { label: `L1 (${Math.round(L1_RATE * 100)}%)`, value: projection.l1, color: "#50D14E" },
    { label: `L2 (${Math.round(L2_RATE * 100)}%)`, value: projection.l2, color: "#53C8E7" },
    { label: `L3 (${Math.round(L3_RATE * 100)}%)`, value: projection.l3, color: "#a78bfa" },
  ];
  levels.forEach((lvl, i) => {
    const x = 40 + i * 200;
    ctx.fillStyle = lvl.color;
    ctx.font = `bold 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    ctx.fillText(lvl.label, x, 255);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    ctx.fillText(`$${lvl.value.toFixed(2)}`, x, 285);
  });

  // ── Sub-affiliate CTA ────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText("Join the AutoLenis affiliate program →", 40, 340);
  ctx.fillStyle = "#50D14E";
  ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText(enrollUrl, 40, 360);

  // ── Disclaimer ───────────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText("Projection based on your inputs. Actual earnings vary. L1=15%, L2=3%, L3=2% of $499 fee.", 40, 395);

  // ── Download ─────────────────────────────────────────────────────────────────
  const link = document.createElement("a");
  link.download = "autolenis-affiliate-projection.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export default function AffiliateIncomeCalculatorPage() {
  const [l1, setL1] = useState("10");
  const [l2, setL2] = useState("5");
  const [l3, setL3] = useState("2");
  const [rate, setRate] = useState("20");
  const [copied, setCopied] = useState(false);

  const l1Num = parseInt(l1) || 0;
  const l2Num = parseInt(l2) || 0;
  const l3Num = parseInt(l3) || 0;
  const convRate = parseFloat(rate) / 100;

  // Deals = referrals × conversion rate — shown explicitly in the UI
  const l1Deals = Math.round(l1Num * convRate);
  const l2Deals = Math.round(l2Num * convRate);
  const l3Deals = Math.round(l3Num * convRate);

  const projection = {
    l1: l1Deals * FEE * L1_RATE,
    l2: l2Deals * FEE * L2_RATE,
    l3: l3Deals * FEE * L3_RATE,
    total: 0,
  };
  projection.total = projection.l1 + projection.l2 + projection.l3;

  const enrollUrl = `${typeof window !== "undefined" ? window.location.origin : "https://autolenis.com"}/affiliate/register`;

  function handleCopyText() {
    const card = `AutoLenis Affiliate Monthly Projection:
L1 (${Math.round(L1_RATE * 100)}%): ${l1Deals} deals × $${(FEE * L1_RATE).toFixed(2)} = $${projection.l1.toFixed(2)}/month
L2 (${Math.round(L2_RATE * 100)}%): ${l2Deals} deals × $${(FEE * L2_RATE).toFixed(2)} = $${projection.l2.toFixed(2)}/month
L3 (${Math.round(L3_RATE * 100)}%): ${l3Deals} deals × $${(FEE * L3_RATE).toFixed(2)} = $${projection.l3.toFixed(2)}/month
Total: $${projection.total.toFixed(2)}/month

Join the AutoLenis affiliate program: ${enrollUrl}`;
    navigator.clipboard.writeText(card);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadPng() {
    downloadProjectionPng(projection, enrollUrl);
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="income-calculator-page">
      <div className="flex items-center gap-3 mb-6">
        <DollarSign size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Income Planner</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8">
        Estimate your monthly earnings. Commission rates are set by AutoLenis and sourced from platform constants.
      </p>

      {/* Inputs */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <Label htmlFor="calc-l1">L1 referrals per month</Label>
            <Input id="calc-l1" type="number" min="0" data-testid="calc-l1-input" className="mt-1.5"
              value={l1} onChange={e => setL1(e.target.value)} />
            <p className="text-xs text-slate-400 mt-0.5">{Math.round(L1_RATE * 100)}% per deal = ${(FEE * L1_RATE).toFixed(2)}</p>
          </div>
          <div>
            <Label htmlFor="calc-l2">L2 referrals per month</Label>
            <Input id="calc-l2" type="number" min="0" data-testid="calc-l2-input" className="mt-1.5"
              value={l2} onChange={e => setL2(e.target.value)} />
            <p className="text-xs text-slate-400 mt-0.5">{Math.round(L2_RATE * 100)}% per deal = ${(FEE * L2_RATE).toFixed(2)}</p>
          </div>
          <div>
            <Label htmlFor="calc-l3">L3 referrals per month</Label>
            <Input id="calc-l3" type="number" min="0" data-testid="calc-l3-input" className="mt-1.5"
              value={l3} onChange={e => setL3(e.target.value)} />
            <p className="text-xs text-slate-400 mt-0.5">{Math.round(L3_RATE * 100)}% per deal = ${(FEE * L3_RATE).toFixed(2)}</p>
          </div>
          <div>
            <Label htmlFor="calc-rate">Deal conversion rate (%)</Label>
            <Input id="calc-rate" type="number" min="0" max="100" data-testid="calc-rate-input" className="mt-1.5"
              value={rate} onChange={e => setRate(e.target.value)} />
            <p className="text-xs text-slate-400 mt-0.5">% of referrals who complete a deal</p>
          </div>
        </div>
      </div>

      {/* Conversion Summary */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 mb-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Estimated Deals ({rate}% conversion rate)
        </p>
        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { label: "L1 Deals", count: l1Deals, perDeal: FEE * L1_RATE },
            { label: "L2 Deals", count: l2Deals, perDeal: FEE * L2_RATE },
            { label: "L3 Deals", count: l3Deals, perDeal: FEE * L3_RATE },
          ].map(row => (
            <div key={row.label}>
              <p className="text-2xl font-bold text-slate-900">{row.count}</p>
              <p className="text-xs text-slate-500">{row.label}</p>
              <p className="text-xs text-[#0B5FD1] mt-0.5">${row.perDeal.toFixed(2)} each</p>
            </div>
          ))}
        </div>
      </div>

      {/* Projection card */}
      <div className="bg-[#0B5FD1] text-white rounded-2xl p-8 mb-5" data-testid="projection-card">
        <p className="text-xs text-white/60 uppercase tracking-widest mb-4">Monthly Projection</p>
        <div className="space-y-3 mb-6">
          {[
            { label: `L1 (${Math.round(L1_RATE * 100)}%)`, value: projection.l1, deals: l1Deals, testid: "projection-row-l1" },
            { label: `L2 (${Math.round(L2_RATE * 100)}%)`, value: projection.l2, deals: l2Deals, testid: "projection-row-l2" },
            { label: `L3 (${Math.round(L3_RATE * 100)}%)`, value: projection.l3, deals: l3Deals, testid: "projection-row-l3" },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between text-sm" data-testid={row.testid}>
              <span className="text-white/70">{row.label} — {row.deals} deals</span>
              <span className="font-semibold">${row.value.toFixed(2)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-white/20 pt-3" data-testid="projection-total">
            <span className="font-semibold">Total est. monthly</span>
            <span className="text-2xl font-bold">${projection.total.toFixed(2)}</span>
          </div>
        </div>
        <p className="text-xs text-white/40">
          Rates: L1={Math.round(L1_RATE * 100)}%, L2={Math.round(L2_RATE * 100)}%, L3={Math.round(L3_RATE * 100)}% of $499 fee. Not a guarantee.
        </p>
      </div>

      {/* TWO share actions: copy-link + download PNG */}
      <div className="grid grid-cols-2 gap-3" data-testid="share-actions">
        <Button
          variant="secondary"
          onClick={handleCopyText}
          data-testid="copy-projection-text-btn"
        >
          {copied ? "Copied!" : <><Copy size={14} className="mr-1" /> Copy Text</>}
        </Button>

        <Button
          variant="default"
          onClick={handleDownloadPng}
          data-testid="download-png-btn"
        >
          <Download size={14} className="mr-1" /> Download PNG
        </Button>
      </div>

      <p className="text-xs text-slate-400 text-center mt-3">
        PNG card includes AutoLenis branding, your projection numbers, and a sub-affiliate enrollment link.
      </p>

      <p className="text-xs text-slate-400 text-center mt-2">
        Rates sourced from <strong>lib/constants.ts</strong> and applied consistently across all outputs.
      </p>
    </div>
  );
}
