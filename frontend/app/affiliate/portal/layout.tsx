import type { Metadata } from "next";
// Private portal — noindex at the metadata layer as defense-in-depth with
// robots.txt (which disallows crawling these paths). robots.txt prevents
// crawling; this prevents indexing of any externally-linked URL.
export const metadata: Metadata = { robots: { index: false, follow: false } };
import AffiliateSidebar from "@/components/affiliate/AffiliateSidebar";
import ChatWidget from "@/components/public/ChatWidget";
import { requireAffiliate } from "@/lib/auth/affiliate-session";

// All affiliate portal pages canonical under /affiliate/portal/*
export default async function AffiliatePortalLayout({ children }: { children: React.ReactNode }) {
  // R8 — requireAffiliate() already redirects SUSPENDED and REJECTED
  // affiliates to /affiliate/unsubscribed; the old REJECTED-may-view-dashboard
  // branch here was unreachable dead code encoding a contradictory product.
  await requireAffiliate();

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
