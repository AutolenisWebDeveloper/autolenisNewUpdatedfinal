import { requireAdmin } from "@/lib/auth/admin-session";
import { notFound } from "next/navigation";
import { getAdminAffiliateDetailData, getAdminAffiliateActionAvailability } from "@/lib/services/admin/admin-affiliate-command-center.service";
import AdminAffiliateCommandCenter from "./AdminAffiliateCommandCenter";

interface Props {
  params: Promise<{ affiliateId: string }>;
  searchParams: Promise<{ tab?: string }>;
}
export const dynamic = "force-dynamic";

export default async function AdminAffiliateDetailPage({ params, searchParams }: Props) {
  const { affiliateId } = await params;
  const { tab } = await searchParams;
  await requireAdmin();
  const [data, availability] = await Promise.all([
    getAdminAffiliateDetailData(affiliateId),
    getAdminAffiliateActionAvailability(affiliateId),
  ]);
  if (!data) notFound();
  return <AdminAffiliateCommandCenter data={data} availability={availability} initialTab={tab} />;
}
