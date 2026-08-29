import { getAuthPageStats } from "@/lib/services/auth/stats.service";
import { createServerSupabaseClient } from "@/lib/supabase";
import { redirect } from "next/navigation";
import AffiliateSignInClient from "./AffiliateSignInClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Affiliate Sign In — AutoLenis",
  robots: { index: false },
};

export default async function AffiliateSignInPage() {
  // R13 — a signed-in affiliate visiting the sign-in form bounces to their
  // dashboard server-side (register already did this client-side; the proxy's
  // step-9 authenticated bounce covers only /auth/* routes).
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getUser();
    if ((data?.user?.user_metadata?.role as string | undefined) === "AFFILIATE") {
      redirect("/affiliate/portal/dashboard");
    }
  } catch (err) {
    // NEXT_REDIRECT must propagate; anything else degrades to showing the form.
    if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
  }

  const stats = await getAuthPageStats().catch(() => ({
    dealsCompleted: 0,
    avgSavingsDollars: 0,
    verifiedDealers: 0,
    buyersServed: 0,
  }));
  return <AffiliateSignInClient stats={stats} />;
}
