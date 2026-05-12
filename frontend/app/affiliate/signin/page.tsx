import { getAuthPageStats } from "@/lib/services/auth/stats.service";
import AffiliateSignInClient from "./AffiliateSignInClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Affiliate Sign In — AutoLenis",
  robots: { index: false },
};

export default async function AffiliateSignInPage() {
  const stats = await getAuthPageStats().catch(() => ({
    dealsCompleted: 0,
    avgSavingsDollars: 0,
    verifiedDealers: 0,
    buyersServed: 0,
  }));
  return <AffiliateSignInClient stats={stats} />;
}
