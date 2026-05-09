import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin-session";
import { FileText, BookOpen, Handshake } from "lucide-react";

export const dynamic = "force-dynamic";

const CARDS = [
  {
    href: "/admin/refinance/leads",
    icon: FileText,
    title: "Leads",
    body: "Read-only tracking of refinance leads. AutoLenis does not make credit decisions.",
    testId: "admin-refinance-nav-leads",
  },
  {
    href: "/admin/refinance/compliance",
    icon: BookOpen,
    title: "Compliance Notes",
    body: "Non-lending disclosures, consent capture policy, and audit posture.",
    testId: "admin-refinance-nav-compliance",
  },
  {
    href: "/admin/refinance/partner",
    icon: Handshake,
    title: "Partner Info",
    body: "OpenRoad Lending — the lender all qualified leads are referred to.",
    testId: "admin-refinance-nav-partner",
  },
];

export default async function AdminRefinanceIndex() {
  await requireAdmin();
  return (
    <div className="p-6 md:p-10" data-testid="admin-refinance-index">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Refinance</h1>
        <p className="text-sm text-[#4B5563] mt-1">
          AutoLenis operates as a lead provider only. All refinance applications are processed by OpenRoad Lending.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            data-testid={c.testId}
            className="block bg-white border border-[#E5E7EB] rounded-xl p-5 hover:border-[#93C5FD] hover:shadow-sm transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-[#0B5FD1]/10 flex items-center justify-center mb-4">
              <c.icon size={18} className="text-[#0B5FD1]" />
            </div>
            <h3 className="text-sm font-bold text-[#111827] mb-1.5">{c.title}</h3>
            <p className="text-xs text-[#4B5563] leading-relaxed">{c.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
