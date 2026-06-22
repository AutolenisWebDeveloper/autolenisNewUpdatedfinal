"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Package, Plus, Upload, Search, Filter, Edit2, Trash2,
  Power, Loader2, CheckCircle2, X, Eye, ArrowRightLeft
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ItemRow {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  vin: string | null;
  priceCents: number;
  mileage: number | null;
  lane: string;
  isActive: boolean;
  sourceAdapter: string | null;
  images: string[];
  dealerName: string | null;
  createdAt: string;
}

const SOURCE_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "manual_admin", label: "Manual entry" },
  { value: "csv_upload_admin", label: "CSV upload" },
  { value: "marketcheck", label: "MarketCheck" },
];
const LANE_OPTIONS = ["", "LANE_1", "LANE_2", "LANE_3"];
const MOVE_LANE_OPTIONS = ["LANE_1", "LANE_2", "LANE_3"];
const laneLabel = (lane: string) => lane.replace("_", " ");
const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export default function InventoryListClient({ initialItems }: { initialItems: ItemRow[] }) {
  const [items, setItems] = useState<ItemRow[]>(initialItems);
  const [query, setQuery] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterLane, setFilterLane] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [movingLane, setMovingLane] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const q = query.trim().toLowerCase();
  const filtered = items.filter(it => {
    if (filterSource && it.sourceAdapter !== filterSource) return false;
    if (filterLane && it.lane !== filterLane) return false;
    if (filterStatus === "active" && !it.isActive) return false;
    if (filterStatus === "inactive" && it.isActive) return false;
    if (!q) return true;
    const hay = `${it.year} ${it.make} ${it.model} ${it.trim ?? ""} ${it.vin ?? ""} ${it.sourceAdapter ?? ""}`.toLowerCase();
    return hay.includes(q);
  });

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(it => it.id)));
  }

  async function toggleActive(id: string, makeActive: boolean) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/inventory/${id}/deactivate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activate: makeActive }),
      });
      const data = await res.json() as { success?: boolean; data?: { isActive: boolean }; error?: { message?: string } };
      if (!res.ok || !data.success) {
        showToast(data.error?.message ?? "Failed to update", "error");
        return;
      }
      setItems(prev => prev.map(it => it.id === id ? { ...it, isActive: data.data!.isActive } : it));
      showToast(makeActive ? "Vehicle reactivated" : "Vehicle deactivated");
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteItem(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/inventory/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
      });
      const data = await res.json() as { success?: boolean; error?: { message?: string } };
      if (!res.ok || !data.success) {
        showToast(data.error?.message ?? "Delete failed", "error");
        return;
      }
      setItems(prev => prev.filter(it => it.id !== id));
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      showToast("Vehicle permanently deleted");
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  }

  async function bulkMoveLane(lane: string) {
    if (selected.size === 0 || !MOVE_LANE_OPTIONS.includes(lane)) return;
    const ids = Array.from(selected);
    // Optimistic snapshot so we can roll back on failure.
    const prevLanes = new Map(items.filter(it => selected.has(it.id)).map(it => [it.id, it.lane]));
    setMovingLane(lane);
    // Optimistic UI update for instant feedback.
    setItems(prev => prev.map(it => selected.has(it.id) ? { ...it, lane } : it));
    try {
      const res = await fetch(`/api/admin/inventory/bulk-lane`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, lane }),
      });
      const data = await res.json() as {
        success?: boolean;
        data?: { moved: number; unchanged: number; notFound: number };
        error?: { message?: string };
      };
      if (!res.ok || !data.success) {
        // Roll back optimistic change.
        setItems(prev => prev.map(it => prevLanes.has(it.id) ? { ...it, lane: prevLanes.get(it.id)! } : it));
        showToast(data.error?.message ?? "Failed to move vehicles", "error");
        return;
      }
      const { moved, unchanged, notFound } = data.data!;
      const parts = [`${moved} moved to ${laneLabel(lane)}`];
      if (unchanged > 0) parts.push(`${unchanged} already there`);
      if (notFound > 0) parts.push(`${notFound} not found`);
      setSelected(new Set());
      showToast(parts.join(", "), notFound > 0 ? "error" : "success");
    } catch {
      setItems(prev => prev.map(it => prevLanes.has(it.id) ? { ...it, lane: prevLanes.get(it.id)! } : it));
      showToast("Network error", "error");
    } finally {
      setMovingLane(null);
    }
  }

  async function bulkAction(action: "deactivate" | "activate" | "delete") {
    if (selected.size === 0) return;
    if (action === "delete" && !confirm(`Permanently delete ${selected.size} vehicle${selected.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkBusy(true);
    let success = 0;
    let failure = 0;
    const ids = Array.from(selected);
    try {
      await Promise.all(ids.map(async id => {
        try {
          if (action === "delete") {
            const r = await fetch(`/api/admin/inventory/${id}`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ confirmation: "DELETE" }),
            });
            if (r.ok) success++; else failure++;
          } else {
            const r = await fetch(`/api/admin/inventory/${id}/deactivate`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ activate: action === "activate" }),
            });
            if (r.ok) success++; else failure++;
          }
        } catch { failure++; }
      }));

      if (action === "delete") {
        setItems(prev => prev.filter(it => !selected.has(it.id)));
      } else {
        const makeActive = action === "activate";
        setItems(prev => prev.map(it => selected.has(it.id) ? { ...it, isActive: makeActive } : it));
      }
      setSelected(new Set());
      showToast(`${success} succeeded${failure > 0 ? `, ${failure} failed` : ""}`, failure > 0 ? "error" : "success");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl" data-testid="admin-inventory-page">
      {toast && (
        <div data-testid="inventory-toast" className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-lg ${toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.msg}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="confirm-delete-modal">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h3 className="text-base font-bold text-slate-900 mb-2">Delete vehicle?</h3>
            <p className="text-sm text-slate-600 mb-5">
              You&rsquo;re about to permanently delete <span className="font-semibold">{confirmDelete.label}</span>. This cannot be undone. Consider deactivating instead.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg text-sm font-semibold" data-testid="cancel-delete-btn">Cancel</button>
              <button
                onClick={() => deleteItem(confirmDelete.id)}
                disabled={busyId === confirmDelete.id}
                data-testid="confirm-delete-btn"
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold"
              >
                {busyId === confirmDelete.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Package size={20} className="text-[#0B5FD1]" />
            <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
            <Badge variant="gray" className="text-xs">{filtered.length} of {items.length}</Badge>
          </div>
          <p className="text-sm text-slate-500">Manage all vehicles in the marketplace.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/admin/inventory/upload/history" data-testid="open-history-btn" className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-semibold text-slate-700">
            History
          </Link>
          <Link href="/admin/inventory/search-tool" data-testid="open-search-tool-btn" className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-semibold text-slate-700">
            <Search size={13} /> Search Tool
          </Link>
          <Link href="/admin/inventory/upload" data-testid="open-bulk-upload-btn" className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-semibold text-slate-700">
            <Upload size={13} /> Bulk Upload
          </Link>
          <Link href="/admin/inventory/new" data-testid="open-add-vehicle-btn" className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white rounded-lg text-xs font-semibold">
            <Plus size={13} /> Add Vehicle
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 md:p-4 mb-4" data-testid="filters-bar">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              data-testid="filter-query"
              type="text"
              placeholder="Search by year / make / model / VIN..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30 focus:border-[#0B5FD1]"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400 hidden md:block" />
            <select data-testid="filter-source" value={filterSource} onChange={e => setFilterSource(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-xs">
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select data-testid="filter-lane" value={filterLane} onChange={e => setFilterLane(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-xs">
              {LANE_OPTIONS.map(l => <option key={l} value={l}>{l || "All lanes"}</option>)}
            </select>
            <select data-testid="filter-status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-xs">
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-[#0B5FD1]/5 border border-[#0B5FD1]/20 rounded-xl p-3 mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" data-testid="bulk-action-bar">
          <span className="text-sm font-semibold text-[#0B5FD1]">{selected.size} selected</span>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Bulk move to lane */}
            <div className="inline-flex items-center gap-1.5 bg-white border border-slate-300 rounded px-2 py-1" data-testid="bulk-move-lane">
              <ArrowRightLeft size={12} className="text-slate-400 shrink-0" />
              <label htmlFor="bulk-lane-select" className="text-xs font-semibold text-slate-600 hidden sm:inline">Move to</label>
              <select
                id="bulk-lane-select"
                data-testid="bulk-move-lane-select"
                value=""
                disabled={bulkBusy || movingLane !== null}
                onChange={e => { if (e.target.value) bulkMoveLane(e.target.value); }}
                className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none disabled:opacity-50 cursor-pointer"
              >
                <option value="">Select lane…</option>
                {MOVE_LANE_OPTIONS.map(l => <option key={l} value={l}>{laneLabel(l)}</option>)}
              </select>
              {movingLane && <Loader2 size={12} className="animate-spin text-[#0B5FD1]" data-testid="bulk-move-lane-spinner" />}
            </div>
            <button onClick={() => bulkAction("activate")} disabled={bulkBusy || movingLane !== null} data-testid="bulk-activate-btn" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded text-xs font-semibold disabled:opacity-50">
              <CheckCircle2 size={12} /> Activate
            </button>
            <button onClick={() => bulkAction("deactivate")} disabled={bulkBusy || movingLane !== null} data-testid="bulk-deactivate-btn" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded text-xs font-semibold disabled:opacity-50">
              <Power size={12} /> Deactivate
            </button>
            <button onClick={() => bulkAction("delete")} disabled={bulkBusy || movingLane !== null} data-testid="bulk-delete-btn" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold disabled:opacity-50">
              {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
            </button>
            <button onClick={() => setSelected(new Set())} data-testid="bulk-clear-btn" className="text-slate-500 hover:text-slate-900 px-2 py-1.5"><X size={14} /></button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-sm text-slate-500" data-testid="empty-state">
            <Package size={28} className="mx-auto text-slate-300 mb-2" />
            No vehicles match your filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="inventory-table">
              <thead>
                <tr className="text-left text-slate-500 bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox"
                      checked={selected.size > 0 && selected.size === filtered.length}
                      onChange={toggleSelectAll}
                      data-testid="select-all-checkbox" />
                  </th>
                  <th className="px-3 py-3 font-semibold">Vehicle</th>
                  <th className="px-3 py-3 font-semibold">VIN</th>
                  <th className="px-3 py-3 font-semibold">Price</th>
                  <th className="px-3 py-3 font-semibold">Mileage</th>
                  <th className="px-3 py-3 font-semibold">Source</th>
                  <th className="px-3 py-3 font-semibold">Lane</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(it => {
                  const cover = it.images?.[0];
                  return (
                    <tr key={it.id} data-testid={`inventory-row-${it.id}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleSelect(it.id)} data-testid={`row-checkbox-${it.id}`} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded-md bg-slate-100 overflow-hidden shrink-0">
                            {cover ? (
                              <img src={cover} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-300"><Package size={14} /></div>
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{it.year} {it.make} {it.model}</p>
                            {it.trim && <p className="text-[10px] text-slate-400">{it.trim}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-[10px] text-slate-500">{it.vin ?? "—"}</td>
                      <td className="px-3 py-3 font-semibold text-slate-900">${(it.priceCents / 100).toLocaleString()}</td>
                      <td className="px-3 py-3 text-slate-700">{it.mileage?.toLocaleString() ?? "—"}</td>
                      <td className="px-3 py-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{it.sourceAdapter ?? "—"}</span>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={it.lane === "LANE_1" ? "green" : it.lane === "LANE_2" ? "blue" : "gray"} className="text-[10px]">{it.lane.replace("_", " ")}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={it.isActive ? "green" : "gray"} className="text-[10px]">{it.isActive ? "Active" : "Inactive"}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/inventory/${it.id}`}
                            target="_blank"
                            data-testid={`view-public-${it.id}`}
                            title="View public listing"
                            className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-900"
                          ><Eye size={13} /></Link>
                          <Link
                            href={`/admin/inventory/${it.id}/edit`}
                            data-testid={`edit-${it.id}`}
                            title="Edit"
                            className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-900"
                          ><Edit2 size={13} /></Link>
                          <button
                            onClick={() => toggleActive(it.id, !it.isActive)}
                            disabled={busyId === it.id}
                            data-testid={`deactivate-${it.id}`}
                            title={it.isActive ? "Deactivate" : "Reactivate"}
                            className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-amber-600"
                          >
                            {busyId === it.id ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                          </button>
                          <button
                            onClick={() => setConfirmDelete({ id: it.id, label: `${it.year} ${it.make} ${it.model}` })}
                            disabled={busyId === it.id}
                            data-testid={`delete-${it.id}`}
                            title="Delete permanently"
                            className="p-1.5 hover:bg-red-50 rounded text-slate-500 hover:text-red-600"
                          ><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
