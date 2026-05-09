// Compliance disclosure — shown on every refinance touchpoint.
// AutoLenis is a lead provider only. Wording must not imply internal lending.

export default function RefinanceComplianceDisclosure({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      data-testid="refinance-compliance-disclosure"
      className={`rounded-xl border border-[#E5E7EB] bg-[#F8F9FB] px-5 py-4 text-xs leading-relaxed text-[#4B5563] ${className}`}
    >
      <p className="font-semibold text-[#111827] mb-1">Important compliance notice</p>
      <p>
        AutoLenis is a marketing platform and lead provider. We do not offer, arrange, or negotiate loans. We do not make credit decisions. All refinance applications are processed directly by OpenRoad Lending, an independent lender. Approval, rates, terms, and loan decisions are made solely by OpenRoad Lending and are subject to their underwriting criteria. AutoLenis is not responsible for any lending outcomes.
      </p>
    </div>
  );
}
