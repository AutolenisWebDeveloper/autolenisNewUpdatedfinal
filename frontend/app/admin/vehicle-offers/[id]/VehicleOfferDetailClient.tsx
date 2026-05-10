"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Clock, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";

export type DealerVehicle = {
  vehicleUrl: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  mileage?: number;
  color?: string;
  condition: string;
  offerPriceCents: number;
  tradeInAccepted: boolean;
  financingAvailable: boolean;
  warrantyIncluded: boolean;
  warrantyDetails?: string;
  availability: string;
};

export type DetailSubmission = {
  id: string;
  dealershipName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  submittedAt: string;
  notes: string | null;
  vehicles: unknown;
};

export type DetailOffer = {
  id: string;
  token: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleTrim: string | null;
  vehicleMileage: number | null;
  vehicleVin: string | null;
  vehicleColor: string | null;
  vehicleCondition: string;
  askingPriceCents: number | null;
  vehicleReferenceUrl: string | null;
  buyerBudget: string;
  buyerZip: string;
  buyerNewOrUsed: string;
  buyerFinancing: string;
  buyerEmail: string | null;
  buyerName: string | null;
  adminNotes: string | null;
  referenceId: string | null;
  expiresAt: string | null;
  createdAt: string;
  submissions: DetailSubmission[];
  latestReview: { reviewToken: string; buyerName: string; buyerEmail: string; sentAt: string } | null;
};

type SelectedKey = string; // `${submissionId}::${vehicleIndex}`
const keyOf = (s: string, i: number): SelectedKey => `${s}::${i}`;

function parseVehicles(raw: unknown): DealerVehicle[] {
  if (!Array.isArray(raw)) return [];
  return raw as DealerVehicle[];
}

