// Small KPI stat card shared across social dashboard tabs. Extracted verbatim
// from SocialDashboardClient.tsx (decomposition). Visual output unchanged.
export function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4">
      <p className="text-[10px] uppercase tracking-wider text-[#94A3B8] font-bold">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ?? "text-[#0F172A]"}`}>{value}</p>
    </div>
  );
}
