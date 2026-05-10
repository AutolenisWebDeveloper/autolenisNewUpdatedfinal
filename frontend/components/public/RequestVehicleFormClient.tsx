"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { POPULAR_MAKES, fetchModelsForMake } from "@/lib/utils/vehicle-makes";

const VEHICLE_TYPES = ["SUV", "Sedan", "Truck", "Van", "Coupe", "Other"] as const;
type VehicleType = (typeof VEHICLE_TYPES)[number];

const NEW_USED = ["New", "Used", "Either"] as const;
type NewUsed = (typeof NEW_USED)[number];

const BUDGETS = [
  "Under $15,000", "$15,000–$25,000", "$25,000–$35,000",
  "$35,000–$50,000", "$50,000–$75,000", "$75,000+",
];

const FINANCING_OPTIONS = [
  { value: "need_financing",  title: "I Need Financing",  helper: "Help me get pre-qualified" },
  { value: "have_financing",  title: "I Have Financing",  helper: "I have a pre-approval" },
  { value: "no_financing",    title: "Paying Cash",       helper: "No financing needed" },
] as const;
type FinancingOption = typeof FINANCING_OPTIONS[number]["value"];

const EMPLOYMENT = ["Employed Full-Time", "Part-Time", "Self-Employed", "Retired", "Student", "Other"];
const INCOMES   = ["Under $30k", "$30k–$50k", "$50k–$75k", "$75k–$100k", "$100k–$150k", "$150k+"];
const CREDIT    = ["Excellent (750+)", "Good (700–749)", "Fair (650–699)", "Below Average (600–649)", "Poor (below 600)", "Not Sure"];
const DOWNS     = ["$0–$1,000", "$1k–$3k", "$3k–$5k", "$5k–$10k", "$10k+"];
const PAYMENTS  = ["Under $300", "$300–$500", "$500–$700", "$700–$1,000", "Over $1,000"];

const TRADE_CONDITIONS = ["Excellent", "Good", "Fair", "Poor"];
const TITLE_STATUSES   = ["Clean Title", "Salvage", "Rebuilt", "Not Sure"];
const TRADE_YEARS = Array.from({ length: 2026 - 1995 + 1 }, (_, i) => 2026 - i);
const REQUEST_YEARS = Array.from({ length: 2026 - 2010 + 1 }, (_, i) => 2026 - i);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"];

function SectionHeader({ num, title }: { num: number; title: string }) {
  return (
    <h2 className="text-base font-bold text-[#111827] mb-5 flex items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0B5FD1] text-white text-xs font-bold">
        {num}
      </span>
      {title}
    </h2>
  );
}

