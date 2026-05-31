"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CheckCircle2, Building2, ClipboardCheck, ShieldCheck, Gavel } from "lucide-react";

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

const HEAR_ABOUT_OPTIONS = [
  "Search engine",
  "Industry referral",
  "Social media",
  "Conference / trade show",
  "AutoLenis sales outreach",
  "Other",
];

const MONTHLY_VOLUME_OPTIONS = [
  "Under 10",
  "10–25",
  "26–50",
  "51–100",
  "Over 100",
];

const NEXT_STEPS = [
  { icon: ClipboardCheck, label: "Review", text: "Our dealer relations team verifies your license and references." },
  { icon: ShieldCheck,    label: "Approval", text: "We email approval with credentials and onboarding next steps." },
  { icon: Gavel,          label: "Start Bidding", text: "Sign in, complete onboarding, and join live auctions." },
];

export default function DealerApplicationPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [form, setForm] = useState({
    dealershipName: "",
    dealershipType: "",
    state: "",
    city: "",
    zip: "",
    licenseNumber: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    yearsInBusiness: "",
    annualVolume: "",
    monthlyVolume: "",
    website: "",
    hearAbout: "",
    notes: "",
  });
  const [tcpaConsent, setTcpaConsent] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);

  const canSubmit = tcpaConsent && tosAccepted && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicate(false);
    if (!tcpaConsent || !tosAccepted) {
      setError("Please accept the TCPA consent and Terms of Service.");
      return;
    }
    setLoading(true);
    // Bundle the additional context fields into `notes` so they reach the
    // admin reviewer without requiring a schema change.
    const extra = [
      form.yearsInBusiness && `Years in business: ${form.yearsInBusiness}`,
      form.monthlyVolume && `Estimated monthly sales: ${form.monthlyVolume}`,
      form.website && `Website: ${form.website}`,
      form.hearAbout && `Heard about us via: ${form.hearAbout}`,
      "TCPA consent: yes",
      "Terms of Service accepted: yes",
    ].filter(Boolean).join("\n");
    const notesPayload = [form.notes?.trim(), extra].filter(Boolean).join("\n\n");

    try {
      const res = await fetch("/api/public/dealer-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealershipName: form.dealershipName,
          dealershipType: form.dealershipType,
          state: form.state,
          city: form.city,
          zip: form.zip,
          licenseNumber: form.licenseNumber,
          contactName: form.contactName,
          contactEmail: form.contactEmail,
          contactPhone: form.contactPhone || undefined,
          annualVolume: form.annualVolume || undefined,
          notes: notesPayload || undefined,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else if (res.status === 409) {
        setDuplicate(true);
      } else {
        const data = await res.json().catch(() => ({} as { error?: { message?: string } }));
        setError(data?.error?.message ?? "Unable to submit your application. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6 py-16" data-testid="dealer-application-success">
        <div className="text-center max-w-xl">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={32} className="text-green-600" />
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">Application Received</h2>
          <p className="text-slate-500 text-sm leading-relaxed mb-2">
            We&apos;ll review your application within 2 business days.
          </p>
          <p className="text-slate-500 text-sm leading-relaxed mb-10">
            You&apos;ll receive an email at <span className="font-semibold text-slate-700">{form.contactEmail}</span> with your status.
          </p>

          <ol className="grid sm:grid-cols-3 gap-4 text-left" data-testid="dealer-application-next-steps">
            {NEXT_STEPS.map((step, idx) => (
              <li key={step.label} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full bg-[#0B5FD1] text-white text-xs font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <step.icon size={16} className="text-[#0B5FD1]" />
                  <p className="text-xs font-bold uppercase tracking-wider text-[#0B5FD1]">{step.label}</p>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <section className="py-20 md:py-28 bg-white" data-testid="dealer-application-page">
      <div className="mx-auto max-w-2xl px-6">
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-full bg-[#0B5FD1]/10 flex items-center justify-center mx-auto mb-4">
            <Building2 size={24} className="text-[#0B5FD1]" />
          </div>
          <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-3">Dealer Application</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-3">Join the AutoLenis dealer network</h1>
          <p className="text-slate-500 text-sm">Applications are reviewed within 2 business days.</p>
        </div>

        <form onSubmit={handleSubmit} data-testid="dealer-application-form" className="space-y-5">
          <div>
            <Label htmlFor="da-name">Dealership name</Label>
            <Input id="da-name" data-testid="da-dealership-name-input" placeholder="ABC Motors" className="mt-1.5" value={form.dealershipName} onChange={(e) => setForm({ ...form, dealershipName: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="da-type">Dealership type</Label>
              <Select id="da-type" data-testid="da-type-select" className="mt-1.5" value={form.dealershipType} onChange={(e) => setForm({ ...form, dealershipType: e.target.value })} required>
                <option value="">Select type</option>
                {["Independent", "Franchise", "Certified Pre-Owned", "Luxury Specialist", "Multi-Line Franchise"].map((t) => <option key={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="da-license">Dealer license number</Label>
              <Input id="da-license" data-testid="da-license-input" placeholder="DL-123456" className="mt-1.5" value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="da-state">State</Label>
              <Select id="da-state" data-testid="da-state-select" className="mt-1.5" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required>
                <option value="">State</option>
                {US_STATES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="da-city">City</Label>
              <Input id="da-city" data-testid="da-city-input" placeholder="Atlanta" className="mt-1.5" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="da-zip">ZIP</Label>
              <Input id="da-zip" data-testid="da-zip-input" placeholder="30301" inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} className="mt-1.5" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="da-contact-name">Primary contact name</Label>
              <Input id="da-contact-name" data-testid="da-contact-name-input" placeholder="John Smith" className="mt-1.5" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="da-contact-email">Contact email</Label>
              <Input id="da-contact-email" type="email" data-testid="da-contact-email-input" placeholder="john@abcmotors.com" className="mt-1.5" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="da-contact-phone">Contact phone</Label>
              <Input id="da-contact-phone" type="tel" data-testid="da-contact-phone-input" placeholder="(555) 123-4567" className="mt-1.5" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="da-years">Years in business</Label>
              <Input id="da-years" type="number" min={0} max={200} data-testid="da-years-input" placeholder="e.g. 12" className="mt-1.5" value={form.yearsInBusiness} onChange={(e) => setForm({ ...form, yearsInBusiness: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="da-volume">Approximate annual unit volume</Label>
              <Select id="da-volume" data-testid="da-volume-select" className="mt-1.5" value={form.annualVolume} onChange={(e) => setForm({ ...form, annualVolume: e.target.value })} required>
                <option value="">Select range</option>
                {["Under 100", "100–250", "251–500", "501–1,000", "Over 1,000"].map((v) => <option key={v}>{v}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="da-monthly-volume">Estimated monthly sales</Label>
              <Select id="da-monthly-volume" data-testid="da-monthly-volume-select" className="mt-1.5" value={form.monthlyVolume} onChange={(e) => setForm({ ...form, monthlyVolume: e.target.value })} required>
                <option value="">Select range</option>
                {MONTHLY_VOLUME_OPTIONS.map((v) => <option key={v}>{v}</option>)}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="da-website">Website (optional)</Label>
              <Input id="da-website" type="url" data-testid="da-website-input" placeholder="https://abcmotors.com" className="mt-1.5" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="da-hear">How did you hear about us?</Label>
              <Select id="da-hear" data-testid="da-hear-select" className="mt-1.5" value={form.hearAbout} onChange={(e) => setForm({ ...form, hearAbout: e.target.value })} required>
                <option value="">Select option</option>
                {HEAR_ABOUT_OPTIONS.map((v) => <option key={v}>{v}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="da-notes">Additional notes (optional)</Label>
            <Textarea id="da-notes" data-testid="da-notes-input" placeholder="Tell us about your dealership…" className="mt-1.5" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          {/* TCPA + ToS required consent checkboxes */}
          <div className="space-y-3 pt-2">
            <label className="flex items-start gap-2 cursor-pointer select-none" data-testid="da-tcpa-label">
              <input
                type="checkbox"
                checked={tcpaConsent}
                onChange={(e) => setTcpaConsent(e.target.checked)}
                required
                data-testid="da-tcpa-checkbox"
                className="h-4 w-4 mt-0.5 rounded border-slate-300 text-[#0B5FD1] focus:ring-[#0B5FD1]/30"
              />
              <span className="text-xs text-slate-600 leading-relaxed">
                I agree to receive SMS messages from AutoLenis regarding my dealer
                application, onboarding, auction activity, buyer requests, and
                service-related communications. Message frequency varies. Message and data
                rates may apply. Reply STOP to opt out, HELP for assistance. Consent is not
                a condition of purchase. View our{" "}
                <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-[#0B5FD1] hover:underline">Privacy Policy</a>
                {" "}and{" "}
                <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-[#0B5FD1] hover:underline">Terms of Service</a>.
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer select-none" data-testid="da-tos-label">
              <input
                type="checkbox"
                checked={tosAccepted}
                onChange={(e) => setTosAccepted(e.target.checked)}
                required
                data-testid="da-tos-checkbox"
                className="h-4 w-4 mt-0.5 rounded border-slate-300 text-[#0B5FD1] focus:ring-[#0B5FD1]/30"
              />
              <span className="text-xs text-slate-600 leading-relaxed">
                I have read and agree to the AutoLenis{" "}
                <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-[#0B5FD1] hover:underline">Terms of Service</a>.
              </span>
            </label>
          </div>

          {duplicate && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-md" data-testid="da-duplicate-error">
              An application with this email already exists.
            </div>
          )}
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-md" data-testid="da-error">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" data-testid="dealer-application-submit-btn" disabled={!canSubmit}>
            {loading ? "Submitting…" : "Submit Application"}
          </Button>
        </form>
      </div>
    </section>
  );
}
