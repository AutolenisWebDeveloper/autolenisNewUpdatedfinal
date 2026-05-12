"use client";

import { useState } from "react";
import Link from "next/link";
import { Select } from "@/components/ui/select";
import { ArrowLeft, ClipboardList, Phone, Mail, MapPin, Car, DollarSign, Wallet, FileText, ExternalLink } from "lucide-react";

export type RequestMeta = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  zip?: string;
  city?: string;
  state?: string;
  contactMethod?: string;
  timeline?: string;

  vehicleType?: string;
  preferredMake?: string;
  preferredModel?: string;
  customMakeModel?: string;
  minYear?: number;
  maxYear?: number;
  newOrUsed?: string;
  specificFeatures?: string;
  interiorColor?: string;
  mustHaveFeatures?: string;
  openToAlternatives?: boolean;

  budget?: string;
  desiredMonthly?: string;
  downPaymentAvail?: string;
  financingOption?: string;
  employmentStatus?: string;
  employerName?: string;
  annualIncome?: string;
  creditScore?: string;
  downPayment?: string;
  monthlyPayment?: string;
  monthlyIncome?: string;
  housingPayment?: string;
  coBuyer?: boolean;
  lenderName?: string;
  approvedAmount?: string;
  apr?: string;
  preApprovalExpiry?: string;
  preApprovalFileUrl?: string | null;

  hasTradeIn?: boolean;
  tradeYear?: string;
  tradeMake?: string;
  tradeModel?: string;
  tradeTrim?: string;
  tradeMileage?: string;
  tradeColor?: string;
  tradeCondition?: string;
  tradeVin?: string;
  tradePaidOff?: boolean;
  tradeLoanBalance?: string;
  tradePayoffAmount?: string;
  tradeIssues?: string;
  tradeTitleStatus?: string;
  tradeAccidentHistory?: string;

  notes?: string;
  requestStatus?: string;
};

const STATUSES = [
  "new",
  "sent_to_dealers",
  "offers_in",
  "sent_to_buyer",
  "buyer_interested",
  "closed",
  "lost",
] as const;

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  sent_to_dealers: "Sent to Dealers",
  offers_in: "Offers In",
  sent_to_buyer: "Sent to Buyer",
  buyer_interested: "Buyer Interested",
  closed: "Closed",
  lost: "Lost",
};

const STATUS_TONE: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 border-blue-200",
  sent_to_dealers: "bg-amber-100 text-amber-700 border-amber-200",
  offers_in: "bg-violet-100 text-violet-700 border-violet-200",
  sent_to_buyer: "bg-cyan-100 text-cyan-700 border-cyan-200",
  buyer_interested: "bg-green-100 text-green-700 border-green-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
  lost: "bg-red-100 text-red-700 border-red-200",
};

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5">
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
        <span className="text-[#0B5FD1]">{icon}</span>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">{title}</p>
      </div>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className="text-slate-900 font-medium text-right text-xs">{value}</span>
    </div>
  );
}

