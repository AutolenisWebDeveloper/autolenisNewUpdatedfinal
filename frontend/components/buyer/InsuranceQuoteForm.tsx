"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";

const MIN_DRIVER_AGE_YEARS = 16;
const MIN_DRIVER_AGE_MS    = MIN_DRIVER_AGE_YEARS * 365.25 * 24 * 3600 * 1000;

interface VehicleInfo {
  year:          number;
  make:          string;
  model:         string;
  trim:          string | null;
  vin:           string | null;
  exteriorColor: string | null;
  mileage:       number | null;
  otdPriceCents: number | null;
}

interface Props {
  dealId:  string;
  vehicle: VehicleInfo | null;
}

export default function InsuranceQuoteForm({ dealId, vehicle }: Props) {
  const router = useRouter();

  const [expanded,        setExpanded]       = useState(false);
  const [loading,         setLoading]        = useState(false);
  const [error,           setError]          = useState<string | null>(null);
  const [success,         setSuccess]        = useState(false);

  const [coverageType,    setCoverageType]   = useState("full");
  const [currentInsurer,  setCurrentInsurer] = useState("");
  const [driverDob,       setDriverDob]      = useState("");
  const [additionalInfo,  setAdditionalInfo] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/buyer/insurance/request-quote", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          coverageType,
          currentInsurer: currentInsurer.trim() || null,
          driverDob:      driverDob || null,
          additionalInfo: additionalInfo.trim() || null,
        }),
      });
      const data = await res.json() as { success: boolean; error?: { message: string } };

      if (!data.success) {
        setError(data.error?.message ?? "Submission failed. Please try again.");
      } else {
        setSuccess(true);
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <p className="text-sm font-semibold text-[#10B981]" data-testid="quote-request-success">
        ✓ Quote request submitted — our team will respond within 1 business day.
      </p>
    );
  }

  return (
    <div data-testid="insurance-quote-form-container">
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-2 text-sm font-semibold text-[#0B5FD1] hover:text-[#0A4DB8] transition-colors"
        data-testid="expand-quote-form-btn"
      >
        {expanded ? "Cancel" : "Request a Quote"}
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 space-y-4 border-t border-[#E5E7EB] pt-4"
          data-testid="insurance-quote-form"
        >
          {/* Vehicle summary — read-only, auto-filled */}
          {vehicle && (
            <div className="bg-[#F8F9FB] rounded-lg px-4 py-3 text-sm">
              <p className="text-xs font-semibold text-[#6B7280] mb-1">Vehicle (auto-filled)</p>
              <p className="font-medium text-[#111827]">
                {vehicle.year} {vehicle.make} {vehicle.model}
                {vehicle.trim ? ` ${vehicle.trim}` : ""}
              </p>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-[#6B7280]">
                {vehicle.vin           && <span>VIN: {vehicle.vin}</span>}
                {vehicle.exteriorColor && <span>{vehicle.exteriorColor}</span>}
                {vehicle.mileage       && <span>{vehicle.mileage.toLocaleString()} mi</span>}
                {vehicle.otdPriceCents && (
                  <span>Value: ${(vehicle.otdPriceCents / 100).toLocaleString()}</span>
                )}
              </div>
            </div>
          )}

          {/* Coverage type */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">
              Coverage type <span className="text-red-500">*</span>
            </label>
            <select
              value={coverageType}
              onChange={e => setCoverageType(e.target.value)}
              required
              data-testid="quote-coverage-type"
              className="w-full border border-[#D1D5DB] rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0B5FD1] focus:border-transparent"
            >
              <option value="full">Full coverage (comprehensive + collision)</option>
              <option value="liability">Liability only</option>
              <option value="gap">Full coverage + GAP</option>
            </select>
          </div>

          {/* Current insurer (optional) */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">
              Current insurer (if any)
            </label>
            <input
              type="text"
              value={currentInsurer}
              onChange={e => setCurrentInsurer(e.target.value)}
              placeholder="e.g. State Farm, GEICO, Progressive"
              data-testid="quote-current-insurer"
              className="w-full border border-[#D1D5DB] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1] focus:border-transparent"
            />
          </div>

          {/* Primary driver DOB */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">
              Primary driver date of birth
            </label>
            <input
              type="date"
              value={driverDob}
              onChange={e => setDriverDob(e.target.value)}
      max={new Date(Date.now() - MIN_DRIVER_AGE_MS)
                .toISOString().slice(0, 10)}
              data-testid="quote-driver-dob"
              className="w-full border border-[#D1D5DB] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1] focus:border-transparent"
            />
          </div>

          {/* Additional notes */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">
              Additional information (optional)
            </label>
            <textarea
              value={additionalInfo}
              onChange={e => setAdditionalInfo(e.target.value)}
              placeholder="Any special requirements, multiple vehicles, good driver discount, etc."
              maxLength={500}
              rows={3}
              data-testid="quote-additional-info"
              className="w-full border border-[#D1D5DB] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1] focus:border-transparent resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600" data-testid="quote-form-error">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            data-testid="submit-quote-request-btn"
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <><Loader2 size={14} className="animate-spin" /> Submitting…</>
            ) : "Request Quote"}
          </button>

          <p className="text-xs text-[#9CA3AF] text-center">
            Our team will review and respond within 1 business day.
          </p>
        </form>
      )}
    </div>
  );
}
