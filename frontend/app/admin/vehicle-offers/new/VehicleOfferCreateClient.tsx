"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

const BUDGET_OPTIONS = [
  "Under $15,000",
  "$15,000–$25,000",
  "$25,000–$35,000",
  "$35,000–$50,000",
  "$50,000–$75,000",
  "$75,000+",
];

const CONDITION_OPTIONS = ["New", "Used", "Certified Pre-Owned"] as const;
const NEW_OR_USED = ["New", "Used", "Either"] as const;
const FINANCING = ["Yes", "No", "Not Sure"] as const;
const YEAR_OPTIONS = Array.from({ length: 2026 - 2010 + 1 }, (_, i) => 2010 + i);

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function VehicleOfferCreateClient() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; url: string; expiresAt: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  // Vehicle details
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [condition, setCondition] = useState<string>("Used");
  const [mileage, setMileage] = useState("");
  const [vin, setVin] = useState("");
  const [color, setColor] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [vehicleReferenceUrl, setVehicleReferenceUrl] = useState("");

  // Buyer context
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerBudget, setBuyerBudget] = useState("");
  const [buyerZip, setBuyerZip] = useState("");
  const [buyerNewOrUsed, setBuyerNewOrUsed] = useState<string>("Either");
  const [buyerFinancing, setBuyerFinancing] = useState<string>("Not Sure");
  const [adminNotes, setAdminNotes] = useState("");

  // Offer settings
  const [expiresAt, setExpiresAt] = useState("");
  const [referenceId, setReferenceId] = useState("");

  const canSubmit =
    !loading &&
    Number(year) >= 2010 && Number(year) <= 2026 &&
    make.trim() && model.trim() &&
    condition && buyerBudget &&
    /^\d{5}$/.test(buyerZip) &&
    buyerNewOrUsed && buyerFinancing;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
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
          vehicleCondition: condition,
          askingPriceCents: askingPrice ? Math.round(Number(askingPrice) * 100) : undefined,
          vehicleReferenceUrl: vehicleReferenceUrl.trim() || undefined,
          buyerName: buyerName.trim() || undefined,
          buyerEmail: buyerEmail.trim() || undefined,
          buyerBudget,
          buyerZip,
          buyerNewOrUsed,
          buyerFinancing,
          adminNotes: adminNotes.trim() || undefined,
          expiresAt: expiresAt || undefined,
          referenceId: referenceId.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { id: string; url: string; expiresAt: string | null };
        error?: { message?: string };
      };
      if (res.ok && data.success && data.data) {
        setResult(data.data);
      } else {
        setError(data.error?.message ?? "Unable to create offer link.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!result) return;
    void navigator.clipboard.writeText(result.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleReset() {
    setResult(null);
    setError(null);
    setCopied(false);
    setMake(""); setModel(""); setTrim(""); setMileage("");
    setVin(""); setColor(""); setAskingPrice(""); setVehicleReferenceUrl("");
    setBuyerName(""); setBuyerEmail(""); setBuyerBudget("");
    setBuyerZip(""); setAdminNotes("");
    setExpiresAt(""); setReferenceId("");
  }

  if (result) {
    return (
      <div className="p-6 md:p-8 max-w-3xl">
        <div
          className="rounded-2xl border-2 border-[#0B5FD1] bg-white p-8 text-center"
          data-testid="offer-link-result"
        >
          <div className="w-14 h-14 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={26} className="text-[#059669]" />
          </div>
          <h3 className="font-bold text-[#111827] text-xl mb-2">Offer Link Created</h3>
          <p className="text-sm text-slate-500 mb-5">
            Share this link with any dealer — multiple dealers can submit competing offers.
          </p>

          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-5">
            <code
              className="flex-1 text-sm text-[#0B5FD1] font-mono text-left truncate"
              data-testid="offer-link-url"
            >
              {result.url}
            </code>
            <button
              onClick={handleCopy}
              data-testid="copy-offer-link"
              className="shrink-0 text-xs font-medium text-slate-600 hover:text-[#0B5FD1] border border-slate-200 rounded-lg px-3 py-1.5"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {result.expiresAt && (
            <p className="text-xs text-slate-400 mb-5">
              Expires: {new Date(result.expiresAt).toLocaleDateString()}
            </p>
          )}

          <div className="flex gap-3 justify-center flex-wrap">
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="open-offer-link"
              className="inline-flex items-center gap-2 border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink size={14} /> Open Link
            </a>
            <a
              href={`/admin/vehicle-offers/${result.id}`}
              data-testid="view-submissions-link"
              className="inline-flex items-center gap-2 bg-[#0B5FD1] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#0944a8]"
            >
              View Submissions →
            </a>
            <button
              onClick={handleReset}
              data-testid="create-another-btn"
              className="inline-flex items-center gap-2 border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Create Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="vehicle-offer-create-page">
      <h1 className="text-xl font-bold text-slate-900 mb-2">Create Dealer Offer Link</h1>
      <p className="text-sm text-slate-500 mb-8">
        Fill in the vehicle details, then copy the generated link to share with dealers.
        Multiple dealers can submit competing offers on the same link.
      </p>

      <form onSubmit={handleSubmit} data-testid="vehicle-offer-form" className="space-y-6">
        {/* Section 1 — Vehicle */}
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
          <h2 className="text-sm font-bold text-[#111827] mb-4 uppercase tracking-wider text-[11px]">Vehicle Details</h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="vo-year" className="text-sm font-medium text-[#374151]">Year *</Label>
              <Select id="vo-year" data-testid="vo-year" className="mt-1.5" value={year} onChange={(e) => setYear(e.target.value)} required>
                {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="vo-make" className="text-sm font-medium text-[#374151]">Make *</Label>
              <Input id="vo-make" data-testid="vo-make" className="mt-1.5" value={make} onChange={(e) => setMake(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="vo-model" className="text-sm font-medium text-[#374151]">Model *</Label>
              <Input id="vo-model" data-testid="vo-model" className="mt-1.5" value={model} onChange={(e) => setModel(e.target.value)} required />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <Label htmlFor="vo-trim" className="text-sm font-medium text-[#374151]">Trim (optional)</Label>
              <Input id="vo-trim" data-testid="vo-trim" className="mt-1.5" value={trim} onChange={(e) => setTrim(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="vo-condition" className="text-sm font-medium text-[#374151]">Condition *</Label>
              <Select id="vo-condition" data-testid="vo-condition" className="mt-1.5" value={condition} onChange={(e) => setCondition(e.target.value)} required>
                {CONDITION_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div>
              <Label htmlFor="vo-mileage" className="text-sm font-medium text-[#374151]">Mileage</Label>
              <Input id="vo-mileage" type="number" min={0} data-testid="vo-mileage" className="mt-1.5" value={mileage} onChange={(e) => setMileage(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="vo-vin" className="text-sm font-medium text-[#374151]">VIN (optional)</Label>
              <Input id="vo-vin" data-testid="vo-vin" maxLength={17} className="mt-1.5" value={vin} onChange={(e) => setVin(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="vo-color" className="text-sm font-medium text-[#374151]">Color (optional)</Label>
              <Input id="vo-color" data-testid="vo-color" className="mt-1.5" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <Label htmlFor="vo-asking" className="text-sm font-medium text-[#374151]">Market / Asking Price</Label>
              <Input id="vo-asking" type="number" min={0} data-testid="vo-asking" className="mt-1.5" placeholder="$" value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">Context for dealers on expected range.</p>
            </div>
            <div>
              <Label htmlFor="vo-ref-url" className="text-sm font-medium text-[#374151]">Vehicle Listing URL</Label>
              <Input id="vo-ref-url" type="url" data-testid="vo-ref-url" className="mt-1.5" placeholder="https://" value={vehicleReferenceUrl} onChange={(e) => setVehicleReferenceUrl(e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">Paste the link to the specific vehicle. Dealers will see this so they know exactly which vehicle the buyer is referring to.</p>
            </div>
          </div>
        </div>

        {/* Section 2 — Buyer */}
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
          <h2 className="text-sm font-bold text-[#111827] mb-4 uppercase tracking-wider text-[11px]">Buyer Context</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="vo-buyer-name" className="text-sm font-medium text-[#374151]">Buyer Name</Label>
              <Input id="vo-buyer-name" data-testid="vo-buyer-name" className="mt-1.5" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">Needed later to send review to buyer.</p>
            </div>
            <div>
              <Label htmlFor="vo-buyer-email" className="text-sm font-medium text-[#374151]">Buyer Email</Label>
              <Input id="vo-buyer-email" type="email" data-testid="vo-buyer-email" className="mt-1.5" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">Needed later to send review to buyer.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <Label htmlFor="vo-budget" className="text-sm font-medium text-[#374151]">Budget Range *</Label>
              <Select id="vo-budget" data-testid="vo-budget" className="mt-1.5" value={buyerBudget} onChange={(e) => setBuyerBudget(e.target.value)} required>
                <option value="">Select budget</option>
                {BUDGET_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="vo-buyer-zip" className="text-sm font-medium text-[#374151]">Buyer ZIP *</Label>
              <Input id="vo-buyer-zip" data-testid="vo-buyer-zip" className="mt-1.5" value={buyerZip} onChange={(e) => setBuyerZip(e.target.value.replace(/\D/g, "").slice(0, 5))} required />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <Label htmlFor="vo-buyer-condition" className="text-sm font-medium text-[#374151]">New or Used Preference *</Label>
              <Select id="vo-buyer-condition" data-testid="vo-buyer-condition" className="mt-1.5" value={buyerNewOrUsed} onChange={(e) => setBuyerNewOrUsed(e.target.value)} required>
                {NEW_OR_USED.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="vo-buyer-financing" className="text-sm font-medium text-[#374151]">Financing Needed *</Label>
              <Select id="vo-buyer-financing" data-testid="vo-buyer-financing" className="mt-1.5" value={buyerFinancing} onChange={(e) => setBuyerFinancing(e.target.value)} required>
                {FINANCING.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </div>
          </div>

          <div className="mt-4">
            <Label htmlFor="vo-admin-notes" className="text-sm font-medium text-[#374151]">Notes for Dealer (optional)</Label>
            <Textarea id="vo-admin-notes" data-testid="vo-admin-notes" className="mt-1.5 min-h-[100px]" value={adminNotes} onChange={(e) => setAdminNotes(e.target.value.slice(0, 1000))} maxLength={1000} />
            <p className="text-xs text-slate-400 mt-1">This message is shown to dealers on the offer page.</p>
          </div>
        </div>

        {/* Section 3 — Offer settings */}
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
          <h2 className="text-sm font-bold text-[#111827] mb-4 uppercase tracking-wider text-[11px]">Offer Settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="vo-expires" className="text-sm font-medium text-[#374151]">Expiration Date (optional)</Label>
              <Input id="vo-expires" type="date" min={todayISO()} data-testid="vo-expires" className="mt-1.5" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">Leave blank for no expiration.</p>
            </div>
            <div>
              <Label htmlFor="vo-ref-id" className="text-sm font-medium text-[#374151]">Internal Reference ID (optional)</Label>
              <Input id="vo-ref-id" data-testid="vo-ref-id" className="mt-1.5" placeholder="REQ-001" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">Your own tracking code. Not shown to dealers.</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3" data-testid="vehicle-offer-error">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={!canSubmit} data-testid="vehicle-offer-submit">
          {loading ? <><Loader2 size={16} className="animate-spin mr-2" />Creating link…</> : "Generate Dealer Offer Link"}
        </Button>
      </form>
    </div>
  );
}
