"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Plus, Send, Trash2 } from "lucide-react";

export type SerializedInvitation = {
  id: string;
  dealershipName: string;
  contactName: string | null;
  dealerEmail: string;
  dealerPhone: string | null;
  status: string;
  sentAt: string;
  expiresAt: string | null;
};

export type SerializedOffer = {
  id: string;
  token: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleTrim: string | null;
  vehicleCondition: string;
  vehicleMileage: number | null;
  vehicleVin: string | null;
  vehicleColor: string | null;
  vehicleInteriorColor: string | null;
  vehicleReferenceUrl: string | null;
  askingPriceCents: number | null;
  adminNotes: string | null;
  expiresAt: string | null;
  invitations: SerializedInvitation[];
};

const CONDITIONS = ["New", "Used", "Certified Pre-Owned"] as const;
const EXPIRY_PRESETS = [
  { label: "24 hours", hours: 24 },
  { label: "48 hours", hours: 48 },
  { label: "7 days", hours: 168 },
  { label: "14 days", hours: 336 },
  { label: "Never", hours: 0 },
];
const YEAR_OPTIONS = Array.from({ length: 2026 - 2010 + 1 }, (_, i) => 2010 + i);

type DealerInput = {
  dealershipName: string;
  dealerEmail: string;
  contactName: string;
  dealerPhone: string;
};

const emptyDealer = (): DealerInput => ({
  dealershipName: "",
  dealerEmail: "",
  contactName: "",
  dealerPhone: "",
});

const STATUS_TONE: Record<string, string> = {
  sent: "bg-slate-100 text-slate-600",
  opened: "bg-blue-100 text-blue-700",
  submitted: "bg-green-100 text-green-700",
  expired: "bg-red-100 text-red-700",
};

