"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, ChevronRight, ChevronLeft, Upload, AlertCircle,
  User, Building2, FileText, CreditCard, FolderOpen, ClipboardList,
} from "lucide-react";

interface OnboardingWizardProps {
  affiliateId: string;
  email: string;
  initialStep: number;
  onboarding: {
    id: string;
    affiliateId: string;
    status: string;
    currentStep: number;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    decisionNote: string | null;
    internalNotes: string | null;
    correctionItems: string[];
    createdAt: Date;
    updatedAt: Date;
  };
  profile: {
    review: { status: string; currentStep: number } | null;
    profile: {
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      dateOfBirth: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      entityType: string | null;
      businessName: string | null;
      dbaName: string | null;
      businessAddress: string | null;
      einLast4: string | null;
    } | null;
    taxProfile: {
      taxClassification: string | null;
      tinType: string | null;
      tinLast4: string | null;
      legalName: string | null;
      certified: boolean;
    } | null;
    paymentProfile: {
      payoutMethod: string | null;
      holderName: string | null;
      routingLast4: string | null;
      accountLast4: string | null;
      accountType: string | null;
      paypalEmail: string | null;
      zellePhone: string | null;
    } | null;
    documents: { type: string; status: string }[];
  };
}

const STEPS = [
  { number: 1, label: "Welcome",    icon: ClipboardList },
  { number: 2, label: "Personal",   icon: User },
  { number: 3, label: "Business",   icon: Building2 },
  { number: 4, label: "Tax / W-9",  icon: FileText },
  { number: 5, label: "Banking",    icon: CreditCard },
  { number: 6, label: "Documents",  icon: FolderOpen },
  { number: 7, label: "Review",     icon: CheckCircle2 },
];