export default function VehicleOfferDetailClient({ offer, appUrl }: { offer: DetailOffer; appUrl: string }) {
  const [selected, setSelected] = useState<Set<SelectedKey>>(new Set());
  const [buyerName, setBuyerName] = useState(offer.buyerName ?? "");
  const [buyerEmail, setBuyerEmail] = useState(offer.buyerEmail ?? "");
  const [adminMessage, setAdminMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentResult, setSentResult] = useState<{ reviewUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const offerUrl = `${appUrl}/dealer-offer/${offer.token}`;
  const vehicleLabel = `${offer.vehicleYear} ${offer.vehicleMake} ${offer.vehicleModel}${offer.vehicleTrim ? ` ${offer.vehicleTrim}` : ""}`;

  const allItems = useMemo(() => offer.submissions.flatMap((s) => parseVehicles(s.vehicles).map((v, idx) => ({ submissionId: s.id, idx, v, dealer: s.dealershipName }))), [offer.submissions]);
  const totalSubmissions = offer.submissions.length;

  function toggle(submissionId: string, idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(submissionId, idx);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function handleSendToBuyer(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) return;
    setError(null);
    if (!buyerName.trim() || !/\S+@\S+\.\S+/.test(buyerEmail.trim())) {
      setError("Buyer name and a valid email are required.");
      return;
    }
    setSending(true);
    try {
      const items = Array.from(selected).map((k) => {
        const [submissionId, idx] = k.split("::");
        return { submissionId, vehicleIndex: Number(idx) };
      });
      const res = await fetch(`/api/admin/vehicle-offers/${offer.id}/send-to-buyer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerName, buyerEmail, adminMessage: adminMessage || undefined, items }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { reviewToken: string; reviewUrl: string };
        error?: { message?: string };
      };
      if (res.ok && data.success && data.data) {
        setSentResult({ reviewUrl: data.data.reviewUrl });
        setSelected(new Set());
      } else {
        setError(data.error?.message ?? "Unable to send to buyer.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setSending(false);
    }
  }

  function copyReviewUrl() {
    if (!sentResult) return;
    void navigator.clipboard.writeText(sentResult.reviewUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl pb-32" data-testid="vehicle-offer-detail-page">
      {/* Header card */}
      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6 mb-4">
        <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">Vehicle Offer Link</p>
        <h1 className="text-2xl font-bold text-[#111827] mb-2">{vehicleLabel}</h1>
        <div className="flex flex-wrap gap-2 mb-3">
          <Badge>{offer.vehicleCondition}</Badge>
          {offer.vehicleMileage && <Badge variant="outline">{offer.vehicleMileage.toLocaleString()} mi</Badge>}
          {offer.vehicleColor && <Badge variant="outline">{offer.vehicleColor}</Badge>}
          {offer.askingPriceCents && <Badge variant="outline">Market: ${(offer.askingPriceCents / 100).toLocaleString()}</Badge>}
        </div>
        {offer.vehicleReferenceUrl && (
          <a
            href={offer.vehicleReferenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[#0B5FD1] text-sm font-medium hover:underline"
            data-testid="offer-reference-link"
          >
            <ExternalLink size={14} /> View Vehicle Reference →
          </a>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100 text-xs">
          <div><p className="text-slate-400 mb-0.5">Buyer Budget</p><p className="font-medium text-slate-700">{offer.buyerBudget}</p></div>
          <div><p className="text-slate-400 mb-0.5">Buyer ZIP</p><p className="font-medium text-slate-700">{offer.buyerZip}</p></div>
          <div><p className="text-slate-400 mb-0.5">Preference</p><p className="font-medium text-slate-700">{offer.buyerNewOrUsed}</p></div>
          <div><p className="text-slate-400 mb-0.5">Financing</p><p className="font-medium text-slate-700">{offer.buyerFinancing}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
          {offer.expiresAt && <div><p className="text-slate-400 mb-0.5">Expires</p><p className="font-medium text-slate-700">{new Date(offer.expiresAt).toLocaleDateString()}</p></div>}
          {offer.referenceId && <div><p className="text-slate-400 mb-0.5">Reference ID</p><p className="font-medium text-slate-700">{offer.referenceId}</p></div>}
        </div>
      </div>

      {/* Submissions */}
      {totalSubmissions === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center mt-6">
          <Clock size={32} className="text-slate-300 mx-auto mb-3" />
          <h3 className="font-semibold text-slate-700 mb-1">Waiting for Dealer Submissions</h3>
          <p className="text-sm text-slate-500 mb-4">No dealers have submitted offers yet. Share the link below to get offers.</p>
          <code className="text-xs bg-slate-100 px-3 py-1.5 rounded-lg text-slate-600 font-mono break-all">
            {offerUrl}
          </code>
        </div>
      ) : (
        <div className="space-y-4 mt-4">
          <p className="text-sm text-slate-600">
            <span className="font-semibold">{totalSubmissions}</span> dealer submission{totalSubmissions === 1 ? "" : "s"} &middot; <span className="font-semibold">{allItems.length}</span> vehicle offer{allItems.length === 1 ? "" : "s"}
          </p>
          {offer.submissions.map((s) => {
            const vehicles = parseVehicles(s.vehicles);
            return (
              <div key={s.id} className="bg-white rounded-2xl border border-[#E5E7EB] p-6" data-testid={`submission-${s.id}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold text-[#111827]">{s.dealershipName}</p>
                    <p className="text-xs text-slate-400">Submitted {new Date(s.submittedAt).toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 mb-4">
                  {s.contactName} &middot; {s.contactEmail} &middot; {s.contactPhone}
                </p>

                <div className="space-y-3">
                  {vehicles.map((v, idx) => {
                    const k = keyOf(s.id, idx);
                    const isSelected = selected.has(k);
                    return (
                      <div
                        key={idx}
                        className={`rounded-xl p-4 border-2 transition-colors ${isSelected ? "border-[#0B5FD1] bg-[#0B5FD1]/5" : "border-slate-100 bg-slate-50"}`}
                        data-testid={`submission-${s.id}-vehicle-${idx}`}
                      >
                        <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">Vehicle Offer {idx + 1}</p>
                        <p className="font-bold text-[#111827]">
                          {v.year} {v.make} {v.model}{v.trim ? <span className="text-slate-400 font-normal"> {v.trim}</span> : null}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          <Badge variant="outline">{v.condition}</Badge>
                          {v.mileage && <Badge variant="outline">{v.mileage.toLocaleString()} mi</Badge>}
                          {v.color && <Badge variant="outline">{v.color}</Badge>}
                        </div>
                        <a
                          href={v.vehicleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 mt-3 bg-[#0B5FD1] text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-[#0944a8]"
                        >
                          <ExternalLink size={12} /> View Vehicle →
                        </a>
                        <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                          <div>
                            <p className="text-xs text-slate-400">OTD Price</p>
                            <p className="font-mono font-bold text-[#0B5FD1]">${(v.offerPriceCents / 100).toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Availability</p>
                            <p className="font-medium text-slate-700">{v.availability}</p>
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                          Trade-In: {v.tradeInAccepted ? "Yes" : "No"} &middot; Financing: {v.financingAvailable ? "Yes" : "No"} &middot; Warranty: {v.warrantyIncluded ? `Yes${v.warrantyDetails ? ` — ${v.warrantyDetails}` : ""}` : "No"}
                        </p>
                        <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggle(s.id, idx)}
                            className="h-4 w-4 rounded border-slate-300 accent-[#0B5FD1]"
                            data-testid={`select-vehicle-${s.id}-${idx}`}
                          />
                          <span className="text-xs font-medium text-slate-700">Select this vehicle for buyer review</span>
                        </label>
                      </div>
                    );
                  })}
                </div>

                {s.notes && <p className="text-xs text-slate-500 mt-3 bg-slate-50 rounded-lg p-3">Notes: {s.notes}</p>}
              </div>
            );
          })}
        </div>
      )}

      {/* Send to buyer panel */}
      {selected.size > 0 && !sentResult && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-[220px] z-20 bg-white border-t border-[#E5E7EB] shadow-2xl shadow-[#0B5FD1]/10" data-testid="send-to-buyer-panel">
          <form onSubmit={handleSendToBuyer} className="max-w-4xl mx-auto p-6">
            <p className="text-sm font-semibold text-[#111827] mb-3">
              Selected: <span className="text-[#0B5FD1]">{selected.size}</span> vehicle offer{selected.size === 1 ? "" : "s"} ready to send
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="stb-name" className="text-xs font-medium text-[#374151]">Buyer Name</Label>
                <Input id="stb-name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className="mt-1" data-testid="stb-buyer-name" required />
              </div>
              <div>
                <Label htmlFor="stb-email" className="text-xs font-medium text-[#374151]">Buyer Email</Label>
                <Input id="stb-email" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} className="mt-1" data-testid="stb-buyer-email" required />
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor="stb-msg" className="text-xs font-medium text-[#374151]">Message (optional)</Label>
              <Textarea id="stb-msg" value={adminMessage} onChange={(e) => setAdminMessage(e.target.value.slice(0, 1000))} className="mt-1 min-h-[60px]" data-testid="stb-message" />
            </div>
            {error && <p className="text-xs text-red-600 mt-2" data-testid="stb-error">{error}</p>}
            <Button type="submit" className="mt-3" disabled={sending} data-testid="stb-submit">
              {sending ? <><Loader2 size={14} className="animate-spin mr-1.5" />Sending…</> : "Send Offers to Buyer →"}
            </Button>
          </form>
        </div>
      )}

      {sentResult && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mt-6" data-testid="send-success">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={22} className="text-green-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-green-800 mb-1">Sent to {buyerName} at {buyerEmail}</p>
              <div className="flex items-center gap-2 mt-2">
                <code className="text-xs text-slate-700 font-mono bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 truncate flex-1">{sentResult.reviewUrl}</code>
                <button onClick={copyReviewUrl} className="text-xs font-medium text-slate-600 hover:text-[#0B5FD1] border border-slate-200 bg-white rounded-lg px-3 py-1.5">
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
