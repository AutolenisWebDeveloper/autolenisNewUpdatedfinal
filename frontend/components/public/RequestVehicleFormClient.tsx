"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2 } from "lucide-react";

const VEHICLE_TYPES = ["SUV", "Sedan", "Truck", "Van", "Coupe", "Other"] as const;
type VehicleType = (typeof VEHICLE_TYPES)[number];

const BUDGET_OPTIONS = [
  "Under $15,000",
  "$15,000–$25,000",
  "$25,000–$35,000",
  "$35,000–$50,000",
  "$50,000–$75,000",
  "$75,000+",
];

const NEW_OR_USED = ["New", "Used", "Either"] as const;
type NewOrUsed = (typeof NEW_OR_USED)[number];

const FINANCING = ["Yes", "No", "Not Sure"] as const;
type Financing = (typeof FINANCING)[number];

const YEAR_OPTIONS = Array.from({ length: 2026 - 2010 + 1 }, (_, i) => 2010 + i);

const NOTES_MAX = 1000;

export default function RequestVehicleFormClient() {
  const [submitted, setSubmitted] = useState(false);
  const [submittedName, setSubmittedName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");

  const [vehicleType, setVehicleType] = useState<VehicleType | "">("");
  const [preferredMake, setPreferredMake] = useState("");
  const [preferredModel, setPreferredModel] = useState("");
  const [minYear, setMinYear] = useState("");
  const [maxYear, setMaxYear] = useState("");

  const [budget, setBudget] = useState("");
  const [newOrUsed, setNewOrUsed] = useState<NewOrUsed | "">("");
  const [financingNeeded, setFinancingNeeded] = useState<Financing | "">("");
  const [notes, setNotes] = useState("");
  const [agreedToContact, setAgreedToContact] = useState(false);

  const zipValid = /^\d{5}$/.test(zip);

  const canSubmit =
    !loading &&
    fullName.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(email) &&
    phone.trim().length >= 7 &&
    zipValid &&
    !!vehicleType &&
    !!budget &&
    !!newOrUsed &&
    !!financingNeeded &&
    agreedToContact;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setLoading(true);
    try {
      const res = await fetch("/api/public/request-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          zip,
          vehicleType,
          preferredMake: preferredMake || undefined,
          preferredModel: preferredModel || undefined,
          minYear: minYear ? Number(minYear) : undefined,
          maxYear: maxYear ? Number(maxYear) : undefined,
          budget,
          newOrUsed,
          financingNeeded,
          notes: notes || undefined,
          agreedToContact: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: { message?: string };
      };
      if (res.ok && data.success) {
        setSubmittedName(fullName);
        setSubmitted(true);
      } else {
        setError(data.error?.message ?? "Unable to submit your request. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F8F9FB]" data-testid="request-vehicle-page">
      <section className="bg-white border-b border-[#E5E7EB] py-14 text-center px-4">
        <p className="text-xs font-semibold tracking-widest text-[#0B5FD1] uppercase mb-3">
          Vehicle Request
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-4">
          Request Your Perfect Vehicle
        </h1>
        <p className="text-[#4B5563] max-w-xl mx-auto text-base">
          Tell us what you&apos;re looking for and we&apos;ll connect you with dealers who compete for your business — no haggling, no obligation.
        </p>
      </section>

      <section className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-8">
          {submitted ? (
            <div className="text-center py-12" data-testid="request-vehicle-success">
              <div className="w-16 h-16 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 size={28} className="text-[#059669]" />
              </div>
              <h3 className="font-bold text-[#111827] text-xl mb-2">Request Received!</h3>
              <p className="text-[#4B5563] mb-6">
                Thank you, {submittedName}. We&apos;ll review your request and reach out within 24 hours with next steps.
              </p>
              <a
                href="/"
                data-testid="request-vehicle-home-link"
                className="inline-flex items-center gap-2 rounded-lg bg-[#0B5FD1] text-white px-6 py-2.5 text-sm font-medium hover:bg-[#0944a8]"
              >
                Back to AutoLenis
              </a>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-[#111827] mb-6">Your Vehicle Request</h2>
              <form onSubmit={handleSubmit} data-testid="request-vehicle-form" className="space-y-6">
                {/* Contact row 1 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="rv-name" className="text-sm font-medium text-[#374151]">Full Name</Label>
                    <Input
                      id="rv-name"
                      data-testid="request-vehicle-name-input"
                      placeholder="Jane Smith"
                      className="mt-1.5"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="rv-email" className="text-sm font-medium text-[#374151]">Email</Label>
                    <Input
                      id="rv-email"
                      type="email"
                      data-testid="request-vehicle-email-input"
                      placeholder="jane@example.com"
                      className="mt-1.5"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Contact row 2 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="rv-phone" className="text-sm font-medium text-[#374151]">Phone</Label>
                    <Input
                      id="rv-phone"
                      type="tel"
                      data-testid="request-vehicle-phone-input"
                      placeholder="(555) 555-5555"
                      className="mt-1.5"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="rv-zip" className="text-sm font-medium text-[#374151]">ZIP Code</Label>
                    <Input
                      id="rv-zip"
                      data-testid="request-vehicle-zip-input"
                      placeholder="75201"
                      className="mt-1.5"
                      value={zip}
                      onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                      required
                    />
                    {zip.length > 0 && !zipValid && (
                      <p className="text-xs text-red-600 mt-1">Enter a 5-digit ZIP.</p>
                    )}
                  </div>
                </div>

                {/* Vehicle type */}
                <div>
                  <Label className="text-sm font-medium text-[#374151]">Vehicle Type</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
                    {VEHICLE_TYPES.map((type) => {
                      const selected = vehicleType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setVehicleType(type)}
                          aria-pressed={selected}
                          data-testid={`request-vehicle-type-${type.toLowerCase()}`}
                          className={`rounded-xl border-2 p-4 text-sm font-medium transition-all ${
                            selected
                              ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          {type}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Make / model */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="rv-make" className="text-sm font-medium text-[#374151]">Preferred Make (optional)</Label>
                    <Input
                      id="rv-make"
                      data-testid="request-vehicle-make-input"
                      placeholder="Toyota"
                      className="mt-1.5"
                      value={preferredMake}
                      onChange={(e) => setPreferredMake(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="rv-model" className="text-sm font-medium text-[#374151]">Preferred Model (optional)</Label>
                    <Input
                      id="rv-model"
                      data-testid="request-vehicle-model-input"
                      placeholder="Camry"
                      className="mt-1.5"
                      value={preferredModel}
                      onChange={(e) => setPreferredModel(e.target.value)}
                    />
                  </div>
                </div>

                {/* Year range */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="rv-min-year" className="text-sm font-medium text-[#374151]">Min Year</Label>
                    <Select
                      id="rv-min-year"
                      data-testid="request-vehicle-min-year-select"
                      className="mt-1.5"
                      value={minYear}
                      onChange={(e) => setMinYear(e.target.value)}
                    >
                      <option value="">Any</option>
                      {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="rv-max-year" className="text-sm font-medium text-[#374151]">Max Year</Label>
                    <Select
                      id="rv-max-year"
                      data-testid="request-vehicle-max-year-select"
                      className="mt-1.5"
                      value={maxYear}
                      onChange={(e) => setMaxYear(e.target.value)}
                    >
                      <option value="">Any</option>
                      {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </Select>
                  </div>
                </div>

                {/* Budget */}
                <div>
                  <Label htmlFor="rv-budget" className="text-sm font-medium text-[#374151]">Budget</Label>
                  <Select
                    id="rv-budget"
                    data-testid="request-vehicle-budget-select"
                    className="mt-1.5"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    required
                  >
                    <option value="">Select your budget</option>
                    {BUDGET_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </Select>
                </div>

                {/* New / used */}
                <div>
                  <Label className="text-sm font-medium text-[#374151]">New or Used</Label>
                  <div className="grid grid-cols-3 gap-3 mt-2">
                    {NEW_OR_USED.map((opt) => {
                      const selected = newOrUsed === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setNewOrUsed(opt)}
                          aria-pressed={selected}
                          data-testid={`request-vehicle-condition-${opt.toLowerCase()}`}
                          className={`rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                            selected
                              ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Financing */}
                <div>
                  <Label className="text-sm font-medium text-[#374151]">Financing Needed</Label>
                  <div className="grid grid-cols-3 gap-3 mt-2">
                    {FINANCING.map((opt) => {
                      const selected = financingNeeded === opt;
                      const slug = opt.toLowerCase().replace(/\s+/g, "-");
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setFinancingNeeded(opt)}
                          aria-pressed={selected}
                          data-testid={`request-vehicle-financing-${slug}`}
                          className={`rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                            selected
                              ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <Label htmlFor="rv-notes" className="text-sm font-medium text-[#374151]">
                    Additional Notes (optional)
                  </Label>
                  <Textarea
                    id="rv-notes"
                    data-testid="request-vehicle-notes-input"
                    placeholder="Any specific features, colors, trim levels, or other details that would help us find your ideal vehicle."
                    className="mt-1.5 min-h-[120px]"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
                    rows={4}
                    maxLength={NOTES_MAX}
                  />
                  <p className="text-xs text-slate-400 mt-1 text-right">
                    {notes.length}/{NOTES_MAX}
                  </p>
                </div>

                {/* Consent */}
                <label
                  className="flex items-start gap-3 cursor-pointer"
                  data-testid="request-vehicle-consent"
                >
                  <input
                    type="checkbox"
                    checked={agreedToContact}
                    onChange={(e) => setAgreedToContact(e.target.checked)}
                    data-testid="request-vehicle-consent-checkbox"
                    className="mt-1 h-4 w-4 rounded border-slate-300 accent-[#0B5FD1]"
                  />
                  <span className="text-sm text-[#4B5563]">
                    I agree to be contacted by AutoLenis about my vehicle request. No obligation — you can opt out at any time.
                  </span>
                </label>

                {error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3" data-testid="request-vehicle-error">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-12 text-base font-semibold"
                  disabled={!canSubmit}
                  data-testid="request-vehicle-submit"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin mr-2" />
                      Submitting…
                    </>
                  ) : (
                    "Submit Vehicle Request"
                  )}
                </Button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
