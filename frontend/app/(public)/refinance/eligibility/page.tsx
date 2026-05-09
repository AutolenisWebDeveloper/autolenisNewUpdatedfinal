"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import RefinanceComplianceDisclosure from "@/components/public/RefinanceComplianceDisclosure";

const EXCLUDED_STATES = ["AK", "HI", "MT", "NV", "NH", "ND", "WI"];

// US states (50 + DC) with excluded set filtered out at render time.
const ALL_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

const CURRENT_YEAR = new Date().getFullYear();
const VEHICLE_YEARS = Array.from({ length: CURRENT_YEAR - 2010 + 1 }, (_, i) => CURRENT_YEAR - i);

const INTEREST_RATE_BANDS = [
  { value: "UNDER_5", label: "Under 5%" },
  { value: "5_TO_8", label: "5 – 8%" },
  { value: "8_TO_12", label: "8 – 12%" },
  { value: "OVER_12", label: "12%+" },
  { value: "NOT_SURE", label: "Not sure" },
];

const EMPLOYMENT_OPTIONS = [
  { value: "FULL_TIME", label: "Employed full-time" },
  { value: "PART_TIME", label: "Employed part-time" },
  { value: "SELF_EMPLOYED", label: "Self-employed" },
  { value: "RETIRED", label: "Retired" },
  { value: "OTHER", label: "Other" },
];

type FormState = {
  vehicleYear: string;
  loanBalance: string;
  monthlyPayment: string;
  interestRateBand: string;
  employmentStatus: string;
  state: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  consentGiven: boolean;
};

const INITIAL: FormState = {
  vehicleYear: "",
  loanBalance: "",
  monthlyPayment: "",
  interestRateBand: "",
  employmentStatus: "",
  state: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  consentGiven: false,
};

