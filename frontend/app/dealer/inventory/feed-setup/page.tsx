// ENH-1 — DMS Feed Setup

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CheckCircle2, RefreshCw } from "lucide-react";

export default function DealerFeedSetupPage() {
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ feedUrl: "", format: "", refreshHours: "24" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 800));
    setLoading(false);
    setSaved(true);
  }

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="feed-setup-page">
      <div className="flex items-center gap-3 mb-6">
        <RefreshCw size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">DMS Feed Setup</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Connect your Dealer Management System to automatically sync inventory. Provide a URL and AutoLenis will pull your feed on schedule.</p>

      {saved ? (
        <div className="text-center py-8" data-testid="feed-saved">
          <CheckCircle2 size={40} className="text-green-500 mx-auto mb-3" />
          <p className="font-semibold text-slate-900">Feed connected</p>
          <p className="text-sm text-slate-500 mt-1">Your inventory will sync every {form.refreshHours} hours.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} data-testid="feed-setup-form" className="space-y-5">
          <div>
            <Label htmlFor="feed-url">Feed URL</Label>
            <Input id="feed-url" type="url" data-testid="feed-url-input" className="mt-1.5 font-mono text-sm" placeholder="https://yourdms.com/inventory/export.xml"
              value={form.feedUrl} onChange={e => setForm({...form, feedUrl: e.target.value})} required />
            <p className="text-xs text-slate-400 mt-1">Your DMS export URL (XML or JSON format)</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="feed-format">Format</Label>
              <Select id="feed-format" data-testid="feed-format-select" className="mt-1.5" value={form.format} onChange={e => setForm({...form, format: e.target.value})} required>
                <option value="">Select format</option>
                <option value="xml">XML</option>
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="feed-refresh">Refresh every</Label>
              <Select id="feed-refresh" data-testid="feed-refresh-select" className="mt-1.5" value={form.refreshHours} onChange={e => setForm({...form, refreshHours: e.target.value})}>
                {["1", "4", "8", "12", "24", "48"].map(h => <option key={h} value={h}>{h} hour{Number(h) !== 1 ? "s" : ""}</option>)}
              </Select>
            </div>
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={loading} data-testid="feed-save-btn">
            {loading ? "Connecting…" : "Connect DMS Feed"}
          </Button>
        </form>
      )}
    </div>
  );
}
