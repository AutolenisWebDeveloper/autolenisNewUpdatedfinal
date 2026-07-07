"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ArrowRight, AlertCircle } from "lucide-react";

// Verbatim FCRA consent text — must NEVER be paraphrased, shortened, or
// reworded. Any change here must be mirrored in microbilt.service.ts
// (FCRA_CONSENT_TEXT) and in the legal page at /legal/prequal-consent.
const FCRA_CONSENT_TEXT =
  'I understand that by clicking on the I AGREE button immediately following this notice, I am providing "written instructions" to AutoLenis under the Fair Credit Reporting Act authorizing AutoLenis to obtain information from my personal credit profile or other information from MicroBilt. I authorize AutoLenis to obtain such information solely to prequalify me for credit options. Credit Information accessed for my pre-qualification request may be different than the Credit Information accessed by a credit grantor on a date after the date of my original pre-qualification request to make the credit decision.';

const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

const EMPLOYMENT_STATUSES = [
  "Full-time Employed",
  "Part-time Employed",
  "Self-Employed",
  "Retired",
  "Student",
  "Unemployed",
  "Other",
] as const;

const LENGTH_OF_EMPLOYMENT = [
  "Less than 6 months",
  "6–12 months",
  "1–2 years",
  "3–5 years",
  "5+ years",
  "Not applicable",
] as const;

// Housing status — value is the API enum code, label is buyer-facing.
const HOUSING_STATUSES: ReadonlyArray<{ code: "RENT" | "MORTGAGE" | "OWN" | "FAMILY"; label: string }> = [
  { code: "RENT", label: "Rent" },
  { code: "MORTGAGE", label: "Mortgage" },
  { code: "OWN", label: "Own outright (no mortgage)" },
  { code: "FAMILY", label: "Live with family / no housing cost" },
];

// Housing payment is required unless the buyer owns outright or lives with family.
const HOUSING_PAYMENT_REQUIRED: ReadonlySet<string> = new Set(["RENT", "MORTGAGE"]);

// Section 1 fields are required to enable submit.
interface PrequalForm {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // MM/DD/YYYY
  address: string;
  city: string;
  state: string;
  zip: string;
  // Section 2 — required for income gate calculation, never blocks PII section
  employmentStatus: string;
  employerName: string;
  monthlyIncome: string; // raw input, parsed on submit
  lengthOfEmployment: string;
  // Section 2.5 — housing + debt obligations (back-end DTI)
  housingStatus: string; // "" | RENT | MORTGAGE | OWN | FAMILY
  monthlyHousingPayment: string; // raw input, parsed on submit
  monthlyOtherDebt: string; // raw input, parsed on submit (defaults to 0)
  // Section 3 — required
  fcraConsent: boolean;
}

interface PrequalFormProps {
  /** Show the "your pre-qualification has expired" banner above the form. */
  expired?: boolean;
  initial?: {
    firstName?:        string;
    lastName?:         string;
    dateOfBirth?:      string;
    address?:          string;
    city?:             string;
    state?:            string;
    zip?:              string;
    employmentStatus?: string;
  };
}

const INITIAL_FORM: PrequalForm = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  employmentStatus: "",
  employerName: "",
  monthlyIncome: "",
  lengthOfEmployment: "",
  housingStatus: "",
  monthlyHousingPayment: "",
  monthlyOtherDebt: "",
  fcraConsent: false,
};