export default function SendToDealersClient({
  requestId,
  meta,
  offer: initialOffer,
  appUrl,
}: {
  requestId: string;
  meta: Record<string, unknown>;
  offer: SerializedOffer | null;
  appUrl: string;
}) {
  const [offer, setOffer] = useState<SerializedOffer | null>(initialOffer);
  const [creatingOffer, setCreatingOffer] = useState(false);
  const [savingError, setSavingError] = useState<string | null>(null);

  // Vehicle form (only shown when no offer exists)
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [condition, setCondition] = useState<string>("Used");
  const [mileage, setMileage] = useState("");
  const [vin, setVin] = useState("");
  const [color, setColor] = useState("");
  const [interiorColor, setInteriorColor] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [vehicleReferenceUrl, setVehicleReferenceUrl] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [expiryHours, setExpiryHours] = useState<number>(48);

  // Dealers
  const [dealers, setDealers] = useState<DealerInput[]>([emptyDealer()]);
  const [sharedNotes, setSharedNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const buyerMeta = meta as {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    city?: string;
    state?: string;
    zip?: string;
    budget?: string;
    timeline?: string;
    financingOption?: string;
    hasTradeIn?: boolean;
    preferredMake?: string;
    preferredModel?: string;
    customMakeModel?: string;
    minYear?: number;
    maxYear?: number;
    newOrUsed?: string;
    desiredMonthly?: string;
    downPaymentAvail?: string;
    interiorColor?: string;
    mustHaveFeatures?: string;
    openToAlternatives?: boolean;
    tradeYear?: string;
    tradeMake?: string;
    tradeModel?: string;
  };
  const buyerName = (buyerMeta.fullName ?? [buyerMeta.firstName, buyerMeta.lastName].filter(Boolean).join(" ")) || "Buyer";

  function addDealer() {
    setDealers((prev) => [...prev, emptyDealer()]);
  }
  function removeDealer(idx: number) {
    setDealers((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateDealer(idx: number, patch: Partial<DealerInput>) {
    setDealers((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  const validDealers = dealers.filter((d) => d.dealershipName.trim() && /\S+@\S+\.\S+/.test(d.dealerEmail.trim()));
  const canSend = !!offer && validDealers.length > 0 && !sending;

  async function handleSaveVehicle() {
    setSavingError(null);
    if (!make.trim() || !model.trim() || !vehicleReferenceUrl.trim()) {
      setSavingError("Year, make, model, and listing URL are required.");
      return;
    }
    setCreatingOffer(true);
    try {
      let computedExpiresAt: string | undefined;
      if (expiryHours > 0) {
        computedExpiresAt = new Date(Date.now() + expiryHours * 3_600_000).toISOString();
      }

      const res = await fetch("/api/admin/vehicle-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleYear: Number(year),
          vehicleMake: make.trim(),
          vehicleModel: model.trim(),
          vehicleTrim: trim.trim() || undefined,
          vehicleMileage: mileage ? Number(mileage) : undefined,
          vehicleVin: vin.trim() || undefined,
          vehicleColor: color.trim() || undefined,
          vehicleInteriorColor: interiorColor.trim() || undefined,
          vehicleCondition: condition,
          askingPriceCents: askingPrice ? Math.round(Number(askingPrice) * 100) : undefined,
          vehicleReferenceUrl: vehicleReferenceUrl.trim(),
          // Pull buyer details from request metadata
          buyerName,
          buyerEmail: buyerMeta.email,
          buyerPhone: buyerMeta.phone,
          buyerCity: buyerMeta.city,
          buyerState: buyerMeta.state,
          buyerZip: buyerMeta.zip ?? "",
          buyerBudget: buyerMeta.budget ?? "Not specified",
          buyerMonthlyPayment: buyerMeta.desiredMonthly,
          buyerDownPayment: buyerMeta.downPaymentAvail,
          buyerNewOrUsed: buyerMeta.newOrUsed ?? "Either",
          buyerFinancing:
            buyerMeta.financingOption === "need_financing" ? "Needs financing"
              : buyerMeta.financingOption === "have_financing" ? "Pre-approved"
              : buyerMeta.financingOption === "no_financing" ? "Cash"
              : "Not Sure",
          buyerTimeline: buyerMeta.timeline,
          buyerOpenToAlt: buyerMeta.openToAlternatives ?? false,
          buyerInteriorColor: buyerMeta.interiorColor,
          buyerMustHave: buyerMeta.mustHaveFeatures,
          buyerHasTradeIn: buyerMeta.hasTradeIn ?? false,
          buyerTradeYear: buyerMeta.tradeYear,
          buyerTradeMake: buyerMeta.tradeMake,
          buyerTradeModel: buyerMeta.tradeModel,
          adminNotes: adminNotes.trim() || sharedNotes.trim() || undefined,
          expiresAt: computedExpiresAt,
          referenceId: requestId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { id: string; token: string; expiresAt: string | null };
        error?: { message?: string };
      };
      if (!res.ok || !data.success || !data.data) {
        setSavingError(data.error?.message ?? "Unable to save vehicle details.");
        return;
      }
      setOffer({
        id: data.data.id,
        token: data.data.token,
        vehicleYear: Number(year),
        vehicleMake: make.trim(),
        vehicleModel: model.trim(),
        vehicleTrim: trim.trim() || null,
        vehicleCondition: condition,
        vehicleMileage: mileage ? Number(mileage) : null,
        vehicleVin: vin.trim() || null,
        vehicleColor: color.trim() || null,
        vehicleInteriorColor: interiorColor.trim() || null,
        vehicleReferenceUrl: vehicleReferenceUrl.trim(),
        askingPriceCents: askingPrice ? Math.round(Number(askingPrice) * 100) : null,
        adminNotes: adminNotes.trim() || null,
        expiresAt: data.data.expiresAt,
        invitations: [],
      });
    } catch {
      setSavingError("Network error. Please try again.");
    } finally {
      setCreatingOffer(false);
    }
  }

  async function handleSend() {
    if (!offer) return;
    setSendError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/admin/vehicle-requests/${requestId}/send-to-dealers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleOfferId: offer.id,
          dealers: validDealers,
          expiresAt: offer.expiresAt ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { invitations: SerializedInvitation[] };
        error?: { message?: string };
      };
      if (!res.ok || !data.success || !data.data) {
        setSendError(data.error?.message ?? "Unable to send invitations.");
        return;
      }
      setOffer({
        ...offer,
        invitations: [...data.data.invitations, ...offer.invitations],
      });
      setDealers([emptyDealer()]);
    } catch {
      setSendError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const genericOfferUrl = offer ? `${appUrl}/dealer-offer/${offer.token}` : "";
  const [copied, setCopied] = useState(false);
  function copyGenericLink() {
    if (!genericOfferUrl) return;
    void navigator.clipboard.writeText(genericOfferUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl pb-20" data-testid="send-to-dealers-page">
      <Link href={`/admin/vehicle-requests/${requestId}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#0B5FD1] mb-4">
        <ArrowLeft size={14} /> Back to Request
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Send to Dealers</h1>
        <p className="text-sm text-slate-500 mt-1">
          For {buyerName}{buyerMeta.city && buyerMeta.state ? ` · ${buyerMeta.city}, ${buyerMeta.state}` : ""}
          {buyerMeta.budget ? ` · ${buyerMeta.budget}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — Vehicle Offer Setup */}
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700 mb-4">
            {offer ? "Vehicle Offer" : "1. Set Up Vehicle Details"}
          </h2>

          {!offer ? (
            <>
              <p className="text-sm text-slate-500 mb-4">First, set up the vehicle details you found for this buyer.</p>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="mb-1.5 block">Year *</Label>
                    <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-full">
                      {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-1.5 block">Make *</Label>
                    <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" />
                  </div>
                  <div>
                    <Label className="mb-1.5 block">Model *</Label>
                    <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Camry" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block">Trim</Label>
                    <Input value={trim} onChange={(e) => setTrim(e.target.value)} placeholder="LE, XLE…" />
                  </div>
                  <div>
                    <Label className="mb-1.5 block">Condition *</Label>
                    <Select value={condition} onChange={(e) => setCondition(e.target.value)} className="w-full">
                      {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="mb-1.5 block">Mileage</Label>
                    <Input type="number" min={0} value={mileage} onChange={(e) => setMileage(e.target.value)} />
                  </div>
                  <div>
                    <Label className="mb-1.5 block">VIN</Label>
                    <Input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase().slice(0, 17))} maxLength={17} />
                  </div>
                  <div>
                    <Label className="mb-1.5 block">Color</Label>
                    <Input value={color} onChange={(e) => setColor(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block">Interior Color</Label>
                    <Input value={interiorColor} onChange={(e) => setInteriorColor(e.target.value)} placeholder="Black, Beige…" />
                  </div>
                  <div>
                    <Label className="mb-1.5 block">Asking / Market Price</Label>
                    <Input type="number" min={0} value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} placeholder="$" />
                  </div>
                </div>
                <div>
                  <Label className="mb-1.5 block">Vehicle Listing URL *</Label>
                  <Input type="url" value={vehicleReferenceUrl} onChange={(e) => setVehicleReferenceUrl(e.target.value)} placeholder="https://" />
                  <p className="text-xs text-slate-400 mt-1">The specific unit you found for this buyer.</p>
                </div>
                <div>
                  <Label className="mb-1.5 block">Notes for Dealers</Label>
                  <Textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value.slice(0, 1000))}
                    placeholder="e.g. Buyer is motivated and ready within 2 weeks. Clean CARFAX preferred."
                    rows={3}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block">Offer Expiration</Label>
                  <div className="grid grid-cols-5 gap-2">
                    {EXPIRY_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setExpiryHours(p.hours)}
                        className={`rounded-lg border-2 py-2 text-xs font-medium transition-colors ${
                          expiryHours === p.hours
                            ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {savingError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{savingError}</div>
                )}
                <Button onClick={handleSaveVehicle} disabled={creatingOffer} className="w-full h-11" data-testid="save-vehicle-btn">
                  {creatingOffer ? <><Loader2 size={14} className="animate-spin mr-2" />Saving…</> : "Save Vehicle Details →"}
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-400">Vehicle</p>
                <p className="font-bold text-slate-900">
                  {offer.vehicleYear} {offer.vehicleMake} {offer.vehicleModel}{offer.vehicleTrim ? ` ${offer.vehicleTrim}` : ""}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Condition</p>
                  <p className="font-medium text-slate-700">{offer.vehicleCondition}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Mileage</p>
                  <p className="font-medium text-slate-700">{offer.vehicleMileage ? `${offer.vehicleMileage.toLocaleString()} mi` : "—"}</p>
                </div>
                {offer.vehicleColor && (
                  <div>
                    <p className="text-xs text-slate-400">Exterior</p>
                    <p className="font-medium text-slate-700">{offer.vehicleColor}</p>
                  </div>
                )}
                {offer.vehicleInteriorColor && (
                  <div>
                    <p className="text-xs text-slate-400">Interior</p>
                    <p className="font-medium text-slate-700">{offer.vehicleInteriorColor}</p>
                  </div>
                )}
                {offer.askingPriceCents && (
                  <div>
                    <p className="text-xs text-slate-400">Market Price</p>
                    <p className="font-medium text-slate-700">${(offer.askingPriceCents / 100).toLocaleString()}</p>
                  </div>
                )}
                {offer.expiresAt && (
                  <div>
                    <p className="text-xs text-slate-400">Deadline</p>
                    <p className="font-medium text-slate-700">{new Date(offer.expiresAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
              {offer.vehicleReferenceUrl && (
                <a
                  href={offer.vehicleReferenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-[#0B5FD1] hover:underline"
                >
                  View listing →
                </a>
              )}
              {offer.adminNotes && (
                <div className="bg-slate-50 rounded-lg p-3 mt-3">
                  <p className="text-xs text-slate-500 mb-1">Notes for dealers</p>
                  <p className="text-sm text-slate-700">{offer.adminNotes}</p>
                </div>
              )}

              <div className="bg-slate-50 rounded-xl p-4 mt-4">
                <p className="text-xs text-slate-500 mb-2">Or copy a generic link to share manually:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs text-[#0B5FD1] font-mono truncate bg-white border border-slate-200 rounded px-2 py-1.5">{genericOfferUrl}</code>
                  <button onClick={copyGenericLink} className="text-xs text-slate-600 hover:text-[#0B5FD1] border border-slate-200 bg-white rounded px-3 py-1.5">
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Dealer Invitations */}
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700 mb-4">
            {offer ? "2. Invite Dealers" : "Dealers"}
          </h2>

          {!offer && (
            <p className="text-sm text-slate-400 italic mb-4">Save the vehicle details first, then invite dealers.</p>
          )}

          <div className={offer ? "" : "opacity-50 pointer-events-none"}>
            <div className="space-y-2">
              {dealers.map((d, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 bg-slate-50 rounded-xl p-3" data-testid={`dealer-row-${i}`}>
                  <Input
                    value={d.dealershipName}
                    onChange={(e) => updateDealer(i, { dealershipName: e.target.value.slice(0, 150) })}
                    placeholder="Dealership Name *"
                    data-testid={`dealer-${i}-name`}
                  />
                  <Input
                    type="email"
                    value={d.dealerEmail}
                    onChange={(e) => updateDealer(i, { dealerEmail: e.target.value })}
                    placeholder="Email *"
                    data-testid={`dealer-${i}-email`}
                  />
                  <Input
                    value={d.contactName}
                    onChange={(e) => updateDealer(i, { contactName: e.target.value.slice(0, 100) })}
                    placeholder="Contact Name (optional)"
                    data-testid={`dealer-${i}-contact`}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      value={d.dealerPhone}
                      onChange={(e) => updateDealer(i, { dealerPhone: e.target.value })}
                      placeholder="Phone (optional)"
                      data-testid={`dealer-${i}-phone`}
                      className="flex-1"
                    />
                    {dealers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDealer(i)}
                        className="text-red-400 hover:text-red-600 p-2"
                        aria-label="Remove dealer"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addDealer}
              disabled={dealers.length >= 20}
              className="w-full mt-3 rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm text-slate-500 hover:border-[#0B5FD1] hover:text-[#0B5FD1] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              data-testid="add-dealer-btn"
            >
              <Plus size={14} /> Add Another Dealer
            </button>

            <div className="mt-4">
              <Label className="mb-1.5 block">Notes to All Dealers (optional)</Label>
              <Textarea
                rows={3}
                value={sharedNotes}
                onChange={(e) => setSharedNotes(e.target.value.slice(0, 1000))}
                placeholder="e.g. Buyer is motivated. Clean CARFAX preferred. Open to dealer financing if rate is competitive."
              />
              <p className="text-xs text-slate-400 mt-1">If you saved the vehicle without notes, these will be used.</p>
            </div>

            {sendError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mt-3">{sendError}</div>
            )}

            <Button onClick={handleSend} disabled={!canSend} className="w-full h-12 mt-4" data-testid="send-invitations-btn">
              {sending
                ? <><Loader2 size={16} className="animate-spin mr-2" />Sending Invitations…</>
                : <><Send size={14} className="mr-2" />Send Invitations to {validDealers.length} Dealer{validDealers.length !== 1 ? "s" : ""}</>}
            </Button>
          </div>

          {offer && offer.invitations.length > 0 && (
            <div className="mt-6 pt-5 border-t border-slate-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-700 mb-3">Invitation Status</p>
              <div className="space-y-2">
                {offer.invitations.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3" data-testid={`invitation-${inv.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">{inv.dealershipName}</p>
                      <p className="text-xs text-slate-400 truncate">{inv.dealerEmail}</p>
                    </div>
                    <Badge className={STATUS_TONE[inv.status] ?? "bg-slate-100 text-slate-600"}>{inv.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