export default function RefinanceEligibilityPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const stateExcluded = useMemo(
    () => form.state !== "" && EXCLUDED_STATES.includes(form.state),
    [form.state],
  );

  const canSubmit =
    !stateExcluded &&
    form.vehicleYear !== "" &&
    form.loanBalance !== "" &&
    form.monthlyPayment !== "" &&
    form.interestRateBand !== "" &&
    form.employmentStatus !== "" &&
    form.state !== "" &&
    form.firstName.trim() !== "" &&
    form.lastName.trim() !== "" &&
    form.email.trim() !== "" &&
    form.phone.trim() !== "" &&
    form.consentGiven &&
    !submitting;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      vehicleYear: parseInt(form.vehicleYear, 10),
      loanBalanceCents: Math.round(parseFloat(form.loanBalance || "0") * 100),
      monthlyPaymentCents: Math.round(parseFloat(form.monthlyPayment || "0") * 100),
      interestRateBand: form.interestRateBand,
      employmentStatus: form.employmentStatus,
      state: form.state,
      consentGiven: form.consentGiven,
      source: "refinance_eligibility_form",
    };

    try {
      const res = await fetch("/api/public/refinance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json() as {
        success?: boolean;
        data?: { qualified: boolean; leadId: string };
        error?: { code: string; message: string };
      };

      if (!res.ok || !json.success || !json.data) {
        if (json.error?.code === "EXCLUDED_STATE") {
          router.push("/refinance/ineligible?reason=state");
          return;
        }
        setSubmitError(json.error?.message ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      // Stash minimal context for the confirm page (no financial calc, just display).
      if (typeof window !== "undefined") {
        sessionStorage.setItem(
          "refinance-lead",
          JSON.stringify({
            leadId: json.data.leadId,
            qualified: json.data.qualified,
            vehicleYear: payload.vehicleYear,
            loanBalance: (payload.loanBalanceCents / 100).toFixed(2),
            state: payload.state,
          }),
        );
      }

      if (json.data.qualified) {
        router.push(`/refinance/confirm?leadId=${encodeURIComponent(json.data.leadId)}`);
      } else {
        router.push("/refinance/ineligible");
      }
    } catch {
      setSubmitError("Unable to submit. Please check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white" data-testid="refinance-eligibility-page">
      <section
        className="pt-16 py-20 bg-gradient-to-b from-[#F8F9FB] to-white"
        data-testid="eligibility-hero"
      >
        <div className="mx-auto max-w-3xl px-6">
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">
            Eligibility Screening
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-[#111827] mt-4 mb-4">
            Let&rsquo;s see if we can connect you
          </h1>
          <p className="text-[#4B5563] text-base leading-relaxed">
            This short screening helps us determine whether OpenRoad Lending may be a fit for your refinance goals. No credit check is performed here.
          </p>
        </div>
      </section>

      <section className="py-14">
        <div className="mx-auto max-w-2xl px-6">
          <form
            onSubmit={handleSubmit}
            data-testid="refinance-eligibility-form"
            className="space-y-6"
            noValidate
          >
            {/* Vehicle + loan snapshot */}
            <fieldset className="space-y-5">
              <legend className="text-sm font-bold text-[#111827]">About your current loan</legend>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rf-vehicleYear">Current vehicle year</Label>
                  <Select
                    id="rf-vehicleYear"
                    data-testid="rf-vehicle-year"
                    className="mt-1.5"
                    value={form.vehicleYear}
                    onChange={(e) => update("vehicleYear", e.target.value)}
                    required
                  >
                    <option value="">Select year</option>
                    {VEHICLE_YEARS.map((y) => (
                      <option key={y} value={String(y)}>
                        {y}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rf-rate">Current interest rate estimate</Label>
                  <Select
                    id="rf-rate"
                    data-testid="rf-interest-rate-band"
                    className="mt-1.5"
                    value={form.interestRateBand}
                    onChange={(e) => update("interestRateBand", e.target.value)}
                    required
                  >
                    <option value="">Select</option>
                    {INTEREST_RATE_BANDS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rf-balance">Estimated current loan balance ($)</Label>
                  <Input
                    id="rf-balance"
                    data-testid="rf-loan-balance"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="18,500"
                    className="mt-1.5"
                    value={form.loanBalance}
                    onChange={(e) => update("loanBalance", e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="rf-payment">Estimated current monthly payment ($)</Label>
                  <Input
                    id="rf-payment"
                    data-testid="rf-monthly-payment"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="425"
                    className="mt-1.5"
                    value={form.monthlyPayment}
                    onChange={(e) => update("monthlyPayment", e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rf-employment">Employment status</Label>
                  <Select
                    id="rf-employment"
                    data-testid="rf-employment-status"
                    className="mt-1.5"
                    value={form.employmentStatus}
                    onChange={(e) => update("employmentStatus", e.target.value)}
                    required
                  >
                    <option value="">Select</option>
                    {EMPLOYMENT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rf-state">State of residence</Label>
                  <Select
                    id="rf-state"
                    data-testid="rf-state"
                    className="mt-1.5"
                    value={form.state}
                    onChange={(e) => update("state", e.target.value)}
                    required
                  >
                    <option value="">Select state</option>
                    {ALL_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              {stateExcluded && (
                <div
                  data-testid="rf-state-excluded-message"
                  className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4"
                >
                  <ShieldAlert size={16} className="text-amber-700 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-900 leading-relaxed">
                    Unfortunately, this program is not currently available in your state. We apologize for the inconvenience.
                  </p>
                </div>
              )}
            </fieldset>

            {/* Contact */}
            <fieldset className="space-y-5 pt-4 border-t border-[#EFF6FF]">
              <legend className="text-sm font-bold text-[#111827]">How OpenRoad can reach you</legend>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rf-firstName">First name</Label>
                  <Input
                    id="rf-firstName"
                    data-testid="rf-first-name"
                    className="mt-1.5"
                    value={form.firstName}
                    onChange={(e) => update("firstName", e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="rf-lastName">Last name</Label>
                  <Input
                    id="rf-lastName"
                    data-testid="rf-last-name"
                    className="mt-1.5"
                    value={form.lastName}
                    onChange={(e) => update("lastName", e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rf-email">Email address</Label>
                  <Input
                    id="rf-email"
                    data-testid="rf-email"
                    type="email"
                    autoComplete="email"
                    className="mt-1.5"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="rf-phone">Phone number</Label>
                  <Input
                    id="rf-phone"
                    data-testid="rf-phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="(555) 555-5555"
                    className="mt-1.5"
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    required
                  />
                </div>
              </div>
            </fieldset>

            {/* Consent */}
            <div className="flex items-start gap-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-lg p-4">
              <input
                type="checkbox"
                id="rf-consent"
                data-testid="rf-consent-checkbox"
                className="mt-0.5 accent-[#0B5FD1]"
                checked={form.consentGiven}
                onChange={(e) => update("consentGiven", e.target.checked)}
                required
              />
              <label htmlFor="rf-consent" className="text-xs text-[#4B5563] leading-relaxed">
                I consent to AutoLenis collecting and sharing this information with OpenRoad Lending for the purpose of evaluating refinance options. I understand that AutoLenis is not a lender and does not make credit decisions. Submitting this form does not guarantee approval or any specific rate or term.
              </label>
            </div>

            {/* Always-visible compliance disclosure */}
            <RefinanceComplianceDisclosure />

            {submitError && (
              <p
                data-testid="rf-submit-error"
                className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
              >
                {submitError}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              data-testid="rf-submit-btn"
              disabled={!canSubmit}
            >
              {submitting ? "Checking eligibility…" : "Check My Eligibility"}
              {!submitting && <ArrowRight size={15} className="ml-1.5" />}
            </Button>

            <p className="text-center text-xs text-[#94A3B8]">
              <Link href="/refinance" className="hover:text-[#0B5FD1] transition-colors">
                ← Back to refinance overview
              </Link>
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
