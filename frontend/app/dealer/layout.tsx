import type { Metadata } from "next";
// Private portal — noindex at the metadata layer as defense-in-depth with
// robots.txt (which disallows crawling these paths). robots.txt prevents
// crawling; this prevents indexing of any externally-linked URL.
export const metadata: Metadata = { robots: { index: false, follow: false } };
import { headers } from "next/headers";
import DealerSidebar from "@/components/dealer/DealerSidebar";
import ChatWidget from "@/components/public/ChatWidget";
import { requireDealer } from "@/lib/auth/dealer-session";
import { isDealerPublicRoute } from "@/lib/auth/dealer-scope";

// Single DEALER role — no sub-role checks, no permission filtering
// All dealer portal sections accessible to the authenticated dealer account
// Exception: /dealer/signin skips auth check
export default async function DealerLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  // Match on x-pathname (a forwarded REQUEST header, readable here) rather than
  // x-dealer-auth-route, which proxy.ts sets on the RESPONSE and a Server
  // Component therefore cannot reliably observe. Without this, /dealer/claim
  // would render this layout, call requireDealer(), and bounce the very dealer
  // who is trying to claim their account back to sign-in — the D1 failure again,
  // one layer down.
  const pathname = headersList.get("x-pathname");
  const isDealerAuthPage =
    headersList.get("x-dealer-auth-route") === "true" || isDealerPublicRoute(pathname);

  // Skip auth for sign-in and the token-authenticated claim routes.
  if (isDealerAuthPage) {
    return <>{children}</>;
  }

  await requireDealer(); // Redirects to /dealer/signin if not authenticated
  return (
    <div className="flex flex-col lg:flex-row h-screen bg-[#F8F9FA]" data-testid="dealer-portal">
      <DealerSidebar />
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">{children}</main>
      <ChatWidget
        chatEndpoint="/api/dealer/ai/chat"
        initialGreeting="Hi! I'm Zura, your AutoLenis dealer concierge. How can I help you manage your inventory and auctions today?"
        placeholder="Ask me about inventory, auctions, or deal status…"
      />
    </div>
  );
}
