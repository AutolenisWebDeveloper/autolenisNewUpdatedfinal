import { requireAdmin } from "@/lib/auth/admin-session";
import { notFound } from "next/navigation";
import {
  getAdminBuyerDetailData,
  getAdminBuyerActionAvailability,
} from "@/lib/services/admin/admin-buyer-command-center.service";
import { prisma } from "@/lib/prisma";
import AdminBuyerCommandCenter from "./AdminBuyerCommandCenter";

interface Props {
  params: Promise<{ buyerId: string }>;
  searchParams: Promise<{ tab?: string }>;
}
export const dynamic = "force-dynamic";

export default async function AdminBuyerDetailPage({ params, searchParams }: Props) {
  const { buyerId } = await params;
  const { tab } = await searchParams;
  await requireAdmin();

  const [data, availability] = await Promise.all([
    getAdminBuyerDetailData(buyerId),
    getAdminBuyerActionAvailability(buyerId),
  ]);

  if (!data) notFound();

  // Extra data required by PrequalAdminPanel (not present in CommandCenter's serialized data).
  // Doing this server-side avoids client-side loading flicker on the prequal panel.
  const latestConsent = await prisma.prequalConsent.findFirst({
    where: { buyerId },
    orderBy: { acceptedAt: "desc" },
    select: { acceptedAt: true },
  });

  const REQUIRED_FIELDS: Array<keyof typeof data.buyer> = [
    "firstName", "lastName", "address", "city", "state", "zip",
    "employmentStatus", "incomeRange",
  ];
  const profileMissingFields = REQUIRED_FIELDS.filter((f) => !data.buyer[f]).map(String);

  // Source is not a stored column — derive from isExternal flag for the panel's display label.
  const derivedSource = data.preQualification?.isExternal ? "external" : "ipredict";

  const prequalPanelExtras = {
    source: data.preQualification ? derivedSource : null,
    hasConsent: !!latestConsent,
    consentAcceptedAt: latestConsent?.acceptedAt.toISOString() ?? null,
    profileMissingFields,
  };

  return (
    <AdminBuyerCommandCenter
      data={data}
      availability={availability}
      initialTab={tab}
      prequalPanelExtras={prequalPanelExtras}
    />
  );
}
