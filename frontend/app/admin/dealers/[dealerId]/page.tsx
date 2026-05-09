import { requireAdmin } from "@/lib/auth/admin-session";
import { notFound } from "next/navigation";
import {
  getAdminDealerDetailData,
  getAdminDealerActionAvailability,
} from "@/lib/services/admin/admin-dealer-command-center.service";
import AdminDealerCommandCenter from "./AdminDealerCommandCenter";

interface Props {
  params: Promise<{ dealerId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export const dynamic = "force-dynamic";

export default async function AdminDealerDetailPage({ params, searchParams }: Props) {
  const { dealerId } = await params;
  const { tab } = await searchParams;
  await requireAdmin();

  const [data, availability] = await Promise.all([
    getAdminDealerDetailData(dealerId),
    getAdminDealerActionAvailability(dealerId),
  ]);

  if (!data) notFound();

  return (
    <AdminDealerCommandCenter
      data={data}
      availability={availability}
      initialTab={tab}
    />
  );
}
