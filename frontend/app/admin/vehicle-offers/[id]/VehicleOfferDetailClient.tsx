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
  rejected: boolean;
  rejectedAt: string | null;
};

export type DetailInvitation = {
  id: string;
  dealershipName: string;
  dealerEmail: string;
  status: string;
  sentAt: string;
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
  requestStatus: string;
  submissions: DetailSubmission[];
  invitations: DetailInvitation[];
  latestReview: { reviewToken: string; buyerName: string; buyerEmail: string; sentAt: string } | null;
};

const INVITE_TONE: Record<string, string> = {
  sent: "bg-slate-100 text-slate-600",
  opened: "bg-blue-100 text-blue-700",
  submitted: "bg-green-100 text-green-700",
  expired: "bg-red-100 text-red-700",
};

type SelectedKey = string; // `${submissionId}::${vehicleIndex}`
const keyOf = (s: string, i: number): SelectedKey => `${s}::${i}`;

function parseVehicles(raw: unknown): DealerVehicle[] {
  if (!Array.isArray(raw)) return [];
  return raw as DealerVehicle[];
}

type DealerSearchResult = { id: string; dealershipName: string; city: string | null; state: string | null; tier: string };

function dollarsToCents(v: string): number {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function ManualOfferSection({ offerId }: { offerId: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"registered" | "outside">("registered");

  // Registered dealer search
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<DealerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState<DealerSearchResult | null>(null);

  // Outside dealer
  const [outsideName, setOutsideName] = useState("");
  const [outsideEmail, setOutsideEmail] = useState("");
  const [outsidePhone, setOutsidePhone] = useState("");

  // Common price fields (dollars)
  const [vehiclePrice, setVehiclePrice] = useState("");
  const [tax, setTax] = useState("");
  const [fees, setFees] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const otdCents = dollarsToCents(vehiclePrice) + dollarsToCents(tax) + dollarsToCents(fees);

  async function runSearch(q: string) {
    setSearch(q);
    setSelectedDealer(null);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/dealers/active?q=${encodeURIComponent(q.trim())}`);
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { dealers: DealerSearchResult[] } };
      setResults(data.success && data.data ? data.data.dealers.slice(0, 8) : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (otdCents <= 0) { setError("Enter a vehicle price (and any tax/fees)."); return; }
    if (!reason.trim()) { setError("A reason for the manual entry is required."); return; }

    const base = {
      vehiclePriceCents: dollarsToCents(vehiclePrice),
      taxCents: dollarsToCents(tax),
      feesCents: dollarsToCents(fees),
      otdPriceCents: otdCents,
      notes: notes.trim() || undefined,
      reason: reason.trim(),
    };

    let payload: Record<string, unknown>;
    if (tab === "registered") {
      if (!selectedDealer) { setError("Select a registered dealer first."); return; }
      payload = { dealerId: selectedDealer.id, ...base };
    } else {
      if (!outsideName.trim() || !/\S+@\S+\.\S+/.test(outsideEmail.trim())) {
        setError("Outside dealer name and a valid email are required."); return;
      }
      payload = {
        outsideDealerName: outsideName.trim(),
        outsideDealerEmail: outsideEmail.trim(),
        outsideDealerPhone: outsidePhone.trim() || undefined,
        ...base,
      };
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/vehicle-offers/${offerId}/submit-offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
      if (res.ok && data.success) {
        setSuccess(true);
        setTimeout(() => window.location.reload(), 900);
      } else {
        setError(data.error?.message ?? "Unable to submit offer.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 mb-4" data-testid="manual-offer-section">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
        data-testid="manual-offer-toggle"
      >
        <div>
          <p className="text-sm font-bold text-[#111827]">Submit Manual Offer</p>
          <p className="text-xs text-slate-500">Enter an offer on behalf of a registered or unregistered dealer</p>
        </div>
        <span className="text-[#0B5FD1] text-sm font-semibold">{open ? "Hide" : "Add Offer"}</span>
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="mt-4 border-t border-slate-100 pt-4">
          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            {(["registered", "outside"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${tab === t ? "bg-[#0B5FD1] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                data-testid={`manual-offer-tab-${t}`}
              >
                {t === "registered" ? "Registered Dealer" : "Outside Dealer"}
              </button>
            ))}
          </div>

          {tab === "registered" ? (
            <div className="mb-4">
              <Label className="text-xs font-medium text-[#374151]">Search dealer (name, city, or state)</Label>
              <Input
                value={search}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="Start typing a dealership name…"
                className="mt-1"
                data-testid="manual-offer-dealer-search"
              />
              {searching && <p className="text-xs text-slate-400 mt-1">Searching…</p>}
              {selectedDealer ? (
                <p className="text-xs text-green-700 mt-2" data-testid="manual-offer-dealer-selected">
                  Selected: <strong>{selectedDealer.dealershipName}</strong>
                  <button type="button" onClick={() => { setSelectedDealer(null); setSearch(""); }} className="ml-2 text-slate-400 hover:text-slate-600 underline">change</button>
                </p>
              ) : results.length > 0 ? (
                <div className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-auto">
                  {results.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => { setSelectedDealer(d); setResults([]); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      data-testid={`manual-offer-dealer-${d.id}`}
                    >
                      <span className="font-medium text-slate-900">{d.dealershipName}</span>
                      <span className="text-xs text-slate-400 ml-2">{[d.city, d.state].filter(Boolean).join(", ")} · {d.tier}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <Label className="text-xs font-medium text-[#374151]">Dealership Name</Label>
                <Input value={outsideName} onChange={(e) => setOutsideName(e.target.value)} className="mt-1" data-testid="manual-offer-outside-name" />
              </div>
              <div>
                <Label className="text-xs font-medium text-[#374151]">Contact Email</Label>
                <Input type="email" value={outsideEmail} onChange={(e) => setOutsideEmail(e.target.value)} className="mt-1" data-testid="manual-offer-outside-email" />
              </div>
              <div>
                <Label className="text-xs font-medium text-[#374151]">Contact Phone</Label>
                <Input value={outsidePhone} onChange={(e) => setOutsidePhone(e.target.value)} className="mt-1" data-testid="manual-offer-outside-phone" />
              </div>
            </div>
          )}

          {/* Common price fields */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs font-medium text-[#374151]">Vehicle Price ($)</Label>
              <Input type="number" min="0" step="0.01" value={vehiclePrice} onChange={(e) => setVehiclePrice(e.target.value)} className="mt-1" data-testid="manual-offer-vehicle-price" />
            </div>
            <div>
              <Label className="text-xs font-medium text-[#374151]">Tax ($)</Label>
              <Input type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} className="mt-1" data-testid="manual-offer-tax" />
            </div>
            <div>
              <Label className="text-xs font-medium text-[#374151]">Fees ($)</Label>
              <Input type="number" min="0" step="0.01" value={fees} onChange={(e) => setFees(e.target.value)} className="mt-1" data-testid="manual-offer-fees" />
            </div>
            <div>
              <Label className="text-xs font-medium text-[#374151]">OTD Total</Label>
              <Input value={`$${(otdCents / 100).toLocaleString()}`} readOnly className="mt-1 bg-slate-50 font-semibold" data-testid="manual-offer-otd" />
            </div>
          </div>

          <div className="mt-3">
            <Label className="text-xs font-medium text-[#374151]">Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 2000))} className="mt-1 min-h-[60px]" data-testid="manual-offer-notes" />
          </div>
          <div className="mt-3">
            <Label className="text-xs font-medium text-[#374151]">Reason for manual entry <span className="text-red-500">*</span></Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1" data-testid="manual-offer-reason" required />
          </div>

          {error && <p className="text-xs text-red-600 mt-2" data-testid="manual-offer-error">{error}</p>}
          {success && <p className="text-xs text-green-600 mt-2" data-testid="manual-offer-success">Offer submitted — refreshing…</p>}

          <Button type="submit" disabled={submitting || success} className="mt-3 bg-[#0B5FD1] text-white" data-testid="manual-offer-submit">
            {submitting ? <><Loader2 size={14} className="animate-spin mr-1.5" />Submitting…</> : "Submit Offer"}
          </Button>
        </form>
      )}
    </div>
  );
}

export default function VehicleOfferDetailClient({ offer: initialOffer, appUrl }: { offer: DetailOffer; appUrl: string }) {
  const [offer, setOffer] = useState(initialOffer);
  const [selected, setSelected] = useState<Set<SelectedKey>>(new Set());
  const [buyerName, setBuyerName] = useState(initialOffer.buyerName ?? "");
  const [buyerEmail, setBuyerEmail] = useState(initialOffer.buyerEmail ?? "");
  const [adminMessage, setAdminMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentResult, setSentResult] = useState<{ reviewUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);

  async function handleRejectSubmission(submissionId: string) {
    if (!confirm("Reject this dealer offer? The dealer will receive a notification.")) return;
    setRejecting(submissionId);
    try {
      const res = await fetch(`/api/admin/vehicle-offers/${offer.id}/reject-submission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId }),
      });
      if (res.ok) {
        setOffer((prev) => ({
          ...prev,
          submissions: prev.submissions.map((s) =>
            s.id === submissionId ? { ...s, rejected: true, rejectedAt: new Date().toISOString() } : s
          ),
        }));
        // Clear any selections of this submission
        setSelected((prev) => {
          const next = new Set(prev);
          for (const k of next) {
            if (k.startsWith(`${submissionId}::`)) next.delete(k);
          }
          return next;
        });
      }
    } finally {
      setRejecting(null);
    }
  }

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

      {/* Dealer invitations */}
      {offer.invitations.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 mb-4" data-testid="invitations-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
            Dealer Invitations ({offer.invitations.length})
          </p>
          <div className="space-y-2">
            {offer.invitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between text-sm" data-testid={`invitation-${inv.id}`}>
                <div className="min-w-0">
                  <span className="font-medium text-slate-900">{inv.dealershipName}</span>
                  <span className="text-slate-400 ml-2 text-xs">{inv.dealerEmail}</span>
                </div>
                <Badge className={INVITE_TONE[inv.status] ?? INVITE_TONE.sent}>{inv.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual offer entry (admin submits on behalf of a dealer) */}
      <ManualOfferSection offerId={offer.id} />

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
              <div
                key={s.id}
                className={`bg-white rounded-2xl border p-6 ${s.rejected ? "border-red-200 opacity-75" : "border-[#E5E7EB]"}`}
                data-testid={`submission-${s.id}`}
              >
                <div className="flex items-start justify-between mb-3 gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-[#111827]">{s.dealershipName}</p>
                      {s.rejected && <Badge className="bg-red-100 text-red-700 border-red-200">Rejected</Badge>}
                    </div>
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
                        {!s.rejected && (
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
                        )}
                      </div>
                    );
                  })}
                </div>

                {s.notes && <p className="text-xs text-slate-500 mt-3 bg-slate-50 rounded-lg p-3">Notes: {s.notes}</p>}

                <div className="mt-3 pt-3 border-t border-slate-100">
                  {!s.rejected ? (
                    <button
                      onClick={() => handleRejectSubmission(s.id)}
                      disabled={rejecting === s.id}
                      className="text-xs text-red-500 hover:text-red-700 hover:underline disabled:opacity-50"
                      data-testid={`reject-submission-${s.id}`}
                    >
                      {rejecting === s.id ? "Rejecting…" : "Reject this offer"}
                    </button>
                  ) : (
                    <p className="text-xs text-red-400">✗ Offer rejected{s.rejectedAt ? ` on ${new Date(s.rejectedAt).toLocaleDateString()}` : ""}</p>
                  )}
                </div>
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
