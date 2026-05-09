import AffiliateSidebar from "@/components/affiliate/AffiliateSidebar";
import ChatWidget from "@/components/public/ChatWidget";
import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const DASHBOARD_PATH = "/affiliate/portal/dashboard";

// All affiliate portal pages canonical under /affiliate/portal/*
export default async function AffiliatePortalLayout({ children }: { children: React.ReactNode }) {
  const affiliate = await requireAffiliate();
  // Note: SUSPENDED affiliates are already redirected by requireAffiliate() above.

  // REJECTED affiliates may only view the dashboard (which shows the status banner).
  // Any other portal page redirects them to the dashboard.
  if (affiliate.status === "REJECTED") {
    const hdrs = await headers();
    const pathname = hdrs.get("x-pathname") ?? "";
    if (pathname !== DASHBOARD_PATH) {
      redirect(DASHBOARD_PATH);
    }
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-[#F8F9FA]" data-testid="affiliate-portal">
      <AffiliateSidebar />
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">{children}</main>
      <ChatWidget
        chatEndpoint="/api/affiliate/ai/chat"
        initialGreeting="Hi! I'm Zura, your AutoLenis affiliate concierge. How can I help you with referrals, commissions, or your account today?"
        placeholder="Ask me about commissions, referrals, or payouts…"
      />
    </div>
  );
}
