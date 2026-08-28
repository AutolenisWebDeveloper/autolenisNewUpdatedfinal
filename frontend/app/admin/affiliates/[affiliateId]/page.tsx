import { requireAdmin } from "@/lib/auth/admin-session";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import {
  getAdminAffiliateDetailData,
  getAdminAffiliateActionAvailability,
} from "@/lib/services/admin/admin-affiliate-command-center.service";
import AdminAffiliateCommandCenter from "./AdminAffiliateCommandCenter";

interface Props {
  params: Promise<{ affiliateId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export const dynamic = "force-dynamic";

export default async function AdminAffiliateDetailPage({
  params,
  searchParams,
}: Props) {
  const { affiliateId } = await params;
  const { tab } = await searchParams;
  const admin = await requireAdmin();

  try {
    const [data, availability] = await Promise.all([
      getAdminAffiliateDetailData(affiliateId),
      getAdminAffiliateActionAvailability(affiliateId),
    ]);

    if (!data) notFound();

    return (
      <AdminAffiliateCommandCenter
        adminRole={admin.role}
        data={data}
        availability={availability}
        initialTab={tab}
      />
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return (
      <div className="p-6 md:p-8 max-w-4xl">
        <div className="flex items-center gap-3 mb-2">
          <Link
            href="/admin/affiliates"
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            ← Affiliates
          </Link>
        </div>
        <div className="flex items-center gap-3 mb-6">
          <AlertTriangle size={22} className="text-amber-600" />
          <h1 className="text-xl font-bold text-slate-900">
            Affiliate Details
          </h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-4">
          <p className="text-sm font-semibold text-red-800 mb-1">
            Failed to load affiliate data
          </p>
          <p className="text-sm text-red-700 font-mono break-all">{message}</p>
          <p className="text-xs text-red-500 mt-2">
            Affiliate ID: <code>{affiliateId}</code>
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/admin/affiliates"
            className="inline-flex items-center gap-2 border border-slate-200 text-slate-600 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-slate-50"
          >
            ← Back to Affiliates
          </Link>
          <a
            href={`/admin/affiliates/${affiliateId}`}
            className="inline-flex items-center gap-2 bg-al-primary text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#0944a8]"
          >
            Retry
          </a>
        </div>
      </div>
    );
  }
}