// Convert a native <input type="date"> value (YYYY-MM-DD) to MM/DD/YYYY
// before submission. The API expects MM/DD/YYYY per the iPredict contract.
function isoToMmddyyyy(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${m}/${d}/${y}`;
}

// Client hard timeout — server-side timeout is 10s, so 15s gives a small
// buffer and guarantees the form never sits on "Processing…" indefinitely.
const CLIENT_TIMEOUT_MS = 15_000;

export default function PrequalFormClient({ initial, expired = false }: PrequalFormProps = {}) {
  const router = useRouter();
  const [form, setForm] = useState<PrequalForm>({
    ...INITIAL_FORM,
    firstName:        initial?.firstName        ?? "",
    lastName:         initial?.lastName         ?? "",
    dateOfBirth:      initial?.dateOfBirth      ?? "",
    address:          initial?.address          ?? "",
    city:             initial?.city             ?? "",
    state:            initial?.state            ?? "",
    zip:              initial?.zip              ?? "",
    employmentStatus: initial?.employmentStatus ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // DOB bounds — applicants must be 18–110. Bounding the native date picker
  // prevents obviously-invalid ages before the request ever leaves the client.
  const dobBounds = useMemo(() => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const max = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
    const min = new Date(today.getFullYear() - 110, today.getMonth(), today.getDate());
    return { max: iso(max), min: iso(min) };
  }, []);

  // Section 1 fields are required; Section 2 employment fields also required.
  const section1Complete = useMemo(() => {
    return (
      form.firstName.trim() !== "" &&
      form.lastName.trim() !== "" &&
      /^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth) &&
      form.address.trim() !== "" &&
      form.city.trim() !== "" &&
      /^[A-Z]{2}$/.test(form.state) &&
      /^\d{5}$/.test(form.zip)
    );
  }, [form]);

  const isUnemployed = form.employmentStatus.toLowerCase().includes("unemployed");
  const lengthRequired = form.employmentStatus !== "" && !isUnemployed;

  const section2Complete = useMemo(() => {
    const monthlyIncomeNum = form.monthlyIncome
      ? Number(form.monthlyIncome.replace(/[^0-9.]/g, ""))
      : NaN;
    const incomeValid = !Number.isNaN(monthlyIncomeNum) && monthlyIncomeNum >= 500;
    const employmentValid = form.employmentStatus !== "";
    const lengthValid = !lengthRequired || form.lengthOfEmployment !== "";
    return incomeValid && employmentValid && lengthValid;
  }, [form, lengthRequired]);

  const housingPaymentRequired = HOUSING_PAYMENT_REQUIRED.has(form.housingStatus);

  const section2_5Complete = useMemo(() => {
    if (form.housingStatus === "") return false;
    // Housing payment required only for renters / mortgage holders.
    if (housingPaymentRequired) {
      const housingNum = form.monthlyHousingPayment
        ? Number(form.monthlyHousingPayment.replace(/[^0-9.]/g, ""))
        : NaN;
      if (Number.isNaN(housingNum) || housingNum < 0 || housingNum > 20_000) return false;
    }
    // Other debt is optional and may be $0; validate range only when entered.
    if (form.monthlyOtherDebt) {
      const debtNum = Number(form.monthlyOtherDebt.replace(/[^0-9.]/g, ""));
      if (Number.isNaN(debtNum) || debtNum < 0 || debtNum > 30_000) return false;
    }
    return true;
  }, [form, housingPaymentRequired]);

  const canSubmit =
    section1Complete && section2Complete && section2_5Complete && form.fcraConsent && !loading;

  function update<K extends keyof PrequalForm>(key: K, value: PrequalForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function resetSubmissionState() {
    setError(null);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    const monthlyIncomeNum = form.monthlyIncome
      ? Number(form.monthlyIncome.replace(/[^0-9.]/g, ""))
      : undefined;
    const housingPaymentNum = form.monthlyHousingPayment
      ? Number(form.monthlyHousingPayment.replace(/[^0-9.]/g, ""))
      : undefined;
    const otherDebtNum = form.monthlyOtherDebt
      ? Number(form.monthlyOtherDebt.replace(/[^0-9.]/g, ""))
      : 0;

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      dateOfBirth: isoToMmddyyyy(form.dateOfBirth),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.toUpperCase(),
      zip: form.zip,
      fcraConsent: true,
      employmentStatus: form.employmentStatus,
      ...(form.employerName && { employerName: form.employerName.trim() }),
      ...(typeof monthlyIncomeNum === "number" && !Number.isNaN(monthlyIncomeNum)
        ? { monthlyIncome: monthlyIncomeNum }
        : {}),
      ...(form.lengthOfEmployment && { lengthOfEmployment: form.lengthOfEmployment }),
      ...(form.housingStatus && { housingStatus: form.housingStatus }),
      ...(typeof housingPaymentNum === "number" && !Number.isNaN(housingPaymentNum)
        ? { monthlyHousingPayment: housingPaymentNum }
        : {}),
      monthlyOtherDebt: Number.isNaN(otherDebtNum) ? 0 : otherDebtNum,
    };

    try {
      const res = await fetch("/api/buyer/prequal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { approved?: boolean; pending?: boolean; declined?: boolean };
      };
      if (!res.ok || !data.success) {
        setError("Something went wrong during your prequalification check. Please try again.");
        setLoading(false);
        return;
      }
      if (data.data?.approved) router.push("/buyer/prequal/result");
      else if (data.data?.pending) router.push("/buyer/prequal/pending");
      else if (data.data?.declined) router.push("/buyer/prequal/declined");
      else {
        // Unknown shape — surface inline rather than navigating to a wrong page.
        setError("Something went wrong during your prequalification check. Please try again.");
        setLoading(false);
      }
    } catch {
      // AbortError (15s client timeout) or network failure — single generic
      // message with retry, never sit on "Processing…" forever.
      setError("Something went wrong during your prequalification check. Please try again.");
      setLoading(false);
    } finally {
      clearTimeout(timeout);
    }
  }

  // All fields are disabled while submitting, including Section 2.
  const fieldDisabled = loading;

  return (
    <div className="px-4 py-8 sm:px-6 md:px-8 md:py-10" data-testid="prequal-page">
      <div className="mx-auto w-full max-w-2xl">
        {expired && (
          <div
            className="mb-6 flex items-start gap-3 px-4 py-3 bg-al-warning-subtle border border-al-warning/25 rounded-xl"
            data-testid="prequal-expired-banner"
          >
            <AlertCircle size={18} className="text-al-warning mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-al-warning-fg">
                Your pre-qualification has expired
              </p>
              <p className="text-xs text-al-warning-fg/80 mt-0.5">
                Your information has been pre-filled. Review and resubmit to get a fresh approval.
              </p>
            </div>
          </div>
        )}
        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <header className="mb-8 text-center" data-testid="prequal-header">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-al-primary-subtle mb-4">
            <ShieldCheck size={24} className="text-al-primary" />
          </div>
          <h1 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 tracking-tight">
            Check Your Buying Power
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-500">
            A soft credit check with no impact to your credit score
          </p>
          <div
            className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-medium text-slate-600"
            data-testid="prequal-trust-strip"
          >
            {["Soft pull only", "No score impact", "FCRA-compliant", "Results in seconds"].map(
              (claim) => (
                <span key={claim} className="inline-flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-al-success shrink-0" />
                  {claim}
                </span>
              ),
            )}
          </div>
          <p className="mt-3 text-xs text-slate-400" data-testid="prequal-not-lender">
            AutoLenis is not a lender or dealer.
          </p>
        </header>

        <form onSubmit={handleSubmit} data-testid="prequal-form" className="space-y-8" noValidate>
          {/* ─── Section 1: Personal Information (required) ──────────────── */}
          <section data-testid="prequal-section-personal">
            <SectionHeading step={1} title="Personal Information" className="mb-4" />
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldText
                  label="First name"
                  required
                  testId="prequal-firstname"
                  value={form.firstName}
                  onChange={(v) => update("firstName", v)}
                  disabled={fieldDisabled}
                  autoComplete="given-name"
                />
                <FieldText
                  label="Last name"
                  required
                  testId="prequal-lastname"
                  value={form.lastName}
                  onChange={(v) => update("lastName", v)}
                  disabled={fieldDisabled}
                  autoComplete="family-name"
                />
              </div>
              <Field label="Date of birth" required>
                <input
                  type="date"
                  data-testid="prequal-dob"
                  value={form.dateOfBirth}
                  onChange={(e) => update("dateOfBirth", e.target.value)}
                  disabled={fieldDisabled}
                  required
                  min={dobBounds.min}
                  max={dobBounds.max}
                  className={inputCls}
                  autoComplete="bday"
                />
              </Field>
              <FieldText
                label="Street address"
                required
                testId="prequal-address"
                value={form.address}
                onChange={(v) => update("address", v)}
                disabled={fieldDisabled}
                autoComplete="street-address"
              />
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
                <div className="sm:col-span-3">
                  <FieldText
                    label="City"
                    required
                    testId="prequal-city"
                    value={form.city}
                    onChange={(v) => update("city", v)}
                    disabled={fieldDisabled}
                    autoComplete="address-level2"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Field label="State" required>
                    <select
                      data-testid="prequal-state"
                      value={form.state}
                      onChange={(e) => update("state", e.target.value)}
                      disabled={fieldDisabled}
                      required
                      className={inputCls}
                      autoComplete="address-level1"
                    >
                      <option value="">Select…</option>
                      {US_STATES.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.code} — {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="sm:col-span-1">
                  <Field label="ZIP" required>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={5}
                      pattern="\d{5}"
                      data-testid="prequal-zip"
                      value={form.zip}
                      onChange={(e) => update("zip", e.target.value.replace(/\D/g, "").slice(0, 5))}
                      disabled={fieldDisabled}
                      required
                      className={inputCls}
                      autoComplete="postal-code"
                    />
                  </Field>
                </div>
              </div>
            </div>
          </section>

          {/* ─── Visual divider ──────────────────────────────────────────── */}
          <div className="border-t border-slate-200" aria-hidden="true" />

          {/* ─── Section 2: Employment Information (required) ────────────── */}
          <section data-testid="prequal-section-employment">
            <SectionHeading step={2} title="Employment Information" className="mb-2" />
            <p
              className="text-xs text-slate-500 leading-relaxed mb-4"
              data-testid="prequal-employment-disclaimer"
            >
              Required — used to calculate your loan capacity. This information is used by AutoLenis
              only and is never shared with credit bureaus or MicroBilt. It does not affect your
              credit score.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Employment status" required>
                  <select
                    data-testid="prequal-employment-status"
                    value={form.employmentStatus}
                    onChange={(e) => update("employmentStatus", e.target.value)}
                    disabled={fieldDisabled}
                    required
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    {EMPLOYMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                {lengthRequired && (
                  <Field label="Length of employment" required>
                    <select
                      data-testid="prequal-length-employment"
                      value={form.lengthOfEmployment}
                      onChange={(e) => update("lengthOfEmployment", e.target.value)}
                      disabled={fieldDisabled}
                      required
                      className={inputCls}
                    >
                      <option value="">Select…</option>
                      {LENGTH_OF_EMPLOYMENT.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
              <FieldText
                label="Employer name"
                testId="prequal-employer-name"
                value={form.employerName}
                onChange={(v) => update("employerName", v)}
                disabled={fieldDisabled}
                placeholder="Company or employer name"
              />
              <div>
                <Field label="Monthly gross income" required>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                      $
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      data-testid="prequal-monthly-income"
                      value={form.monthlyIncome}
                      onChange={(e) =>
                        update("monthlyIncome", e.target.value.replace(/[^0-9.,]/g, ""))
                      }
                      disabled={fieldDisabled}
                      required
                      placeholder="e.g. 5,000"
                      className={`${inputCls} pl-7`}
                    />
                  </div>
                </Field>
                <p className="mt-1 text-xs text-slate-500">
                  Gross monthly income before taxes — not shared with credit bureaus
                </p>
              </div>
            </div>
          </section>

          {/* ─── Visual divider ──────────────────────────────────────────── */}
          <div className="border-t border-slate-200" aria-hidden="true" />

          {/* ─── Section 2.5: Housing & Debt (required) ─────────────────── */}
          <section data-testid="prequal-section-housing">
            <SectionHeading step={3} title="Housing & Monthly Debt" className="mb-2" />
            <p
              className="text-xs text-slate-500 leading-relaxed mb-4"
              data-testid="prequal-housing-disclaimer"
            >
              Required — used to calculate your total debt-to-income ratio. This information is used
              by AutoLenis only and is never shared with credit bureaus or MicroBilt.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Housing status" required>
                  <select
                    data-testid="prequal-housing-status"
                    value={form.housingStatus}
                    onChange={(e) => update("housingStatus", e.target.value)}
                    disabled={fieldDisabled}
                    required
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    {HOUSING_STATUSES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {housingPaymentRequired && (
                  <div>
                    <Field label="Monthly housing payment" required>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                          $
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          data-testid="prequal-housing-payment"
                          value={form.monthlyHousingPayment}
                          onChange={(e) =>
                            update("monthlyHousingPayment", e.target.value.replace(/[^0-9.,]/g, ""))
                          }
                          disabled={fieldDisabled}
                          required
                          placeholder="e.g. 1,500"
                          className={`${inputCls} pl-7`}
                        />
                      </div>
                    </Field>
                  </div>
                )}
              </div>
              <div>
                <Field label="Total other monthly debt payments">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                      $
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      data-testid="prequal-other-debt"
                      value={form.monthlyOtherDebt}
                      onChange={(e) =>
                        update("monthlyOtherDebt", e.target.value.replace(/[^0-9.,]/g, ""))
                      }
                      disabled={fieldDisabled}
                      placeholder="e.g. 300 (enter 0 if none)"
                      className={`${inputCls} pl-7`}
                    />
                  </div>
                </Field>
                <p className="mt-1 text-xs text-slate-500">
                  Credit cards (minimums), student loans, other auto loans, personal loans, child
                  support. Do NOT include utilities, groceries, or insurance.
                </p>
              </div>
            </div>
          </section>

          {/* ─── Section 3: FCRA consent (required) ──────────────────────── */}
          <section data-testid="prequal-section-fcra">
            <div
              className="w-full p-5 rounded-2xl bg-al-primary-subtle border border-al-primary/15"
              data-testid="prequal-fcra-box"
            >
              <p className="text-[11px] font-semibold text-al-primary uppercase tracking-[0.14em] mb-2">
                Authorization
              </p>
              <p
                className="text-sm leading-relaxed text-slate-800 whitespace-pre-line"
                data-testid="prequal-fcra-text"
              >
                {FCRA_CONSENT_TEXT}
              </p>
              <label className="mt-4 flex items-start gap-3 text-sm text-slate-800">
                <input
                  type="checkbox"
                  data-testid="prequal-fcra-checkbox"
                  checked={form.fcraConsent}
                  onChange={(e) => update("fcraConsent", e.target.checked)}
                  disabled={fieldDisabled}
                  className="mt-0.5 h-4 w-4 accent-al-primary"
                  required
                />
                <span>I have read and agree to the above authorization.</span>
              </label>
            </div>
            <p className="mt-2 text-xs">
              <a
                href="/legal/prequal-consent"
                target="_blank"
                rel="noopener noreferrer"
                className="text-al-primary underline"
                data-testid="prequal-soft-pull-link"
              >
                What is a soft pull?
              </a>
            </p>
          </section>

          {error && (
            <div
              className="flex items-start gap-3 bg-al-danger-subtle border border-al-danger/20 rounded-xl px-4 py-3"
              role="alert"
              data-testid="prequal-error"
            >
              <AlertCircle size={18} className="text-al-danger mt-0.5 shrink-0" />
              <div className="space-y-2">
                <p className="text-sm text-al-danger-fg">{error}</p>
                <button
                  type="button"
                  onClick={resetSubmissionState}
                  className="text-sm font-semibold text-al-primary hover:underline"
                  data-testid="prequal-retry-btn"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* ─── Submit ──────────────────────────────────────────────────── */}
          {/* Label must read "I AGREE" — the FCRA consent text above refers to
              "clicking on the I AGREE button". Do not rename. */}
          <button
            type="submit"
            disabled={!canSubmit}
            data-testid="prequal-submit-btn"
            className="w-full h-12 bg-al-primary text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors hover:bg-al-primary-hover disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Processing your request...
              </>
            ) : (
              <>
                I AGREE <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Field helpers ──────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-al-primary focus:ring-2 focus:ring-al-primary/20 disabled:bg-slate-50 disabled:text-slate-400";

/** Numbered section heading — gives the long single-column form clear steps. */
function SectionHeading({
  step,
  title,
  className,
}: {
  step: number;
  title: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-al-primary-subtle text-al-primary text-xs font-bold shrink-0">
        {step}
      </span>
      <h2 className="text-lg font-semibold text-slate-900 tracking-tight">{title}</h2>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-slate-700 mb-1.5 block">
        {label}
        {required && <span className="text-al-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}

function FieldText({
  label,
  required,
  testId,
  value,
  onChange,
  disabled,
  placeholder,
  autoComplete,
}: {
  label: string;
  required?: boolean;
  testId: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <Field label={label} required={required}>
      <input
        type="text"
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={inputCls}
      />
    </Field>
  );
}
