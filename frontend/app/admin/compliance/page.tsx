// /admin/compliance — compliance overview.
// Surfaces active compliance issues from real data: OFAC reviews, expired
// dealer licenses, suspended accounts, and reversed (clawed-back) commissions.
// Every count links to the relevant management surface.
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { ShieldAlert, FileWarning, UserX, RotateCcw, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compliance — Admin" };

export default async function AdminCompliancePage() {
  await requireAdmin();
  const now = new Date();

  const [
    pendingOfac,
    expiredLicenses,
    suspendedBuyers,
    suspendedDealers,
    suspendedAffiliates,
    reversedCommissions,
  ] = await Promise.all([
    prisma.preQualification.count({ where: { decision: { in: ["OFAC_REVIEW", "OFAC_ESCALATED"] } } }),
    prisma.dealerLicense.findMany({ where: { isActive: true, expiresAt: { lt: now } }, take: 25, orderBy: { expiresAt: "asc" } }),
    prisma.buyer.count({ where: { isSuspended: true } }),
    prisma.dealer.count({ where: { status: { in: ["SUSPENDED", "TERMINATED"] } } }),
    prisma.affiliate.count({ where: { status: "SUSPENDED" } }),
    prisma.commission.count({ where: { status: "REVERSED" } }),
  ]);

  // Resolve dealer names for the expired licenses.
  const dealerIds = [...new Set(expiredLicenses.map(l => l.dealerId))];
  const dealers = dealerIds.length
    ? await prisma.dealer.findMany({ where: { id: { in: dealerIds } }, select: { id: true, dealershipName: true } })
    : [];
  const dealerName = new Map(dealers.map(d => [d.id, d.dealershipName]));

  const totalSuspended = suspendedBuyers + suspendedDealers + suspendedAffiliates;

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-compliance-page">
      <div className="flex items-center gap-3 mb-1">
        <ShieldAlert size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Compliance</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Active compliance issues across the platform.</p>

      {/* OFAC */}
      <Section
        icon={<ShieldAlert size={18} className="text-red-600" />}
        title="Pending OFAC Reviews"
        count={pendingOfac}
        href="/admin/compliance/ofac"
        linkLabel="Open OFAC queue"
        emptyText="No OFAC reviews pending."
      >
        {pendingOfac > 0 && (
          <p className="text-sm text-slate-600">
            {pendingOfac} buyer{pendingOfac !== 1 ? "s" : ""} frozen pending OFAC review.
          </p>
        )}
      </Section>

      {/* Expired dealer licenses */}
      <Section
        icon={<FileWarning size={18} className="text-amber-600" />}
        title="Expired Dealer Licenses"
        count={expiredLicenses.length}
        href="/admin/dealers"
        linkLabel="Manage dealers"
        emptyText="No expired dealer licenses."
      >
        {expiredLicenses.length > 0 && (
          <ul className="text-sm text-slate-600 space-y-1" data-testid="expired-licenses-list">
            {expiredLicenses.map(l => (
              <li key={l.id} className="flex items-center justify-between">
                <Link href={`/admin/dealers/${l.dealerId}`} className="text-al-primary hover:underline">
                  {dealerName.get(l.dealerId) ?? `Dealer ${l.dealerId.slice(0, 8)}`}
                </Link>
                <span className="text-xs text-slate-400">
                  {l.state} · expired {l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Suspended accounts */}
      <Section
        icon={<UserX size={18} className="text-orange-600" />}
        title="Suspended Accounts"
        count={totalSuspended}
        emptyText="No suspended accounts."
      >
        {totalSuspended > 0 && (
          <div className="flex flex-wrap gap-2 text-sm" data-testid="suspended-breakdown">
            <Link href="/admin/buyers?suspended=1" className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-al-primary/30">
              Buyers: <span className="font-semibold">{suspendedBuyers}</span>
            </Link>
            <Link href="/admin/dealers?status=SUSPENDED" className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-al-primary/30">
              Dealers: <span className="font-semibold">{suspendedDealers}</span>
            </Link>
            <Link href="/admin/affiliates?status=SUSPENDED" className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-al-primary/30">
              Affiliates: <span className="font-semibold">{suspendedAffiliates}</span>
            </Link>
          </div>
        )}
      </Section>

      {/* Reversed / clawed-back commissions */}
      <Section
        icon={<RotateCcw size={18} className="text-slate-600" />}
        title="Reversed Commissions (Clawbacks)"
        count={reversedCommissions}
        href="/admin/affiliates"
        linkLabel="Review affiliates"
        emptyText="No reversed commissions."
      >
        {reversedCommissions > 0 && (
          <p className="text-sm text-slate-600">
            {reversedCommissions} commission{reversedCommissions !== 1 ? "s have" : " has"} been reversed via clawback.
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({
  icon, title, count, href, linkLabel, emptyText, children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  href?: string;
  linkLabel?: string;
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4" data-testid={`compliance-section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${count > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
            {count}
          </span>
        </div>
        {href && (
          <Link href={href} className="text-xs font-medium text-al-primary hover:underline inline-flex items-center gap-1">
            {linkLabel ?? "View"} <ArrowRight size={12} />
          </Link>
        )}
      </div>
      {count === 0 ? <p className="text-sm text-slate-400">{emptyText}</p> : children}
    </div>
  );
}
