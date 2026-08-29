import { createServerSupabaseClient } from "@/lib/supabase";
import { redirect } from "next/navigation";
import AffiliateRegisterClient from "./AffiliateRegisterClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Become an Affiliate — AutoLenis",
  robots: { index: false },
};

export default async function AffiliateRegisterPage() {
  // U14 — the authenticated-affiliate bounce runs server-side (same pattern
  // as signin's R13 fix) instead of a client-side Supabase session probe that
  // flashed the form before redirecting.
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

  return <AffiliateRegisterClient />;
}