const TOTAL = STEPS.length;

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-slate-700 mb-1">
      {children}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/40 focus:border-al-primary ${props.className ?? ""}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/40 focus:border-al-primary bg-white ${props.className ?? ""}`}
    />
  );
}

export default function OnboardingWizard({ affiliateId: _affiliateId, email, initialStep, onboarding, profile }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 1), TOTAL));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(onboarding.status === "SUBMITTED" || onboarding.status === "APPROVED" || onboarding.status === "UNDER_REVIEW");

  // Step 2 state
  const [firstName, setFirstName]     = useState(profile.profile?.firstName ?? "");
  const [lastName, setLastName]       = useState(profile.profile?.lastName ?? "");
  const [phone, setPhone]             = useState(profile.profile?.phone ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(profile.profile?.dateOfBirth ?? "");
  const [address1, setAddress1]       = useState(profile.profile?.addressLine1 ?? "");
  const [address2, setAddress2]       = useState(profile.profile?.addressLine2 ?? "");
  const [city, setCity]               = useState(profile.profile?.city ?? "");
  const [state, setState]             = useState(profile.profile?.state ?? "");
  const [zip, setZip]                 = useState(profile.profile?.zip ?? "");

  // Step 3 state
  const [entityType, setEntityType]           = useState(profile.profile?.entityType ?? "");
  const [businessName, setBusinessName]       = useState(profile.profile?.businessName ?? "");
  const [dbaName, setDbaName]                 = useState(profile.profile?.dbaName ?? "");
  const [businessAddress, setBusinessAddress] = useState(profile.profile?.businessAddress ?? "");
  const [einLast4, setEinLast4]               = useState(profile.profile?.einLast4 ?? "");

  // Step 4 state
  const [taxClass, setTaxClass]     = useState(profile.taxProfile?.taxClassification ?? "");
  const [tinType, setTinType]       = useState(profile.taxProfile?.tinType ?? "");
  const [tinLast4, setTinLast4]     = useState(profile.taxProfile?.tinLast4 ?? "");
  const [legalName, setLegalName]   = useState(profile.taxProfile?.legalName ?? "");
  const [certified, setCertified]   = useState(profile.taxProfile?.certified ?? false);
  const [signature, setSignature]   = useState("");

  // Step 5 state
  const [payoutMethod, setPayoutMethod] = useState(profile.paymentProfile?.payoutMethod ?? "");
  const [holderName, setHolderName]     = useState(profile.paymentProfile?.holderName ?? "");
  const [routingLast4, setRoutingLast4] = useState(profile.paymentProfile?.routingLast4 ?? "");
  const [accountLast4, setAccountLast4] = useState(profile.paymentProfile?.accountLast4 ?? "");
  const [accountType, setAccountType]   = useState(profile.paymentProfile?.accountType ?? "");
  const [paypalEmail, setPaypalEmail]   = useState(profile.paymentProfile?.paypalEmail ?? "");
  const [zellePhone, setZellePhone]     = useState(profile.paymentProfile?.zellePhone ?? "");

  // Step 6 state
  const [uploadFile, setUploadFile]   = useState<File | null>(null);
  const [docType, setDocType]         = useState("GOVERNMENT_ID");
  const [uploadSuccess, setUploadSuccess] = useState(profile.documents.length > 0);

  const goTo = (n: number) => {
    setError(null);
    setStep(n);
    router.replace(`/affiliate/portal/onboarding?step=${n}`, { scroll: false });
  };

  async function saveStep2() {
    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !address1.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      setError("Please fill in all required fields.");
      return false;
    }
    const res = await fetch("/api/affiliate/onboarding/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: 2, firstName, lastName, phone, dateOfBirth: dateOfBirth || undefined, addressLine1: address1, addressLine2: address2 || null, city, state, zip }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error?.message ?? "Save failed"); return false; }
    return true;
  }

  async function saveStep3() {
    if (!entityType) { setError("Please select an entity type."); return false; }
    const res = await fetch("/api/affiliate/onboarding/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: 3, entityType, businessName: businessName || null, dbaName: dbaName || null, businessAddress: businessAddress || null, einLast4: einLast4 || null }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error?.message ?? "Save failed"); return false; }
    return true;
  }

  async function saveStep4() {
    if (!taxClass || !tinType || tinLast4.length !== 4 || !legalName.trim() || !certified || !signature.trim()) {
      setError("Please complete all fields and check the certification box.");
      return false;
    }
    const res = await fetch("/api/affiliate/onboarding/tax", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taxClassification: taxClass, tinType, tinLast4, legalName, certified, signature }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error?.message ?? "Save failed"); return false; }
    return true;
  }

  async function saveStep5() {
    if (!payoutMethod) { setError("Please select a payout method."); return false; }
    if ((payoutMethod === "ACH" || payoutMethod === "CHECK") && (!holderName.trim() || routingLast4.length !== 4 || accountLast4.length !== 4 || !accountType)) {
      setError("Please fill in all banking details."); return false;
    }
    if (payoutMethod === "PAYPAL" && !paypalEmail.trim()) { setError("PayPal email is required."); return false; }
    if (payoutMethod === "ZELLE" && !zellePhone.trim()) { setError("Zelle phone is required."); return false; }
    const body: Record<string, string> = { payoutMethod };
    if (holderName) body.holderName = holderName;
    if (routingLast4) body.routingLast4 = routingLast4;
    if (accountLast4) body.accountLast4 = accountLast4;
    if (accountType) body.accountType = accountType;
    if (paypalEmail) body.paypalEmail = paypalEmail;
    if (zellePhone) body.zellePhone = zellePhone;
    const res = await fetch("/api/affiliate/onboarding/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error?.message ?? "Save failed"); return false; }
    return true;
  }

  async function uploadDocument() {
    if (!uploadFile) { setError("Please select a file to upload."); return false; }
    const fd = new FormData();
    fd.append("file", uploadFile);
    fd.append("type", docType);
    const res = await fetch("/api/affiliate/onboarding/documents/upload", { method: "POST", body: fd });
    if (!res.ok) { const d = await res.json(); setError(d.error?.message ?? "Upload failed"); return false; }
    setUploadSuccess(true);
    setUploadFile(null);
    return true;
  }

  async function handleNext() {
    setError(null);
    setLoading(true);
    try {
      if (step === 2 && !(await saveStep2())) return;
      if (step === 3 && !(await saveStep3())) return;
      if (step === 4 && !(await saveStep4())) return;
      if (step === 5 && !(await saveStep5())) return;
      if (step === 6) {
        if (!uploadSuccess && !(await uploadDocument())) return;
      }
      if (step < TOTAL) goTo(step + 1);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/affiliate/onboarding/submit", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message ?? "Submission failed"); return; }
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-10 max-w-md w-full text-center shadow-sm">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-green-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Onboarding Complete!</h1>
          <p className="text-sm text-slate-600 mb-6">
            Your affiliate account is active. Head to your dashboard to grab your referral link and start earning.
          </p>
          <button
            onClick={() => router.push("/affiliate/portal/dashboard")}
            className="w-full bg-al-primary text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-al-primary/90 transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Affiliate Onboarding</h1>
          <p className="text-sm text-slate-500 mt-1">Complete all steps to activate your account for payouts.</p>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = s.number < step;
            const active = s.number === step;
            return (
              <div key={s.number} className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => s.number < step && goTo(s.number)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    active ? "bg-al-primary text-white" :
                    done   ? "bg-al-primary/10 text-al-primary cursor-pointer hover:bg-al-primary/20" :
                             "bg-slate-100 text-slate-400 cursor-default"
                  }`}
                  disabled={s.number > step}
                >
                  {done ? <CheckCircle2 size={12} /> : <Icon size={12} />}
                  <span className="hidden sm:inline">{s.label}</span>
                  <span className="sm:hidden">{s.number}</span>
                </button>
                {i < STEPS.length - 1 && <div className={`w-4 h-px ${done ? "bg-al-primary" : "bg-slate-200"}`} />}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 shadow-sm">

          {/* Step 1: Welcome */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Welcome, {email}!</h2>
              <p className="text-sm text-slate-600 mb-6">
                To receive commission payouts, we need to verify your identity and collect tax information. This process typically takes 10–15 minutes.
              </p>
              <div className="space-y-3 mb-6">
                {[
                  { n: 2, label: "Personal Information", desc: "Name, address, and contact details" },
                  { n: 3, label: "Business Profile",     desc: "Entity type and business details" },
                  { n: 4, label: "Tax / W-9",            desc: "TIN, legal name, and IRS certification" },
                  { n: 5, label: "Banking & Payout",     desc: "Bank account or PayPal/Zelle" },
                  { n: 6, label: "Identity Document",    desc: "Government-issued photo ID" },
                ].map(item => (
                  <div key={item.n} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                    <div className="w-6 h-6 bg-al-primary text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{item.n}</div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                      <p className="text-xs text-slate-500">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                Your information is encrypted and securely stored. We only retain the last 4 digits of sensitive numbers.
              </p>
            </div>
          )}

          {/* Step 2: Personal Information */}
          {step === 2 && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Personal Information</h2>
              <p className="text-sm text-slate-500 mb-6">Legal name and mailing address for tax documents.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label required>First Name</Label>
                  <Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="John" />
                </div>
                <div>
                  <Label required>Last Name</Label>
                  <Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Smith" />
                </div>
                <div>
                  <Label required>Phone</Label>
                  <Input value={phone} onChange={e => setPhone(e.target.value)} type="tel" placeholder="(555) 000-0000" />
                </div>
                <div>
                  <Label>Date of Birth</Label>
                  <Input value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} type="date" />
                </div>
                <div className="col-span-2">
                  <Label required>Address Line 1</Label>
                  <Input value={address1} onChange={e => setAddress1(e.target.value)} placeholder="123 Main St" />
                </div>
                <div className="col-span-2">
                  <Label>Address Line 2</Label>
                  <Input value={address2} onChange={e => setAddress2(e.target.value)} placeholder="Apt 4B (optional)" />
                </div>
                <div>
                  <Label required>City</Label>
                  <Input value={city} onChange={e => setCity(e.target.value)} placeholder="Austin" />
                </div>
                <div>
                  <Label required>State</Label>
                  <Input value={state} onChange={e => setState(e.target.value)} placeholder="TX" maxLength={2} />
                </div>
                <div>
                  <Label required>ZIP Code</Label>
                  <Input value={zip} onChange={e => setZip(e.target.value)} placeholder="78701" maxLength={10} />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Business Profile */}
          {step === 3 && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Business Profile</h2>
              <p className="text-sm text-slate-500 mb-6">How you operate as an affiliate (individual or business entity).</p>
              <div className="space-y-4">
                <div>
                  <Label required>Entity Type</Label>
                  <Select value={entityType} onChange={e => setEntityType(e.target.value)}>
                    <option value="">Select entity type…</option>
                    <option value="INDIVIDUAL">Individual / Sole Proprietor</option>
                    <option value="LLC">LLC</option>
                    <option value="CORPORATION">Corporation</option>
                    <option value="PARTNERSHIP">Partnership</option>
                    <option value="S_CORP">S-Corporation</option>
                  </Select>
                </div>
                <div>
                  <Label>Business Name</Label>
                  <Input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Acme Autos LLC (if applicable)" />
                </div>
                <div>
                  <Label>DBA Name</Label>
                  <Input value={dbaName} onChange={e => setDbaName(e.target.value)} placeholder="Doing business as… (optional)" />
                </div>
                <div>
                  <Label>Business Address</Label>
                  <Input value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} placeholder="Same as personal or different" />
                </div>
                {entityType !== "INDIVIDUAL" && (
                  <div>
                    <Label>EIN (last 4 digits only)</Label>
                    <Input value={einLast4} onChange={e => setEinLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" maxLength={4} className="max-w-[120px]" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Tax / W-9 */}
          {step === 4 && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Tax Information (W-9)</h2>
              <p className="text-sm text-slate-500 mb-6">Required by the IRS for payments over $600/year. We only store the last 4 digits of your TIN.</p>
              <div className="space-y-4">
                <div>
                  <Label required>Tax Classification</Label>
                  <Select value={taxClass} onChange={e => setTaxClass(e.target.value)}>
                    <option value="">Select classification…</option>
                    <option value="individual">Individual / Sole Proprietor</option>
                    <option value="llc_single">Single-member LLC</option>
                    <option value="llc_multi">Multi-member LLC</option>
                    <option value="corporation">C Corporation</option>
                    <option value="s_corp">S Corporation</option>
                    <option value="partnership">Partnership</option>
                  </Select>
                </div>
                <div>
                  <Label required>TIN Type</Label>
                  <Select value={tinType} onChange={e => setTinType(e.target.value)}>
                    <option value="">Select type…</option>
                    <option value="SSN">SSN (Social Security Number)</option>
                    <option value="EIN">EIN (Employer ID Number)</option>
                  </Select>
                </div>
                <div>
                  <Label required>Last 4 digits of TIN</Label>
                  <Input value={tinLast4} onChange={e => setTinLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 5678" maxLength={4} className="max-w-[120px]" />
                  <p className="text-xs text-slate-400 mt-1">We never store your full TIN — only the last 4 digits.</p>
                </div>
                <div>
                  <Label required>Legal Name (as on tax return)</Label>
                  <Input value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="Full legal name" />
                </div>
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <p className="font-semibold mb-1">IRS Certification</p>
                  <p>Under penalties of perjury, I certify that: (1) The number shown is my correct taxpayer identification number; (2) I am not subject to backup withholding; (3) I am a U.S. citizen or other U.S. person; (4) The FATCA code (if any) is correct.</p>
                </div>
                <div>
                  <Label required>Electronic Signature (type your full name)</Label>
                  <Input value={signature} onChange={e => setSignature(e.target.value)} placeholder="Your full legal name" />
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={certified} onChange={e => setCertified(e.target.checked)} className="mt-0.5 w-4 h-4 accent-al-primary" />
                  <span className="text-sm text-slate-700">I certify the above statements under penalties of perjury and agree that this electronic signature is legally binding.</span>
                </label>
              </div>
            </div>
          )}

          {/* Step 5: Banking & Payout */}
          {step === 5 && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Banking &amp; Payout</h2>
              <p className="text-sm text-slate-500 mb-6">How you&apos;d like to receive commission payments. Only the last 4 digits of account numbers are stored.</p>
              <div className="space-y-4">
                <div>
                  <Label required>Payout Method</Label>
                  <Select value={payoutMethod} onChange={e => setPayoutMethod(e.target.value)}>
                    <option value="">Select method…</option>
                    <option value="ACH">ACH / Direct Deposit</option>
                    <option value="CHECK">Paper Check</option>
                    <option value="PAYPAL">PayPal</option>
                    <option value="ZELLE">Zelle</option>
                  </Select>
                </div>
                {(payoutMethod === "ACH" || payoutMethod === "CHECK") && (
                  <>
                    <div>
                      <Label required>Account Holder Name</Label>
                      <Input value={holderName} onChange={e => setHolderName(e.target.value)} placeholder="Full name on account" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label required>Routing (last 4)</Label>
                        <Input value={routingLast4} onChange={e => setRoutingLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" maxLength={4} />
                      </div>
                      <div>
                        <Label required>Account (last 4)</Label>
                        <Input value={accountLast4} onChange={e => setAccountLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="5678" maxLength={4} />
                      </div>
                    </div>
                    <div>
                      <Label required>Account Type</Label>
                      <Select value={accountType} onChange={e => setAccountType(e.target.value)}>
                        <option value="">Select…</option>
                        <option value="CHECKING">Checking</option>
                        <option value="SAVINGS">Savings</option>
                      </Select>
                    </div>
                  </>
                )}
                {payoutMethod === "PAYPAL" && (
                  <div>
                    <Label required>PayPal Email</Label>
                    <Input value={paypalEmail} onChange={e => setPaypalEmail(e.target.value)} type="email" placeholder="you@paypal.com" />
                  </div>
                )}
                {payoutMethod === "ZELLE" && (
                  <div>
                    <Label required>Zelle Phone Number</Label>
                    <Input value={zellePhone} onChange={e => setZellePhone(e.target.value)} type="tel" placeholder="(555) 000-0000" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 6: Documents */}
          {step === 6 && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Identity Document</h2>
              <p className="text-sm text-slate-500 mb-6">Upload a government-issued ID (driver&apos;s license, passport, or state ID). PDF, JPG, PNG, or WEBP, max 10 MB.</p>
              {uploadSuccess ? (
                <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
                  <CheckCircle2 size={20} />
                  <div>
                    <p className="font-semibold text-sm">Document uploaded successfully.</p>
                    <p className="text-xs text-green-600 mt-0.5">You can proceed to the next step.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label required>Document Type</Label>
                    <Select value={docType} onChange={e => setDocType(e.target.value)}>
                      <option value="GOVERNMENT_ID">Government-Issued ID</option>
                      <option value="W9">W-9 Form</option>
                      <option value="VOIDED_CHECK">Voided Check</option>
                      <option value="BUSINESS_LICENSE">Business License</option>
                      <option value="OTHER">Other</option>
                    </Select>
                  </div>
                  <div>
                    <Label required>File</Label>
                    <label className="block border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-al-primary/50 transition-colors">
                      <Upload size={24} className="mx-auto mb-2 text-slate-400" />
                      <p className="text-sm font-medium text-slate-700">{uploadFile ? uploadFile.name : "Click to select file"}</p>
                      <p className="text-xs text-slate-400 mt-1">PDF, JPG, PNG, WEBP — max 10 MB</p>
                      <input
                        type="file"
                        className="sr-only"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 7: Review & Submit */}
          {step === 7 && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Review &amp; Submit</h2>
              <p className="text-sm text-slate-500 mb-6">Please review your information before completing onboarding.</p>
              <div className="space-y-4">
                {[
                  {
                    title: "Personal Information",
                    href:  "/affiliate/portal/onboarding?step=2",
                    items: [
                      { label: "Name",    val: [profile.profile?.firstName ?? firstName, profile.profile?.lastName ?? lastName].filter(Boolean).join(" ") },
                      { label: "Phone",   val: profile.profile?.phone ?? phone },
                      { label: "Address", val: [profile.profile?.addressLine1 ?? address1, profile.profile?.city ?? city, profile.profile?.state ?? state].filter(Boolean).join(", ") },
                    ],
                  },
                  {
                    title: "Business Profile",
                    href:  "/affiliate/portal/onboarding?step=3",
                    items: [
                      { label: "Entity Type", val: profile.profile?.entityType ?? entityType },
                      { label: "Business",    val: (profile.profile?.businessName ?? businessName) || "—" },
                    ],
                  },
                  {
                    title: "Tax / W-9",
                    href:  "/affiliate/portal/onboarding?step=4",
                    items: [
                      { label: "Classification", val: profile.taxProfile?.taxClassification ?? taxClass },
                      { label: "TIN (last 4)",   val: (profile.taxProfile?.tinLast4 ?? tinLast4) ? `···${profile.taxProfile?.tinLast4 ?? tinLast4}` : "—" },
                      { label: "Certified",      val: (profile.taxProfile?.certified ?? certified) ? "Yes" : "No" },
                    ],
                  },
                  {
                    title: "Banking & Payout",
                    href:  "/affiliate/portal/onboarding?step=5",
                    items: [
                      { label: "Method",  val: profile.paymentProfile?.payoutMethod ?? payoutMethod },
                      { label: "Account", val: (profile.paymentProfile?.accountLast4 ?? accountLast4) ? `···${profile.paymentProfile?.accountLast4 ?? accountLast4}` : (profile.paymentProfile?.paypalEmail ?? paypalEmail) || "—" },
                    ],
                  },
                  {
                    title: "Documents",
                    href:  "/affiliate/portal/onboarding?step=6",
                    items: [
                      { label: "Identity Document", val: uploadSuccess || profile.documents.length > 0 ? "Uploaded ✓" : "Not uploaded" },
                    ],
                  },
                ].map(section => (
                  <div key={section.title} className="border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-slate-800">{section.title}</p>
                      <button onClick={() => goTo(parseInt(section.href.split("step=")[1]))} className="text-xs text-al-primary hover:underline">Edit</button>
                    </div>
                    <dl className="space-y-1.5">
                      {section.items.map(item => (
                        <div key={item.label} className="flex items-center justify-between text-sm">
                          <dt className="text-slate-500">{item.label}</dt>
                          <dd className="text-slate-800 font-medium">{item.val || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-4">
                By submitting, you confirm that all information provided is accurate and complete.
              </p>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
            <button
              onClick={() => step > 1 && goTo(step - 1)}
              disabled={step === 1 || loading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} /> Back
            </button>

            {step < TOTAL ? (
              <button
                onClick={handleNext}
                disabled={loading}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-al-primary text-white rounded-lg text-sm font-semibold hover:bg-al-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Saving…" : "Continue"} <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-al-primary text-white rounded-lg text-sm font-semibold hover:bg-al-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Submitting…" : "Submit Application"} <CheckCircle2 size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
