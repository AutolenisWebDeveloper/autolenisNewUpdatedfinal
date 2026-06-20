import { requireAdmin } from "@/lib/auth/admin-session";
import { loadExecutiveIntelligence } from "@/lib/amips/intelligence/executive-intelligence";
import ExecutiveIntelligenceDashboard from "@/components/admin/amips/ExecutiveIntelligenceDashboard";

export const dynamic = "force-dynamic";

// AMIPS — Market Intelligence Center.
//
// The admin surface for the Automotive Market Intelligence Publishing System.
// Intelligence-first: the national health index, opportunity rankings, insight
// feed, and content performance lead; infrastructure/sync controls are demoted
// to the Operations section. All figures are computed by the executive
// intelligence engine from live data — never estimated.
export default async function AdminAmipsPage() {
  await requireAdmin();
  const intelligence = await loadExecutiveIntelligence();
  return <ExecutiveIntelligenceDashboard data={intelligence} />;
}
