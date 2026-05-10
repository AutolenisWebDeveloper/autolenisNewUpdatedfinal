"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Clock, ExternalLink, Loader2, X } from "lucide-react";

export type DealerOfferData = {
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
  adminNotes: string | null;
};

const CONDITIONS = ["New", "Used", "Certified Pre-Owned"] as const;
const AVAILABILITY = ["In Stock Now", "Within 3 Days", "Within 1 Week", "Within 2 Weeks"] as const;

type DealerVehicle = {
  vehicleUrl: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  mileage: string;
  color: string;
  condition: string;
  offerPrice: string;
  tradeInAccepted: boolean;
  financingAvailable: boolean;
  warrantyIncluded: boolean;
  warrantyDetails: string;
  availability: string;
};

const emptyVehicle = (): DealerVehicle => ({
  vehicleUrl: "",
  year: "",
  make: "",
  model: "",
  trim: "",
  mileage: "",
  color: "",
  condition: "Used",
  offerPrice: "",
  tradeInAccepted: false,
  financingAvailable: false,
  warrantyIncluded: false,
  warrantyDetails: "",
  availability: "In Stock Now",
});

function ToggleYesNo({
  value,
  onChange,
  testId,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  const cls = (active: boolean) =>
    `flex-1 rounded-xl border-2 px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
    }`;
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onChange(true)} className={cls(value)} data-testid={`${testId}-yes`}>Yes</button>
      <button type="button" onClick={() => onChange(false)} className={cls(!value)} data-testid={`${testId}-no`}>No</button>
    </div>
  );
}

