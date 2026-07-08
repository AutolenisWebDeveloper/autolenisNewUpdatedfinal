"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api, apiErrorMessage } from "@/lib/api/client";
import { Trash2, Plus } from "lucide-react";

export interface MilestoneConfig {
  id: string;
  threshold: number;
  label: string;
  rewardType: string;
  rewardValue: number; // cents
  active: boolean;
}

function dollars(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function ReferralMilestoneConfigManager({ initialConfigs }: { initialConfigs: MilestoneConfig[] }) {
  const [configs, setConfigs] = useState<MilestoneConfig[]>(initialConfigs);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ threshold: "", label: "", rewardDollars: "" });

  async function addConfig() {
    const threshold = parseInt(form.threshold, 10);
    const rewardValue = Math.round(parseFloat(form.rewardDollars) * 100);
    if (!Number.isInteger(threshold) || threshold <= 0) return toast.error("Threshold must be a positive whole number");
    if (!form.label.trim()) return toast.error("Label is required");
    if (!Number.isFinite(rewardValue) || rewardValue < 0) return toast.error("Reward must be a non-negative amount");

    setAdding(true);
    try {
      const { config } = await api.post<{ config: MilestoneConfig }>("/api/admin/referral-milestone-configs", {
        threshold, label: form.label.trim(), rewardType: "CASH", rewardValue,
      });
      setConfigs(prev => [...prev, config].sort((a, b) => a.threshold - b.threshold));
      setForm({ threshold: "", label: "", rewardDollars: "" });
      toast.success("Milestone tier added");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not add tier"));
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(cfg: MilestoneConfig) {
    setBusyId(cfg.id);
    try {
      const { config } = await api.patch<{ config: MilestoneConfig }>(`/api/admin/referral-milestone-configs/${cfg.id}`, { active: !cfg.active });
      setConfigs(prev => prev.map(c => c.id === cfg.id ? config : c));
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not update tier"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(cfg: MilestoneConfig) {
    if (!confirm(`Delete the "${cfg.label}" tier (${cfg.threshold} referrals)? Already-earned milestones are unaffected.`)) return;
    setBusyId(cfg.id);
    try {
      await api.del(`/api/admin/referral-milestone-configs/${cfg.id}`);
      setConfigs(prev => prev.filter(c => c.id !== cfg.id));
      toast.success("Tier deleted");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not delete tier"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-8" data-testid="milestone-config-manager">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Milestone thresholds</h2>
          <p className="text-xs text-slate-500">Referrals required to earn a reward. Payouts stay a manual admin action.</p>
        </div>
      </div>

      {configs.length === 0 ? (
        <p className="text-slate-400 text-sm mb-4">No tiers configured — buyers earn no milestones until you add one.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {configs.map(cfg => (
            <div key={cfg.id} data-testid={`config-${cfg.id}`}
              className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl px-4 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono tabular-nums font-bold text-slate-900 text-sm w-14 shrink-0">{cfg.threshold}×</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{cfg.label}</p>
                  <p className="text-xs text-slate-400">{dollars(cfg.rewardValue)} · {cfg.rewardType}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => toggleActive(cfg)} disabled={busyId === cfg.id}
                  data-testid={`config-toggle-${cfg.id}`} className="disabled:opacity-50">
                  <Badge variant={cfg.active ? "green" : "secondary"} className="text-xs cursor-pointer">
                    {cfg.active ? "Active" : "Inactive"}
                  </Badge>
                </button>
                <Button size="sm" variant="ghost" onClick={() => remove(cfg)} disabled={busyId === cfg.id}
                  data-testid={`config-delete-${cfg.id}`} className="text-al-danger hover:text-al-danger">
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
        <div className="w-24">
          <label className="text-[11px] font-medium text-slate-500 block mb-1">Referrals</label>
          <Input type="number" min={1} value={form.threshold}
            onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))} placeholder="5" />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="text-[11px] font-medium text-slate-500 block mb-1">Label</label>
          <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Bronze Referrer" />
        </div>
        <div className="w-28">
          <label className="text-[11px] font-medium text-slate-500 block mb-1">Reward ($)</label>
          <Input type="number" min={0} step="0.01" value={form.rewardDollars}
            onChange={e => setForm(f => ({ ...f, rewardDollars: e.target.value }))} placeholder="50" />
        </div>
        <Button size="sm" onClick={addConfig} disabled={adding} data-testid="config-add-btn">
          <Plus size={14} className="mr-1" />{adding ? "Adding…" : "Add tier"}
        </Button>
      </div>
    </div>
  );
}