function ToggleRow({
  options,
  value,
  onChange,
  testIdPrefix,
  cols = 3,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  testIdPrefix: string;
  cols?: number;
}) {
  const colsClass = cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-4";
  return (
    <div className={`grid ${colsClass} gap-3`}>
      {options.map((opt) => {
        const selected = value === opt;
        const slug = opt.toLowerCase().replace(/\s+/g, "-");
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={selected}
            data-testid={`${testIdPrefix}-${slug}`}
            className={`rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors ${
              selected
                ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function YesNoToggle({ value, onChange, testId }: { value: boolean | null; onChange: (v: boolean) => void; testId: string }) {
  return (
    <div className="flex gap-3">
      {[true, false].map((b) => {
        const selected = value === b;
        return (
          <button
            key={String(b)}
            type="button"
            onClick={() => onChange(b)}
            aria-pressed={selected}
            data-testid={`${testId}-${b ? "yes" : "no"}`}
            className={`flex-1 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors ${
              selected
                ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {b ? "Yes" : "No"}
          </button>
        );
      })}
    </div>
  );
}

function MakeModelPair({
  make, setMake,
  model, setModel,
  customModel, setCustomModel,
  testIdPrefix,
}: {
  make: string;
  setMake: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  customModel: string;
  setCustomModel: (v: string) => void;
  testIdPrefix: string;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    if (!make || make === "Other") {
      setModels([]);
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    fetchModelsForMake(make).then((m) => {
      if (!cancelled) {
        setModels(m);
        setLoadingModels(false);
      }
    });
    return () => { cancelled = true; };
  }, [make]);

  return (
    <>
      <div>
        <Label htmlFor={`${testIdPrefix}-make`} className="text-sm font-medium text-[#374151]">Make</Label>
        <Select
          id={`${testIdPrefix}-make`}
          data-testid={`${testIdPrefix}-make`}
          className="mt-1.5"
          value={make}
          onChange={(e) => { setMake(e.target.value); setModel(""); setCustomModel(""); }}
        >
          <option value="">Select a make</option>
          {POPULAR_MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${testIdPrefix}-model`} className="text-sm font-medium text-[#374151]">Model</Label>
        {make === "Other" ? (
          <Input
            id={`${testIdPrefix}-model`}
            data-testid={`${testIdPrefix}-model`}
            placeholder="e.g. Custom build"
            className="mt-1.5"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
          />
        ) : (
          <Select
            id={`${testIdPrefix}-model`}
            data-testid={`${testIdPrefix}-model`}
            className="mt-1.5"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!make || loadingModels}
          >
            <option value="">{!make ? "Choose a make first" : loadingModels ? "Loading…" : "Any model"}</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        )}
      </div>
    </>
  );
}

function SuccessState({ name }: { name: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-10 text-center" data-testid="rv-success">
      <div className="w-16 h-16 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 size={28} className="text-[#059669]" />
      </div>
      <h3 className="font-bold text-[#111827] text-xl mb-2">Request Received!</h3>
      <p className="text-[#4B5563] mb-6">
        Thank you, {name}. We&apos;ll review your request and reach out within 24 hours.
      </p>
      <a
        href="/"
        data-testid="rv-success-home-link"
        className="inline-flex items-center rounded-lg bg-[#0B5FD1] text-white px-6 py-2.5 text-sm font-medium hover:bg-[#0944a8]"
      >
        Back to AutoLenis
      </a>
    </div>
  );
}

export default function RequestVehicleFormClient() {
  const [submitted, setSubmitted] = useState(false);
  const [submittedName, setSubmittedName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §1 Contact
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");

  // §2 Vehicle
  const [vehicleType, setVehicleType] = useState<VehicleType | "">("");
  const [reqMake, setReqMake] = useState("");
  const [reqModel, setReqModel] = useState("");
  const [reqCustomModel, setReqCustomModel] = useState("");
  const [minYear, setMinYear] = useState("");
  const [maxYear, setMaxYear] = useState("");
  const [newOrUsed, setNewOrUsed] = useState<NewUsed | "">("");
  const [specificFeatures, setSpecificFeatures] = useState("");

  // §3 Budget + Financing path
  const [budget, setBudget] = useState("");
  const [financingOption, setFinancingOption] = useState<FinancingOption | "">("");

  // §4A Need financing
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [annualIncome, setAnnualIncome] = useState("");
  const [creditScore, setCreditScore] = useState("");
  const [downPayment, setDownPayment] = useState("");
  const [monthlyPayment, setMonthlyPayment] = useState("");

  // §4B Have financing
  const [lenderName, setLenderName] = useState("");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [apr, setApr] = useState("");
  const [preApprovalExpiry, setPreApprovalExpiry] = useState("");
  const [preApprovalFile, setPreApprovalFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // §5 Trade-in
  const [hasTradeIn, setHasTradeIn] = useState<boolean | null>(null);
  const [tradeYear, setTradeYear] = useState("");
  const [tradeMake, setTradeMake] = useState("");
  const [tradeModel, setTradeModel] = useState("");
  const [tradeCustomModel, setTradeCustomModel] = useState("");
  const [tradeTrim, setTradeTrim] = useState("");
  const [tradeMileage, setTradeMileage] = useState("");
  const [tradeColor, setTradeColor] = useState("");
  const [tradeCondition, setTradeCondition] = useState("");
  const [tradePaidOff, setTradePaidOff] = useState<boolean | null>(null);
  const [tradeLoanBalance, setTradeLoanBalance] = useState("");
  const [tradeIssues, setTradeIssues] = useState("");
  const [tradeTitleStatus, setTradeTitleStatus] = useState("");

  // §6 Notes + consent
  const [notes, setNotes] = useState("");
  const [agreedToContact, setAgreedToContact] = useState(false);

  function handleFile(f: File | null) {
    setFileError(null);
    if (!f) { setPreApprovalFile(null); return; }
    if (!ACCEPTED_FILE_TYPES.includes(f.type)) {
      setFileError("File must be PDF, JPG, or PNG.");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFileError("File must be 10 MB or smaller.");
      return;
    }
    setPreApprovalFile(f);
  }

  const zipValid = /^\d{5}$/.test(zip);
  const canSubmit =
    !loading &&
    firstName.trim() && lastName.trim() &&
    /\S+@\S+\.\S+/.test(email) &&
    phone.trim().length >= 7 &&
    zipValid &&
    !!vehicleType && !!budget && !!newOrUsed && !!financingOption &&
    agreedToContact;

  function buildPayload() {
    return {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      zip,
      vehicleType,
      preferredMake: reqMake || undefined,
      preferredModel: (reqMake === "Other" ? undefined : reqModel) || undefined,
      customMakeModel: reqMake === "Other" ? reqCustomModel || undefined : undefined,
      minYear: minYear ? Number(minYear) : undefined,
      maxYear: maxYear ? Number(maxYear) : undefined,
      newOrUsed,
      specificFeatures: specificFeatures || undefined,
      budget,
      financingOption,
      ...(financingOption === "need_financing" && {
        employmentStatus: employmentStatus || undefined,
        employerName: employerName || undefined,
        annualIncome: annualIncome || undefined,
        creditScore: creditScore || undefined,
        downPayment: downPayment || undefined,
        monthlyPayment: monthlyPayment || undefined,
      }),
      ...(financingOption === "have_financing" && {
        lenderName: lenderName || undefined,
        approvedAmount: approvedAmount || undefined,
        apr: apr || undefined,
        preApprovalExpiry: preApprovalExpiry || undefined,
      }),
      hasTradeIn: hasTradeIn ?? false,
      ...(hasTradeIn && {
        tradeYear: tradeYear || undefined,
        tradeMake: tradeMake || undefined,
        tradeModel: (tradeMake === "Other" ? tradeCustomModel : tradeModel) || undefined,
        tradeTrim: tradeTrim || undefined,
        tradeMileage: tradeMileage || undefined,
        tradeColor: tradeColor || undefined,
        tradeCondition: tradeCondition || undefined,
        tradePaidOff: tradePaidOff ?? undefined,
        tradeLoanBalance: tradePaidOff === false ? tradeLoanBalance || undefined : undefined,
        tradeIssues: tradeIssues || undefined,
        tradeTitleStatus: tradeTitleStatus || undefined,
      }),
      notes: notes || undefined,
      agreedToContact: true as const,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      let res: Response;
      if (financingOption === "have_financing" && preApprovalFile) {
        const fd = new FormData();
        fd.append("data", JSON.stringify(buildPayload()));
        fd.append("preApprovalFile", preApprovalFile);
        res = await fetch("/api/public/request-vehicle", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/public/request-vehicle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        });
      }
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
      if (!res.ok || !data.success) {
        setError(data.error?.message ?? "Submission failed.");
        return;
      }
      setSubmittedName(firstName);
      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F8F9FB]" data-testid="request-vehicle-page">
      <section className="bg-white border-b border-[#E5E7EB] py-14 text-center px-4">
        <p className="text-xs font-semibold tracking-widest text-[#0B5FD1] uppercase mb-3">Vehicle Request</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-4">Request Your Perfect Vehicle</h1>
        <p className="text-[#4B5563] max-w-xl mx-auto text-base">
          Tell us what you&apos;re looking for and we&apos;ll connect you with dealers who compete for your business — no haggling, no obligation.
        </p>
      </section>

      <section className="max-w-2xl mx-auto px-4 py-12 space-y-6">
        {submitted ? (
          <SuccessState name={submittedName} />
        ) : (
          <form onSubmit={handleSubmit} data-testid="request-vehicle-form" className="space-y-6">
            {/* §1 Contact */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6 md:p-8">
              <SectionHeader num={1} title="Contact Information" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rv-first-name" className="text-sm font-medium text-[#374151]">First Name</Label>
                  <Input id="rv-first-name" data-testid="rv-first-name" className="mt-1.5" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="rv-last-name" className="text-sm font-medium text-[#374151]">Last Name</Label>
                  <Input id="rv-last-name" data-testid="rv-last-name" className="mt-1.5" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <Label htmlFor="rv-email" className="text-sm font-medium text-[#374151]">Email</Label>
                  <Input id="rv-email" type="email" data-testid="rv-email" className="mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="rv-phone" className="text-sm font-medium text-[#374151]">Phone</Label>
                  <Input id="rv-phone" type="tel" data-testid="rv-phone" className="mt-1.5" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                </div>
              </div>
              <div className="mt-4">
                <Label htmlFor="rv-zip" className="text-sm font-medium text-[#374151]">ZIP Code</Label>
                <Input id="rv-zip" data-testid="rv-zip" className="mt-1.5 max-w-[140px]" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} required />
                {zip.length > 0 && !zipValid && <p className="text-xs text-red-600 mt-1">Enter a 5-digit ZIP.</p>}
              </div>
            </div>

            {/* §2 Vehicle */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6 md:p-8">
              <SectionHeader num={2} title="Vehicle Details" />
              <Label className="text-sm font-medium text-[#374151] block mb-2">Vehicle Type</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {VEHICLE_TYPES.map((t) => {
                  const selected = vehicleType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setVehicleType(t)}
                      data-testid={`rv-type-${t.toLowerCase()}`}
                      className={`rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors ${selected ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
                <MakeModelPair
                  make={reqMake} setMake={setReqMake}
                  model={reqModel} setModel={setReqModel}
                  customModel={reqCustomModel} setCustomModel={setReqCustomModel}
                  testIdPrefix="rv"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <Label htmlFor="rv-min-year" className="text-sm font-medium text-[#374151]">Min Year</Label>
                  <Select id="rv-min-year" data-testid="rv-min-year" className="mt-1.5" value={minYear} onChange={(e) => setMinYear(e.target.value)}>
                    <option value="">No Minimum</option>
                    {REQUEST_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rv-max-year" className="text-sm font-medium text-[#374151]">Max Year</Label>
                  <Select id="rv-max-year" data-testid="rv-max-year" className="mt-1.5" value={maxYear} onChange={(e) => setMaxYear(e.target.value)}>
                    <option value="">No Maximum</option>
                    {REQUEST_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </Select>
                </div>
              </div>

              <div className="mt-5">
                <Label className="text-sm font-medium text-[#374151] block mb-2">New or Used</Label>
                <ToggleRow options={NEW_USED} value={newOrUsed} onChange={(v) => setNewOrUsed(v as NewUsed)} testIdPrefix="rv-new-used" cols={3} />
              </div>

              <div className="mt-5">
                <Label htmlFor="rv-features" className="text-sm font-medium text-[#374151]">Specific Features (optional)</Label>
                <Input id="rv-features" data-testid="rv-features" className="mt-1.5" placeholder="e.g. Black exterior, sunroof, third row, AWD…" value={specificFeatures} onChange={(e) => setSpecificFeatures(e.target.value.slice(0, 500))} maxLength={500} />
              </div>
            </div>

            {/* §3 Budget + financing */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6 md:p-8">
              <SectionHeader num={3} title="Budget &amp; Financing" />
              <div>
                <Label htmlFor="rv-budget" className="text-sm font-medium text-[#374151]">Budget</Label>
                <Select id="rv-budget" data-testid="rv-budget" className="mt-1.5" value={budget} onChange={(e) => setBudget(e.target.value)} required>
                  <option value="">Select your budget</option>
                  {BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              </div>

              <Label className="text-sm font-medium text-[#374151] block mt-5 mb-2">Financing Situation</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {FINANCING_OPTIONS.map((opt) => {
                  const selected = financingOption === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFinancingOption(opt.value)}
                      data-testid={`rv-financing-${opt.value}`}
                      className={`rounded-xl border-2 p-4 text-left transition-colors ${selected ? "border-[#0B5FD1] bg-[#0B5FD1]/5" : "border-slate-200 bg-white hover:border-slate-300"}`}
                    >
                      <p className={`font-semibold text-sm ${selected ? "text-[#0B5FD1]" : "text-slate-800"}`}>{opt.title}</p>
                      <p className="text-xs text-slate-500 mt-1">{opt.helper}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* §4A Need financing */}
            {financingOption === "need_financing" && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 md:p-8" data-testid="rv-need-financing-section">
                <SectionHeader num={4} title="Financing Profile" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="rv-employment" className="text-sm font-medium text-[#374151]">Employment Status</Label>
                    <Select id="rv-employment" data-testid="rv-employment" className="mt-1.5" value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value)}>
                      <option value="">Select</option>
                      {EMPLOYMENT.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="rv-employer" className="text-sm font-medium text-[#374151]">Employer Name (optional)</Label>
                    <Input id="rv-employer" data-testid="rv-employer" className="mt-1.5" value={employerName} onChange={(e) => setEmployerName(e.target.value.slice(0, 100))} />
                  </div>
                  <div>
                    <Label htmlFor="rv-income" className="text-sm font-medium text-[#374151]">Annual Gross Income</Label>
                    <Select id="rv-income" data-testid="rv-income" className="mt-1.5" value={annualIncome} onChange={(e) => setAnnualIncome(e.target.value)}>
                      <option value="">Select</option>
                      {INCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="rv-credit" className="text-sm font-medium text-[#374151]">Estimated Credit Score</Label>
                    <Select id="rv-credit" data-testid="rv-credit" className="mt-1.5" value={creditScore} onChange={(e) => setCreditScore(e.target.value)}>
                      <option value="">Select</option>
                      {CREDIT.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="rv-down" className="text-sm font-medium text-[#374151]">Desired Down Payment</Label>
                    <Select id="rv-down" data-testid="rv-down" className="mt-1.5" value={downPayment} onChange={(e) => setDownPayment(e.target.value)}>
                      <option value="">Select</option>
                      {DOWNS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="rv-monthly" className="text-sm font-medium text-[#374151]">Monthly Payment Target</Label>
                    <Select id="rv-monthly" data-testid="rv-monthly" className="mt-1.5" value={monthlyPayment} onChange={(e) => setMonthlyPayment(e.target.value)}>
                      <option value="">Select</option>
                      {PAYMENTS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-4 bg-white rounded-lg px-4 py-3 border border-slate-100">
                  🔒 Your financial information is encrypted and never shared without your permission.
                </p>
              </div>
            )}

            {/* §4B Have financing */}
            {financingOption === "have_financing" && (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-6 md:p-8" data-testid="rv-have-financing-section">
                <SectionHeader num={4} title="Pre-Approval Details" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="rv-lender" className="text-sm font-medium text-[#374151]">Lender Name *</Label>
                    <Input id="rv-lender" data-testid="rv-lender" className="mt-1.5" value={lenderName} onChange={(e) => setLenderName(e.target.value.slice(0, 100))} />
                  </div>
                  <div>
                    <Label htmlFor="rv-approved-amount" className="text-sm font-medium text-[#374151]">Approved Amount *</Label>
                    <Input id="rv-approved-amount" type="number" min={0} data-testid="rv-approved-amount" className="mt-1.5" placeholder="$" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="rv-apr" className="text-sm font-medium text-[#374151]">APR % (optional)</Label>
                    <Input id="rv-apr" type="number" step="0.01" min={0} data-testid="rv-apr" className="mt-1.5" value={apr} onChange={(e) => setApr(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="rv-expiry" className="text-sm font-medium text-[#374151]">Expiry Date (optional)</Label>
                    <Input id="rv-expiry" type="date" data-testid="rv-expiry" className="mt-1.5" value={preApprovalExpiry} onChange={(e) => setPreApprovalExpiry(e.target.value)} />
                  </div>
                </div>

                <div className="mt-5">
                  <Label className="text-sm font-medium text-[#374151] block mb-2">Upload Pre-Approval Letter (optional)</Label>
                  <label
                    htmlFor="rv-preapproval-file"
                    className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white hover:border-[#0B5FD1] hover:bg-[#0B5FD1]/5 transition-colors cursor-pointer p-6 text-center"
                  >
                    <Upload size={20} className="text-slate-400 mb-2" />
                    {preApprovalFile ? (
                      <p className="text-sm font-medium text-slate-700">{preApprovalFile.name}</p>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-700">Drop a file or click to browse</p>
                        <p className="text-xs text-slate-400 mt-1">PDF, JPG or PNG up to 10 MB</p>
                      </>
                    )}
                    <input
                      id="rv-preapproval-file"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      data-testid="rv-preapproval-file"
                      className="hidden"
                      onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {fileError && <p className="text-xs text-red-600 mt-2" data-testid="rv-file-error">{fileError}</p>}
                </div>
              </div>
            )}

            {/* §5 Trade-in */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6 md:p-8">
              <SectionHeader num={5} title="Trade-In" />
              <Label className="text-sm font-medium text-[#374151] block mb-2">Do you have a trade-in?</Label>
              <YesNoToggle value={hasTradeIn} onChange={setHasTradeIn} testId="rv-trade-in" />

              {hasTradeIn === true && (
                <div className="mt-5 space-y-4" data-testid="rv-trade-section">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor="rv-trade-year" className="text-sm font-medium text-[#374151]">Year</Label>
                      <Select id="rv-trade-year" data-testid="rv-trade-year" className="mt-1.5" value={tradeYear} onChange={(e) => setTradeYear(e.target.value)}>
                        <option value="">Select</option>
                        {TRADE_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                      </Select>
                    </div>
                    <MakeModelPair
                      make={tradeMake} setMake={setTradeMake}
                      model={tradeModel} setModel={setTradeModel}
                      customModel={tradeCustomModel} setCustomModel={setTradeCustomModel}
                      testIdPrefix="rv-trade"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="rv-trade-trim" className="text-sm font-medium text-[#374151]">Trim (optional)</Label>
                      <Input id="rv-trade-trim" data-testid="rv-trade-trim" className="mt-1.5" value={tradeTrim} onChange={(e) => setTradeTrim(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="rv-trade-condition" className="text-sm font-medium text-[#374151]">Condition</Label>
                      <Select id="rv-trade-condition" data-testid="rv-trade-condition" className="mt-1.5" value={tradeCondition} onChange={(e) => setTradeCondition(e.target.value)}>
                        <option value="">Select</option>
                        {TRADE_CONDITIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="rv-trade-mileage" className="text-sm font-medium text-[#374151]">Mileage *</Label>
                      <Input id="rv-trade-mileage" type="number" min={0} data-testid="rv-trade-mileage" className="mt-1.5" value={tradeMileage} onChange={(e) => setTradeMileage(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="rv-trade-color" className="text-sm font-medium text-[#374151]">Color (optional)</Label>
                      <Input id="rv-trade-color" data-testid="rv-trade-color" className="mt-1.5" value={tradeColor} onChange={(e) => setTradeColor(e.target.value)} />
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium text-[#374151] block mb-2">Is the vehicle paid off?</Label>
                    <YesNoToggle value={tradePaidOff} onChange={setTradePaidOff} testId="rv-trade-paid" />
                  </div>
                  {tradePaidOff === false && (
                    <div>
                      <Label htmlFor="rv-trade-balance" className="text-sm font-medium text-[#374151]">Remaining Loan Balance</Label>
                      <Input id="rv-trade-balance" type="number" min={0} data-testid="rv-trade-balance" className="mt-1.5" placeholder="$" value={tradeLoanBalance} onChange={(e) => setTradeLoanBalance(e.target.value)} />
                    </div>
                  )}

                  <div>
                    <Label htmlFor="rv-trade-issues" className="text-sm font-medium text-[#374151]">Known Issues or Damage (optional)</Label>
                    <Textarea id="rv-trade-issues" data-testid="rv-trade-issues" className="mt-1.5" rows={3} value={tradeIssues} onChange={(e) => setTradeIssues(e.target.value.slice(0, 1000))} maxLength={1000} />
                  </div>

                  <div>
                    <Label className="text-sm font-medium text-[#374151] block mb-2">Title Status</Label>
                    <ToggleRow options={TITLE_STATUSES} value={tradeTitleStatus} onChange={setTradeTitleStatus} testIdPrefix="rv-trade-title" cols={4} />
                  </div>
                </div>
              )}
            </div>

            {/* §6 Notes + consent */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6 md:p-8">
              <SectionHeader num={6} title="Notes &amp; Consent" />
              <div>
                <Label htmlFor="rv-notes" className="text-sm font-medium text-[#374151]">Additional Notes (optional)</Label>
                <Textarea id="rv-notes" data-testid="rv-notes" className="mt-1.5" rows={4} value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 1000))} maxLength={1000} />
                <p className="text-xs text-slate-400 mt-1 text-right">{notes.length}/1000</p>
              </div>

              <label className="flex items-start gap-2 cursor-pointer select-none mt-4" data-testid="rv-consent-label">
                <input
                  type="checkbox"
                  checked={agreedToContact}
                  onChange={(e) => setAgreedToContact(e.target.checked)}
                  className="h-4 w-4 mt-0.5 rounded border-slate-300 text-[#0B5FD1] focus:ring-[#0B5FD1]/30"
                  data-testid="rv-consent-checkbox"
                />
                <span className="text-xs text-slate-600 leading-relaxed">
                  I agree to be contacted by AutoLenis about my vehicle request. My information will not be shared with third parties without my consent.
                </span>
              </label>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-700" data-testid="rv-error">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold"
              disabled={!canSubmit}
              data-testid="rv-submit"
            >
              {loading ? <><Loader2 size={16} className="animate-spin mr-2" />Submitting…</> : "Submit Vehicle Request →"}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
