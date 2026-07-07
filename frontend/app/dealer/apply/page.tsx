"use client";

import { useState } from "react";
import { CheckCircle2, Building2, ClipboardCheck, ShieldCheck, Gavel, Loader2 } from "lucide-react";
import Link from "next/link";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

const INVENTORY_SOURCES = ["DMS Feed", "Listing Site Adapter", "Manual Entry", "Multiple Sources"];

const NEXT_STEPS = [
  { icon: ClipboardCheck, label: "Review",      text: "We review your application within 1 business day." },
  { icon: ShieldCheck,    label: "Approval",    text: "You receive an approval email with an invitation link." },
  { icon: Gavel,          label: "Start Bidding", text: "You complete onboarding and start participating in auctions." },
];

interface FormState {
  dealershipName: string;
  dba: string;
  contactName: string;
  contactTitle: string;
  businessEmail: string;
  businessPhone: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  licenseNumber: string;
  licenseState: string;
  inventorySource: string;
  website: string;
  message: string;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone: string): boolean {
  // Accept common US phone formats: (555) 123-4567, 555-123-4567, 5551234567, +15551234567
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10;
}

export default function DealerApplyPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  const [form, setForm] = useState<FormState>({
    dealershipName: "",
    dba: "",
    contactName: "",
    contactTitle: "",
    businessEmail: "",
    businessPhone: "",
    streetAddress: "",
    city: "",
    state: "",
    zip: "",
    licenseNumber: "",
    licenseState: "",
    inventorySource: "",
    website: "",
    message: "",
  });

  function patch(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validate(): string | null {
    if (!form.dealershipName.trim()) return "Dealership legal name is required.";
    if (!form.contactName.trim()) return "Primary contact name is required.";
    if (!form.businessEmail.trim()) return "Business email is required.";
    if (!validateEmail(form.businessEmail)) return "Please enter a valid email address.";
    if (!form.businessPhone.trim()) return "Business phone is required.";
    if (!validatePhone(form.businessPhone)) return "Please enter a valid phone number (10+ digits).";
    if (!form.streetAddress.trim()) return "Dealership street address is required.";
    if (!form.city.trim()) return "City is required.";
    if (!form.state) return "State is required.";
    if (!form.zip.trim()) return "ZIP code is required.";
    if (!form.licenseNumber.trim()) return "Dealer license number is required.";
    if (!form.licenseState) return "License state is required.";
    if (!form.inventorySource) return "Primary inventory source is required.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicate(false);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    const notes = [
      form.contactTitle && `Contact title: ${form.contactTitle}`,
      form.dba && `DBA: ${form.dba}`,
      form.website && `Website: ${form.website}`,
      form.message && `Message: ${form.message}`,
      `Inventory source: ${form.inventorySource}`,
      `License state: ${form.licenseState}`,
    ].filter(Boolean).join("\n");

    try {
      const res = await fetch("/api/public/dealer-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealershipName: form.dealershipName,
          contactName: form.contactName,
          contactEmail: form.businessEmail,
          contactPhone: form.businessPhone,
          streetAddress: form.streetAddress,
          city: form.city,
          state: form.state,
          zip: form.zip,
          licenseNumber: form.licenseNumber,
          notes: notes || undefined,
        }),
      });

      if (res.ok) {
        setSubmittedEmail(form.businessEmail);
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
      <div
        className="min-h-screen bg-white flex items-center justify-center px-6 py-16"
        data-testid="dealer-apply-success"
      >
        <div className="text-center max-w-xl w-full">
          <div className="w-16 h-16 rounded-full bg-al-primary/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={32} className="text-al-primary" />
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">Application Received</h2>
          <p className="text-slate-500 text-sm leading-relaxed mb-2">
            Thank you for applying to join the AutoLenis dealer network.
          </p>
          <p className="text-slate-500 text-sm leading-relaxed mb-10">
            You&apos;ll receive an email at{" "}
            <span className="font-semibold text-slate-700">{submittedEmail}</span> with your status.
          </p>

          <ol
            className="grid sm:grid-cols-3 gap-4 text-left mb-10"
            data-testid="dealer-apply-next-steps"
          >
            {NEXT_STEPS.map((step, idx) => (
              <li key={step.label} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-al-primary text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <step.icon size={15} className="text-al-primary" />
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{step.text}</p>
              </li>
            ))}
          </ol>

          <Link
            href="/dealer/sign-in"
            className="text-sm text-al-primary hover:underline"
            data-testid="dealer-apply-signin-link"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" data-testid="dealer-apply-page">
      <div className="mx-auto max-w-2xl px-6 py-16 md:py-24">
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-full bg-al-primary/10 flex items-center justify-center mx-auto mb-4">
            <Building2 size={24} className="text-al-primary" />
          </div>
          <p className="text-xs tracking-widest uppercase font-semibold text-al-primary mb-3">
            Dealer Application
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-3">
            Join the AutoLenis dealer network
          </h1>
          <p className="text-slate-500 text-sm">Applications are reviewed within 1 business day.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          data-testid="dealer-apply-form"
          className="space-y-5"
          noValidate
        >
          {/* ── Dealership information ──────────────────────────────────── */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider pt-2">
              Dealership Information
            </h2>

            <div>
              <label htmlFor="da-legal-name" className="block text-xs font-semibold text-slate-600 mb-1.5">
                Dealership Legal Name <span className="text-red-500">*</span>
              </label>
              <input
                id="da-legal-name"
                data-testid="da-dealership-name-input"
                type="text"
                placeholder="ABC Motors LLC"
                required
                value={form.dealershipName}
                onChange={(e) => patch("dealershipName", e.target.value)}
                className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="da-dba" className="block text-xs font-semibold text-slate-600 mb-1.5">
                DBA (Doing Business As) <span className="text-slate-400 font-normal">optional</span>
              </label>
              <input
                id="da-dba"
                data-testid="da-dba-input"
                type="text"
                placeholder="ABC Motors"
                value={form.dba}
                onChange={(e) => patch("dba", e.target.value)}
                className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="da-license" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Dealer License Number <span className="text-red-500">*</span>
                </label>
                <input
                  id="da-license"
                  data-testid="da-license-input"
                  type="text"
                  placeholder="DL-123456"
                  required
                  value={form.licenseNumber}
                  onChange={(e) => patch("licenseNumber", e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="da-license-state" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  License State <span className="text-red-500">*</span>
                </label>
                <select
                  id="da-license-state"
                  data-testid="da-license-state-select"
                  required
                  value={form.licenseState}
                  onChange={(e) => patch("licenseState", e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                >
                  <option value="">Select state</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ── Primary contact ─────────────────────────────────────────── */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider pt-2">
              Primary Contact
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="da-contact-name" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="da-contact-name"
                  data-testid="da-contact-name-input"
                  type="text"
                  placeholder="Jane Smith"
                  required
                  value={form.contactName}
                  onChange={(e) => patch("contactName", e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="da-contact-title" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Title <span className="text-slate-400 font-normal">optional</span>
                </label>
                <input
                  id="da-contact-title"
                  data-testid="da-contact-title-input"
                  type="text"
                  placeholder="General Manager"
                  value={form.contactTitle}
                  onChange={(e) => patch("contactTitle", e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="da-business-email" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Business Email <span className="text-red-500">*</span>
                </label>
                <input
                  id="da-business-email"
                  data-testid="da-contact-email-input"
                  type="email"
                  placeholder="jane@abcmotors.com"
                  required
                  value={form.businessEmail}
                  onChange={(e) => patch("businessEmail", e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="da-business-phone" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Business Phone <span className="text-red-500">*</span>
                </label>
                <input
                  id="da-business-phone"
                  data-testid="da-contact-phone-input"
                  type="tel"
                  placeholder="(555) 123-4567"
                  required
                  value={form.businessPhone}
                  onChange={(e) => patch("businessPhone", e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* ── Address ─────────────────────────────────────────────────── */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider pt-2">
              Dealership Address
            </h2>

            <div>
              <label htmlFor="da-street" className="block text-xs font-semibold text-slate-600 mb-1.5">
                Street Address <span className="text-red-500">*</span>
              </label>
              <input
                id="da-street"
                data-testid="da-street-input"
                type="text"
                placeholder="123 Auto Drive"
                required
                value={form.streetAddress}
                onChange={(e) => patch("streetAddress", e.target.value)}
                className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <label htmlFor="da-city" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  City <span className="text-red-500">*</span>
                </label>
                <input
                  id="da-city"
                  data-testid="da-city-input"
                  type="text"
                  placeholder="Atlanta"
                  required
                  value={form.city}
                  onChange={(e) => patch("city", e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="da-state" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  State <span className="text-red-500">*</span>
                </label>
                <select
                  id="da-state"
                  data-testid="da-state-select"
                  required
                  value={form.state}
                  onChange={(e) => patch("state", e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                >
                  <option value="">State</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="da-zip" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  ZIP <span className="text-red-500">*</span>
                </label>
                <input
                  id="da-zip"
                  data-testid="da-zip-input"
                  type="text"
                  placeholder="30301"
                  inputMode="numeric"
                  pattern="[0-9]{5}(-[0-9]{4})?"
                  maxLength={10}
                  required
                  value={form.zip}
                  onChange={(e) => patch("zip", e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* ── Inventory & Additional ───────────────────────────────────── */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider pt-2">
              Inventory &amp; Additional Details
            </h2>

            <div>
              <label htmlFor="da-inventory-source" className="block text-xs font-semibold text-slate-600 mb-1.5">
                Primary Inventory Source <span className="text-red-500">*</span>
              </label>
              <select
                id="da-inventory-source"
                data-testid="da-inventory-source-select"
                required
                value={form.inventorySource}
                onChange={(e) => patch("inventorySource", e.target.value)}
                className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
              >
                <option value="">Select source</option>
                {INVENTORY_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="da-website" className="block text-xs font-semibold text-slate-600 mb-1.5">
                Website URL <span className="text-slate-400 font-normal">optional</span>
              </label>
              <input
                id="da-website"
                data-testid="da-website-input"
                type="url"
                placeholder="https://abcmotors.com"
                value={form.website}
                onChange={(e) => patch("website", e.target.value)}
                className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="da-message" className="block text-xs font-semibold text-slate-600 mb-1.5">
                Message to AutoLenis <span className="text-slate-400 font-normal">optional</span>
              </label>
              <textarea
                id="da-message"
                data-testid="da-message-input"
                placeholder="Tell us a bit about your dealership, specialties, or any questions…"
                rows={4}
                value={form.message}
                onChange={(e) => patch("message", e.target.value)}
                className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors resize-none"
              />
            </div>
          </div>

          {duplicate && (
            <div
              className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-md"
              data-testid="da-duplicate-error"
            >
              An application with this email already exists.{" "}
              <Link href="/dealer/sign-in" className="underline hover:text-red-900">
                Sign in instead?
              </Link>
            </div>
          )}

          {error && (
            <div
              className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-md"
              data-testid="da-error"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            data-testid="dealer-apply-submit-btn"
            className="w-full py-3.5 bg-al-primary text-white font-bold text-sm rounded-md hover:bg-al-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-al-primary/20"
          >
            {loading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
              </span>
            ) : "Submit Application"}
          </button>

          <p className="text-center text-xs text-slate-400">
            Already a dealer?{" "}
            <Link href="/dealer/sign-in" className="text-al-primary hover:underline" data-testid="da-signin-link">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
