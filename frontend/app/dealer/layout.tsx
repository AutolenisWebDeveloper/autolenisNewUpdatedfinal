import { headers } from "next/headers";
import DealerSidebar from "@/components/dealer/DealerSidebar";
import ChatWidget from "@/components/public/ChatWidget";
import { requireDealer } from "@/lib/auth/dealer-session";

// Single DEALER role — no sub-role checks, no permission filtering
// All dealer portal sections accessible to the authenticated dealer account
// Exception: /dealer/signin skips auth check
export default async function DealerLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const isDealerAuthPage = headersList.get("x-dealer-auth-route") === "true";

  // Skip auth check for dealer auth routes (signin)
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