export default function VehicleRequestDetailClient({
  requestId,
  submittedAt,
  meta,
}: {
  requestId: string;
  submittedAt: string;
  meta: RequestMeta;
}) {
  const [status, setStatus] = useState(meta.requestStatus ?? "new");
  const [updating, setUpdating] = useState(false);

  async function updateStatus(newStatus: string) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/vehicle-requests/${requestId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestStatus: newStatus }),
      });
      if (res.ok) setStatus(newStatus);
    } finally {
      setUpdating(false);
    }
  }

  const fullName = (meta.fullName ?? [meta.firstName, meta.lastName].filter(Boolean).join(" ")) || "Unknown";

  return (
    <div className="p-6 md:p-8 max-w-5xl pb-20" data-testid="vehicle-request-detail-page">
      <Link
        href="/admin/vehicle-requests"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#0B5FD1] mb-4"
      >
        <ArrowLeft size={14} /> Back to Vehicle Requests
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList size={20} className="text-[#0B5FD1]" />
            <h1 className="text-2xl font-bold text-slate-900">{fullName}</h1>
          </div>
          <p className="text-sm text-slate-500">Submitted: {new Date(submittedAt).toLocaleString()}</p>
          <span className={`mt-2 inline-flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${STATUS_TONE[status] ?? STATUS_TONE.new}`}>
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Status:</span>
            <Select
              value={status}
              onChange={(e) => updateStatus(e.target.value)}
              disabled={updating}
              className="w-44 text-xs"
              data-testid="request-status-select"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </div>
          <Link
            href={`/admin/vehicle-offers/new?fromRequest=${requestId}`}
            data-testid="create-offer-link-btn"
            className="inline-flex items-center gap-2 bg-[#0B5FD1] text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#0944a8]"
          >
            Create Offer Link →
          </Link>
          <Link
            href={`/admin/vehicle-requests/${requestId}/send-to-dealers`}
            data-testid="send-to-dealers-btn"
            className="inline-flex items-center gap-2 border border-[#0B5FD1] text-[#0B5FD1] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#0B5FD1]/5"
          >
            Send to Dealers →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card icon={<Phone size={14} />} title="Buyer Contact">
          <Row label="Name" value={fullName} />
          <Row label="Email" value={<a href={`mailto:${meta.email}`} className="text-[#0B5FD1] hover:underline">{meta.email}</a>} />
          <Row label="Phone" value={<a href={`tel:${meta.phone}`} className="text-[#0B5FD1] hover:underline">{meta.phone}</a>} />
          <Row label="Location" value={`${meta.city ?? ""}${meta.city && meta.state ? ", " : ""}${meta.state ?? ""} ${meta.zip ?? ""}`.trim()} />
          <Row label="Preferred Contact" value={meta.contactMethod} />
          <Row label="Buying Timeline" value={meta.timeline} />
        </Card>

        <Card icon={<Car size={14} />} title="Vehicle Request">
          <Row label="Type" value={meta.vehicleType} />
          <Row
            label="Make / Model"
            value={
              meta.preferredMake === "Other"
                ? meta.customMakeModel
                : [meta.preferredMake ?? "Any", meta.preferredModel].filter(Boolean).join(" ")
            }
          />
          <Row label="Year Range" value={`${meta.minYear ?? "Any"} – ${meta.maxYear ?? "Any"}`} />
          <Row label="New or Used" value={meta.newOrUsed} />
          <Row label="Interior Color" value={meta.interiorColor} />
          <Row label="Specific Features" value={meta.specificFeatures} />
          <Row label="Must-Have Features" value={meta.mustHaveFeatures} />
          <Row
            label="Open to Alternatives"
            value={typeof meta.openToAlternatives === "boolean" ? (meta.openToAlternatives ? "Yes" : "No — specific only") : undefined}
          />
        </Card>

        <Card icon={<Wallet size={14} />} title="Budget & Financing">
          <Row label="Maximum Budget" value={meta.budget} />
          <Row label="Monthly Goal" value={meta.desiredMonthly} />
          <Row label="Down Payment Available" value={meta.downPaymentAvail} />
          <Row
            label="Financing Status"
            value={
              meta.financingOption === "need_financing"
                ? "Needs Financing"
                : meta.financingOption === "have_financing"
                ? "Pre-Approved"
                : meta.financingOption === "no_financing"
                ? "Paying Cash"
                : undefined
            }
          />
          {meta.financingOption === "need_financing" && (
            <>
              <Row label="Employment" value={meta.employmentStatus} />
              <Row label="Employer" value={meta.employerName} />
              <Row label="Annual Income" value={meta.annualIncome} />
              <Row label="Monthly Income" value={meta.monthlyIncome} />
              <Row label="Housing Payment" value={meta.housingPayment} />
              <Row label="Credit Score" value={meta.creditScore} />
              <Row label="Desired Down Payment" value={meta.downPayment} />
              <Row label="Monthly Payment Target" value={meta.monthlyPayment} />
              <Row label="Co-Buyer" value={typeof meta.coBuyer === "boolean" ? (meta.coBuyer ? "Yes" : "No") : undefined} />
            </>
          )}
          {meta.financingOption === "have_financing" && (
            <>
              <Row label="Lender" value={meta.lenderName} />
              <Row label="Approved Amount" value={meta.approvedAmount ? `$${Number(meta.approvedAmount).toLocaleString()}` : undefined} />
              <Row label="APR" value={meta.apr ? `${meta.apr}%` : undefined} />
              <Row label="Expiry" value={meta.preApprovalExpiry} />
              {meta.preApprovalFileUrl && (
                <Row
                  label="Pre-Approval Letter"
                  value={
                    <a href={meta.preApprovalFileUrl} target="_blank" rel="noopener noreferrer" className="text-[#0B5FD1] hover:underline inline-flex items-center gap-1">
                      <ExternalLink size={11} /> View
                    </a>
                  }
                />
              )}
            </>
          )}
        </Card>

        {meta.hasTradeIn === true && (
          <Card icon={<DollarSign size={14} />} title="Trade-In">
            <Row label="Vehicle" value={[meta.tradeYear, meta.tradeMake, meta.tradeModel, meta.tradeTrim].filter(Boolean).join(" ")} />
            <Row label="Mileage" value={meta.tradeMileage ? `${Number(meta.tradeMileage).toLocaleString()} mi` : undefined} />
            <Row label="Color" value={meta.tradeColor} />
            <Row label="Condition" value={meta.tradeCondition} />
            <Row label="VIN" value={meta.tradeVin} />
            <Row label="Title Status" value={meta.tradeTitleStatus} />
            <Row label="Accident History" value={meta.tradeAccidentHistory} />
            <Row label="Paid Off" value={typeof meta.tradePaidOff === "boolean" ? (meta.tradePaidOff ? "Yes" : "No") : undefined} />
            <Row
              label="Payoff Amount"
              value={
                (meta.tradePayoffAmount ?? meta.tradeLoanBalance)
                  ? `$${Number(meta.tradePayoffAmount ?? meta.tradeLoanBalance).toLocaleString()}`
                  : undefined
              }
            />
            <Row label="Issues / Damage" value={meta.tradeIssues} />
          </Card>
        )}

        {meta.notes && (
          <Card icon={<FileText size={14} />} title="Buyer Notes">
            <p className="text-slate-700 whitespace-pre-line">{meta.notes}</p>
          </Card>
        )}

        {!meta.email || !meta.phone ? null : (
          <Card icon={<MapPin size={14} />} title="Quick Actions">
            <a
              href={`mailto:${meta.email}`}
              className="block text-[#0B5FD1] hover:underline text-xs"
            >
              📧 Email {meta.email}
            </a>
            <a
              href={`tel:${meta.phone}`}
              className="block text-[#0B5FD1] hover:underline text-xs"
            >
              📞 Call {meta.phone}
            </a>
          </Card>
        )}
      </div>
    </div>
  );
}