export default function DealerOfferFormClient({ offer, isExpired }: { offer: DealerOfferData; isExpired: boolean }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dealershipName, setDealershipName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [vehicles, setVehicles] = useState<DealerVehicle[]>([emptyVehicle()]);
  const [notes, setNotes] = useState("");
  const [finderFeeAgreed, setFinderFeeAgreed] = useState(false);
  const [confirmedAccuracy, setConfirmedAccuracy] = useState(false);

  if (isExpired) {
    return (
      <main className="min-h-screen bg-[#F8F9FB] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-10 max-w-md w-full text-center">
          <div className="w-14 h-14 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Clock size={26} className="text-amber-600" />
          </div>
          <h2 className="font-bold text-[#111827] text-xl mb-2">This Link Has Expired</h2>
          <p className="text-[#4B5563] text-sm">This vehicle offer link is no longer accepting submissions. Please contact AutoLenis if you believe this is an error.</p>
          <a href="/contact" className="inline-block mt-6 text-[#0B5FD1] text-sm font-medium hover:underline">Contact AutoLenis →</a>
        </div>
      </main>
    );
  }

  const updateVehicle = (idx: number, patch: Partial<DealerVehicle>) => {
    setVehicles((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };
  const addVehicle = () => {
    if (vehicles.length >= 3) return;
    setVehicles((prev) => [...prev, emptyVehicle()]);
  };
  const removeVehicle = (idx: number) => {
    setVehicles((prev) => prev.filter((_, i) => i !== idx));
  };

  const isVehicleValid = (v: DealerVehicle) =>
    /^https?:\/\//i.test(v.vehicleUrl) &&
    Number(v.year) >= 2000 && Number(v.year) <= 2030 &&
    v.make.trim() && v.model.trim() &&
    v.condition && v.availability &&
    Number(v.offerPrice) > 0;

  const canSubmit =
    !submitting &&
    dealershipName.trim() &&
    contactName.trim() &&
    /\S+@\S+\.\S+/.test(contactEmail) &&
    contactPhone.trim().length >= 7 &&
    vehicles.length > 0 &&
    vehicles.every(isVehicleValid) &&
    finderFeeAgreed &&
    confirmedAccuracy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        dealershipName: dealershipName.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        vehicles: vehicles.map((v) => ({
          vehicleUrl: v.vehicleUrl.trim(),
          year: Number(v.year),
          make: v.make.trim(),
          model: v.model.trim(),
          trim: v.trim.trim() || undefined,
          mileage: v.mileage ? Number(v.mileage) : undefined,
          color: v.color.trim() || undefined,
          condition: v.condition,
          offerPriceCents: Math.round(Number(v.offerPrice) * 100),
          tradeInAccepted: v.tradeInAccepted,
          financingAvailable: v.financingAvailable,
          warrantyIncluded: v.warrantyIncluded,
          warrantyDetails: v.warrantyIncluded ? (v.warrantyDetails.trim() || undefined) : undefined,
          availability: v.availability,
        })),
        notes: notes.trim() || undefined,
        finderFeeAgreed: true as const,
        confirmedAccuracy: true as const,
      };
      const res = await fetch(`/api/public/dealer-offer/${offer.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { code?: string; message?: string } };
      if (res.ok && data.success) {
        router.push(`/dealer-offer/${offer.token}/confirmed`);
      } else {
        setError(data.error?.message ?? "Unable to submit your offer. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const vehicleLabel = `${offer.vehicleYear} ${offer.vehicleMake} ${offer.vehicleModel}${offer.vehicleTrim ? ` ${offer.vehicleTrim}` : ""}`;

  return (
    <main className="min-h-screen bg-[#F8F9FB]" data-testid="dealer-offer-page">
      <header className="bg-white border-b border-[#E5E7EB] px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <span className="text-sm font-bold text-[#0B5FD1] tracking-tight">AutoLenis</span>
          <span className="text-sm text-slate-400">|</span>
          <span className="text-sm font-medium text-slate-600">Dealer Offer Submission</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Vehicle reference card */}
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6" data-testid="dealer-offer-reference-card">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-3 font-semibold">Vehicle Being Requested</p>
          <h2 className="text-xl font-bold text-[#111827] mb-1">
            {offer.vehicleYear} {offer.vehicleMake} {offer.vehicleModel}
            {offer.vehicleTrim && <span className="text-slate-400 font-normal"> {offer.vehicleTrim}</span>}
          </h2>
          <div className="flex flex-wrap gap-2 mt-2 mb-4">
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
              data-testid="dealer-offer-reference-link"
              className="inline-flex items-center gap-2 bg-[#0B5FD1] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#0944a8] transition-colors mb-4"
            >
              <ExternalLink size={14} /> View the Referenced Vehicle →
            </a>
          )}

          <div className="border-t border-slate-100 pt-4 mt-2 grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-slate-400 mb-0.5">Buyer Budget</p><p className="font-medium text-slate-700">{offer.buyerBudget}</p></div>
            <div><p className="text-xs text-slate-400 mb-0.5">Buyer ZIP</p><p className="font-medium text-slate-700">{offer.buyerZip}</p></div>
            <div><p className="text-xs text-slate-400 mb-0.5">Preference</p><p className="font-medium text-slate-700">{offer.buyerNewOrUsed}</p></div>
            <div><p className="text-xs text-slate-400 mb-0.5">Financing</p><p className="font-medium text-slate-700">{offer.buyerFinancing}</p></div>
          </div>
          {offer.adminNotes && (
            <div className="bg-[#0B5FD1]/5 border border-[#0B5FD1]/20 rounded-lg p-3 mt-4">
              <p className="text-xs font-semibold text-[#0B5FD1] mb-1">Notes from AutoLenis:</p>
              <p className="text-sm text-slate-700">{offer.adminNotes}</p>
            </div>
          )}
        </div>

        {/* Finder fee disclosure */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5" data-testid="dealer-offer-disclaimer">
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2L2 16h16L10 2z" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 8v4M10 13.5v.5" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-800 mb-1">AutoLenis Broker Disclosure</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                AutoLenis is a licensed car-buying concierge and broker. By submitting an offer through this platform,
                your dealership agrees to pay AutoLenis a finder&rsquo;s fee upon successful completion of a sale to any buyer
                introduced through AutoLenis. The finder&rsquo;s fee terms will be confirmed in writing before any deal is finalized.
                Submitting this form constitutes acknowledgment of this arrangement.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} data-testid="dealer-offer-form" className="space-y-6">
          {/* Dealer contact */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
            <h3 className="text-sm font-bold text-[#111827] mb-4 uppercase tracking-wider text-[11px]">Dealer Contact</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="do-dealership" className="text-sm font-medium text-[#374151]">Dealership Name *</Label>
                <Input id="do-dealership" data-testid="do-dealership" className="mt-1.5" value={dealershipName} onChange={(e) => setDealershipName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="do-contact-name" className="text-sm font-medium text-[#374151]">Your Name *</Label>
                <Input id="do-contact-name" data-testid="do-contact-name" className="mt-1.5" value={contactName} onChange={(e) => setContactName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="do-email" className="text-sm font-medium text-[#374151]">Email *</Label>
                <Input id="do-email" type="email" data-testid="do-email" className="mt-1.5" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="do-phone" className="text-sm font-medium text-[#374151]">Phone *</Label>
                <Input id="do-phone" type="tel" data-testid="do-phone" className="mt-1.5" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} required />
              </div>
            </div>
          </div>

          {/* Vehicles */}
          {vehicles.map((v, idx) => (
            <div key={idx} className="bg-white rounded-2xl border border-[#E5E7EB] p-6" data-testid={`vehicle-${idx}-card`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wider text-[11px]">Vehicle Offer {idx + 1}</h3>
                {vehicles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeVehicle(idx)}
                    className="text-xs text-slate-400 hover:text-red-600 inline-flex items-center gap-1"
                    data-testid={`vehicle-${idx}-remove`}
                  >
                    <X size={14} /> Remove
                  </button>
                )}
              </div>

              <div>
                <Label htmlFor={`v-${idx}-url`} className="text-sm font-medium text-[#374151]">Vehicle Listing URL *</Label>
                <Input id={`v-${idx}-url`} type="url" data-testid={`vehicle-${idx}-url`} className="mt-1.5" placeholder="https://..." value={v.vehicleUrl} onChange={(e) => updateVehicle(idx, { vehicleUrl: e.target.value })} required />
                <p className="text-xs text-slate-400 mt-1">Paste the link to this exact vehicle on your website or listing platform. The buyer will use this to view it.</p>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-4">
                <div>
                  <Label htmlFor={`v-${idx}-year`} className="text-sm font-medium text-[#374151]">Year *</Label>
                  <Input id={`v-${idx}-year`} type="number" min={2000} max={2030} data-testid={`vehicle-${idx}-year`} className="mt-1.5" value={v.year} onChange={(e) => updateVehicle(idx, { year: e.target.value })} required />
                </div>
                <div>
                  <Label htmlFor={`v-${idx}-make`} className="text-sm font-medium text-[#374151]">Make *</Label>
                  <Input id={`v-${idx}-make`} data-testid={`vehicle-${idx}-make`} className="mt-1.5" value={v.make} onChange={(e) => updateVehicle(idx, { make: e.target.value })} required />
                </div>
                <div>
                  <Label htmlFor={`v-${idx}-model`} className="text-sm font-medium text-[#374151]">Model *</Label>
                  <Input id={`v-${idx}-model`} data-testid={`vehicle-${idx}-model`} className="mt-1.5" value={v.model} onChange={(e) => updateVehicle(idx, { model: e.target.value })} required />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <div>
                  <Label htmlFor={`v-${idx}-trim`} className="text-sm font-medium text-[#374151]">Trim</Label>
                  <Input id={`v-${idx}-trim`} data-testid={`vehicle-${idx}-trim`} className="mt-1.5" value={v.trim} onChange={(e) => updateVehicle(idx, { trim: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`v-${idx}-condition`} className="text-sm font-medium text-[#374151]">Condition *</Label>
                  <Select id={`v-${idx}-condition`} data-testid={`vehicle-${idx}-condition`} className="mt-1.5" value={v.condition} onChange={(e) => updateVehicle(idx, { condition: e.target.value })} required>
                    {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <div>
                  <Label htmlFor={`v-${idx}-mileage`} className="text-sm font-medium text-[#374151]">Mileage</Label>
                  <Input id={`v-${idx}-mileage`} type="number" min={0} data-testid={`vehicle-${idx}-mileage`} className="mt-1.5" value={v.mileage} onChange={(e) => updateVehicle(idx, { mileage: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`v-${idx}-color`} className="text-sm font-medium text-[#374151]">Color</Label>
                  <Input id={`v-${idx}-color`} data-testid={`vehicle-${idx}-color`} className="mt-1.5" value={v.color} onChange={(e) => updateVehicle(idx, { color: e.target.value })} />
                </div>
              </div>

              <div className="mt-4">
                <Label htmlFor={`v-${idx}-price`} className="text-sm font-medium text-[#374151]">Out-the-Door Price * (full price, all fees included)</Label>
                <Input id={`v-${idx}-price`} type="number" min={0} step="0.01" data-testid={`vehicle-${idx}-price`} className="mt-1.5" placeholder="$" value={v.offerPrice} onChange={(e) => updateVehicle(idx, { offerPrice: e.target.value })} required />
              </div>

              <div className="grid grid-cols-1 gap-4 mt-5">
                <div>
                  <Label className="text-sm font-medium text-[#374151] mb-1.5 block">Trade-In Accepted?</Label>
                  <ToggleYesNo value={v.tradeInAccepted} onChange={(b) => updateVehicle(idx, { tradeInAccepted: b })} testId={`vehicle-${idx}-tradein`} />
                </div>
                <div>
                  <Label className="text-sm font-medium text-[#374151] mb-1.5 block">Financing Available?</Label>
                  <ToggleYesNo value={v.financingAvailable} onChange={(b) => updateVehicle(idx, { financingAvailable: b })} testId={`vehicle-${idx}-financing`} />
                </div>
                <div>
                  <Label className="text-sm font-medium text-[#374151] mb-1.5 block">Warranty Included?</Label>
                  <ToggleYesNo value={v.warrantyIncluded} onChange={(b) => updateVehicle(idx, { warrantyIncluded: b })} testId={`vehicle-${idx}-warranty`} />
                  {v.warrantyIncluded && (
                    <Textarea
                      data-testid={`vehicle-${idx}-warranty-details`}
                      className="mt-2 min-h-[60px]"
                      placeholder="Warranty details (term, coverage, etc.)"
                      value={v.warrantyDetails}
                      onChange={(e) => updateVehicle(idx, { warrantyDetails: e.target.value.slice(0, 500) })}
                      maxLength={500}
                    />
                  )}
                </div>
              </div>

              <div className="mt-4">
                <Label htmlFor={`v-${idx}-availability`} className="text-sm font-medium text-[#374151]">Vehicle Availability *</Label>
                <Select id={`v-${idx}-availability`} data-testid={`vehicle-${idx}-availability`} className="mt-1.5" value={v.availability} onChange={(e) => updateVehicle(idx, { availability: e.target.value })} required>
                  {AVAILABILITY.map((a) => <option key={a} value={a}>{a}</option>)}
                </Select>
              </div>
            </div>
          ))}

          {vehicles.length < 3 && (
            <button
              type="button"
              onClick={addVehicle}
              data-testid="add-vehicle-btn"
              className="w-full rounded-xl border-2 border-dashed border-slate-200 py-4 text-sm font-medium text-slate-500 hover:border-[#0B5FD1] hover:text-[#0B5FD1] transition-colors"
            >
              + Add Another Vehicle Offer ({vehicles.length}/3)
            </button>
          )}

          {/* Notes */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
            <Label htmlFor="do-notes" className="text-sm font-medium text-[#374151]">General Notes (optional)</Label>
            <Textarea id="do-notes" data-testid="do-notes" className="mt-1.5 min-h-[80px]" placeholder="Any additional context about your dealership or these offers." value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 1000))} maxLength={1000} />
          </div>

          {/* Consent */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6 space-y-3">
            <label className="flex items-start gap-2 cursor-pointer select-none" data-testid="dealer-offer-finder-fee-checkbox-label">
              <input
                type="checkbox"
                checked={finderFeeAgreed}
                onChange={(e) => setFinderFeeAgreed(e.target.checked)}
                required
                data-testid="dealer-offer-finder-fee-checkbox"
                className="h-4 w-4 mt-0.5 rounded border-slate-300 accent-[#0B5FD1]"
              />
              <span className="text-xs text-slate-600 leading-relaxed">
                I acknowledge that AutoLenis is a car-buying concierge and broker, and I agree that my dealership will pay AutoLenis a <strong>finder&rsquo;s fee</strong> upon successful completion of any sale to a buyer introduced through this platform.
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer select-none" data-testid="dealer-offer-accuracy-checkbox-label">
              <input
                type="checkbox"
                checked={confirmedAccuracy}
                onChange={(e) => setConfirmedAccuracy(e.target.checked)}
                required
                data-testid="dealer-offer-accuracy-checkbox"
                className="h-4 w-4 mt-0.5 rounded border-slate-300 accent-[#0B5FD1]"
              />
              <span className="text-xs text-slate-600 leading-relaxed">
                I confirm these vehicle offers are accurate and I am authorized to submit them on behalf of my dealership.
              </span>
            </label>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3" data-testid="dealer-offer-error">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={!canSubmit} data-testid="dealer-offer-submit">
            {submitting ? <><Loader2 size={16} className="animate-spin mr-2" />Submitting…</> : `Submit My Offer${vehicles.length > 1 ? "s" : ""} for ${vehicleLabel}`}
          </Button>
        </form>
      </div>
    </main>
  );
}
