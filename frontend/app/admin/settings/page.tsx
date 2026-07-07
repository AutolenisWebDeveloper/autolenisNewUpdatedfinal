// /admin/settings — Platform settings with Best Price Engine weight editor
"use client";

import { useState, useEffect } from "react";
import { Settings, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, apiErrorMessage } from "@/lib/api/client";

interface BpeWeights {
  weightOtd: number;
  weightMonthly: number;
  weightFees: number;
  weightJunkFees: number;
  isDefault?: boolean;
  updatedAt?: string;
}

function WeightRow({
  label, field, value, onChange,
}: { label: string; field: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <Label htmlFor={`bpe-${field}`} className="text-sm text-slate-700">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`bpe-${field}`}
          type="number"
          min="0"
          max="1"
          step="0.01"
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          data-testid={`bpe-weight-${field}`}
          className="w-24 text-right"
        />
        <span className="text-xs text-slate-400 w-10">{Math.round(value * 100)}%</span>
      </div>
    </div>
  );
}

export default function AdminSettingsPage() {
  const [weights, setWeights] = useState<BpeWeights>({
    weightOtd: 0.4, weightMonthly: 0.25, weightFees: 0.2, weightJunkFees: 0.15,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.get<BpeWeights>("/api/admin/best-price/weights")
      .then((data) => { setWeights(data); })
      .catch(() => {
        // Surface the failure — silently keeping defaults would let an admin
        // save weights on top of values that never loaded.
        setFeedback({ msg: "Current weights could not be loaded — the values below are defaults, not what is live. Reload before saving.", ok: false });
      })
      .finally(() => setLoading(false));
  }, []);

  const sum = parseFloat((weights.weightOtd + weights.weightMonthly + weights.weightFees + weights.weightJunkFees).toFixed(3));
  const isValid = Math.abs(sum - 1) < 0.001;

  async function handleSave() {
    if (!isValid) { setFeedback({ msg: `Weights sum to ${sum} — must equal 1.0`, ok: false }); return; }
    setSaving(true);
    setFeedback(null);
    try {
      const data = await api.patch<BpeWeights>("/api/admin/best-price/weights", weights);
      setWeights(data);
      setFeedback({ msg: "Weights saved successfully", ok: true });
      setTimeout(() => setFeedback(null), 4000);
    } catch (err) { setFeedback({ msg: apiErrorMessage(err, "Save failed"), ok: false }); }
    setSaving(false);
  }

  // Only settings with a real management surface are listed — inert
  // placeholder rows were removed (no dead-ends).
  const SETTINGS_LINKS: Array<{ label: string; href: string }> = [
    { label: "Contract Shield Rules", href: "/admin/contract-shield/rules" },
    { label: "Refinance Partner", href: "/admin/refinance/partner" },
    { label: "Referral Milestone Tiers", href: "/admin/referral-milestones" },
    { label: "Admin Accounts", href: "/admin/settings/admins" },
    { label: "Security / MFA", href: "/admin/security/mfa" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="admin-settings-page">
      <div className="flex items-center gap-3 mb-6">
        <Settings size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Platform Settings</h1>
      </div>

      {/* Best Price Engine Weights — full editor */}
      <div className="bg-white border-2 border-al-primary/20 rounded-xl p-6 mb-6" data-testid="bpe-weights-section">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-slate-900">Best Price Engine Weights</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Control how the scoring algorithm weighs each factor. Weights must sum to 1.0.
              {weights.updatedAt && ` Last saved: ${new Date(weights.updatedAt).toLocaleDateString()}`}
            </p>
          </div>
          <span className={`text-xs font-bold px-2 py-1 rounded-lg border ${isValid ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`} data-testid="bpe-sum-badge">
            Sum: {sum}
          </span>
        </div>

        {loading ? (
          <div className="py-6 flex items-center justify-center text-slate-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <>
            <div className="mb-4">
              <WeightRow label="OTD Price (Drive-off total)"    field="otd"      value={weights.weightOtd}      onChange={v => setWeights(p => ({ ...p, weightOtd: v }))} />
              <WeightRow label="Monthly Payment"               field="monthly"  value={weights.weightMonthly}  onChange={v => setWeights(p => ({ ...p, weightMonthly: v }))} />
              <WeightRow label="Dealer Fees"                   field="fees"     value={weights.weightFees}     onChange={v => setWeights(p => ({ ...p, weightFees: v }))} />
              <WeightRow label="Junk Fees Detected"            field="junkFees" value={weights.weightJunkFees} onChange={v => setWeights(p => ({ ...p, weightJunkFees: v }))} />
            </div>

            {feedback && (
              <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg mb-3 ${feedback.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`} data-testid="bpe-feedback">
                {feedback.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                {feedback.msg}
              </div>
            )}

            <Button
              onClick={handleSave}
              disabled={saving || !isValid}
              data-testid="bpe-save-btn"
              className="w-full"
            >
              {saving ? <><Loader2 size={14} className="animate-spin mr-2" />Saving…</> : "Save Best Price Engine Weights"}
            </Button>
          </>
        )}
      </div>

      {/* Other settings (future implementation) */}
      <div className="space-y-3" data-testid="other-settings-list">
        {SETTINGS_LINKS.map(s => (
          <a key={s.href} href={s.href} className="block bg-white border border-slate-200 rounded-xl p-4 text-sm font-medium text-slate-700 hover:border-al-primary/30 transition-colors">
            {s.label} →
          </a>
        ))}
      </div>
    </div>
  );
}
