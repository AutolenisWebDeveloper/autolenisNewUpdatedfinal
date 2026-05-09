// /admin/inventory/markets — System 15 Market Coverage CRUD

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, MapPin } from "lucide-react";

interface Market { id: string; city: string; state: string; zip: string }

const DEFAULT_MARKETS: Market[] = [
  { id: "1", city: "New York", state: "NY", zip: "10001" },
  { id: "2", city: "Los Angeles", state: "CA", zip: "90001" },
  { id: "3", city: "Chicago", state: "IL", zip: "60601" },
  { id: "4", city: "Houston", state: "TX", zip: "77001" },
  { id: "5", city: "Atlanta", state: "GA", zip: "30301" },
];

export default function AdminInventoryMarketsPage() {
  const [markets, setMarkets] = useState<Market[]>(DEFAULT_MARKETS);
  const [newMarket, setNewMarket] = useState({ city: "", state: "", zip: "" });

  function addMarket() {
    if (!newMarket.city || !newMarket.zip) return;
    setMarkets([...markets, { id: Date.now().toString(), ...newMarket }]);
    setNewMarket({ city: "", state: "", zip: "" });
  }

  function removeMarket(id: string) { setMarkets(markets.filter(m => m.id !== id)); }

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="admin-markets-page">
      <div className="flex items-center gap-3 mb-6"><MapPin size={22} className="text-[#0B5FD1]" /><h1 className="text-xl font-bold text-slate-900">Market Coverage</h1></div>
      <div className="space-y-2 mb-6">
        {markets.map(m => (
          <div key={m.id} data-testid={`market-${m.id}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div><p className="font-medium text-slate-800 text-sm">{m.city}, {m.state}</p><p className="text-xs text-slate-400">ZIP: {m.zip}</p></div>
            <button onClick={() => removeMarket(m.id)} data-testid={`remove-market-${m.id}`} className="text-slate-400 hover:text-red-500"><Trash2 size={15}/></button>
          </div>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="font-semibold text-slate-800 text-sm mb-4">Add Market</p>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div><Label>City</Label><Input className="mt-1" data-testid="new-market-city" value={newMarket.city} onChange={e => setNewMarket({...newMarket, city: e.target.value})} /></div>
          <div><Label>State</Label><Input className="mt-1" data-testid="new-market-state" value={newMarket.state} onChange={e => setNewMarket({...newMarket, state: e.target.value})} maxLength={2} /></div>
          <div><Label>ZIP</Label><Input className="mt-1" data-testid="new-market-zip" value={newMarket.zip} onChange={e => setNewMarket({...newMarket, zip: e.target.value})} /></div>
        </div>
        <Button size="sm" onClick={addMarket} data-testid="add-market-btn"><Plus size={14}/> Add Market</Button>
      </div>
    </div>
  );
}
