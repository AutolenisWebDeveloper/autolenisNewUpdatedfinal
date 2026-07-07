// /admin/inventory/markets — System 15 Market Coverage CRUD
// Persists via /api/admin/inventory/markets (+ [id] DELETE=deactivate);
// previously this page held edits in local state only and lost them on refresh.

"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, MapPin, Loader2 } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";
import { ErrorState } from "@/components/ui/kit";

interface Market { id: string; city: string; state: string; zip: string | null; status: string; listingCount: number }

export default function AdminInventoryMarketsPage() {
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [newMarket, setNewMarket] = useState({ city: "", state: "", zip: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const d = await api.get<{ markets: Market[] }>("/api/admin/inventory/markets");
      setMarkets(d.markets ?? []);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addMarket() {
    if (!newMarket.city || !newMarket.zip || newMarket.state.length !== 2) {
      toast.error("City, 2-letter state, and a 5-digit ZIP are required");
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/admin/inventory/markets", {
        city: newMarket.city.trim(),
        state: newMarket.state.trim().toUpperCase(),
        zip: newMarket.zip.trim(),
      });
      toast.success(`Market ${newMarket.city} added`);
      setNewMarket({ city: "", state: "", zip: "" });
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Failed to add market"));
    } finally {
      setSaving(false);
    }
  }

  async function removeMarket(m: Market) {
    try {
      await api.del(`/api/admin/inventory/markets/${m.id}`);
      toast.success(`Market ${m.city} deactivated`);
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Failed to deactivate market"));
    }
  }

  const active = (markets ?? []).filter(m => m.status === "ACTIVE");

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="admin-markets-page">
      <div className="flex items-center gap-3 mb-6"><MapPin size={22} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">Market Coverage</h1></div>

      {loadError ? (
        <div className="bg-white border border-red-200 rounded-xl mb-6">
          <ErrorState title="Failed to load markets" onRetry={() => void load()} data-testid="markets-load-error" />
        </div>
      ) : markets === null ? (
        <div className="flex items-center py-16 justify-center text-slate-400" data-testid="markets-loading">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading markets…
        </div>
      ) : active.length === 0 ? (
        <div className="text-center py-10 text-slate-400 bg-white border border-slate-200 rounded-xl mb-6" data-testid="markets-empty">
          <p className="font-medium text-slate-500">No active markets</p>
          <p className="text-xs mt-1">Add the first market below.</p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {active.map(m => (
            <div key={m.id} data-testid={`market-${m.id}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div>
                <p className="font-medium text-slate-800 text-sm">{m.city}, {m.state}</p>
                <p className="text-xs text-slate-400">ZIP: {m.zip ?? "—"} · {m.listingCount} listings</p>
              </div>
              <button onClick={() => void removeMarket(m)} data-testid={`remove-market-${m.id}`} aria-label={`Deactivate market ${m.city}`} className="text-slate-400 hover:text-red-500"><Trash2 size={15} aria-hidden /></button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="font-semibold text-slate-800 text-sm mb-4">Add Market</p>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div><Label htmlFor="new-market-city">City</Label><Input id="new-market-city" className="mt-1" data-testid="new-market-city" value={newMarket.city} onChange={e => setNewMarket({...newMarket, city: e.target.value})} /></div>
          <div><Label htmlFor="new-market-state">State</Label><Input id="new-market-state" className="mt-1" data-testid="new-market-state" value={newMarket.state} onChange={e => setNewMarket({...newMarket, state: e.target.value})} maxLength={2} /></div>
          <div><Label htmlFor="new-market-zip">ZIP</Label><Input id="new-market-zip" className="mt-1" data-testid="new-market-zip" value={newMarket.zip} onChange={e => setNewMarket({...newMarket, zip: e.target.value})} /></div>
        </div>
        <Button size="sm" onClick={addMarket} disabled={saving} data-testid="add-market-btn">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14}/>} Add Market
        </Button>
      </div>
    </div>
  );
}
