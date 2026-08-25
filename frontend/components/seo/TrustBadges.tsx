// Trust badge row — short list of credential signals shown on
// conversion-critical pages (homepage, for-buyers, request-vehicle).

import { ShieldCheck, BadgeCheck, Lock, Star } from "lucide-react";

// Factual, substantiated signals only — no broker/licensure claim (AutoLenis is
// not a broker) and no unsubstantiated rating (Phase 4 F2/F4).
const BADGES = [
  { Icon: ShieldCheck, label: "Buyer-First Marketplace", color: "text-green-600" },
  { Icon: BadgeCheck,  label: "Verified Dealer Network", color: "text-[#0B5FD1]" },
  { Icon: Lock,        label: "Stripe Secure Payments", color: "text-slate-600" },
  { Icon: Star,        label: "Refund on request", color: "text-amber-500" },
] as const;

export default function TrustBadges({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex flex-wrap gap-3 ${compact ? "justify-center" : ""}`}
      aria-label="Trust credentials"
    >
      {BADGES.map(({ Icon, label, color }) => (
        <div
          key={label}
          className="flex items-center gap-1.5 text-xs text-slate-500 bg-white border border-slate-100 rounded-full px-3 py-1.5"
        >
          <Icon size={12} className={color} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
