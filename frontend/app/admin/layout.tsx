import type { Metadata } from "next";
// Private portal — noindex at the metadata layer as defense-in-depth with
// robots.txt (which disallows crawling these paths). robots.txt prevents
// crawling; this prevents indexing of any externally-linked URL.
export const metadata: Metadata = { robots: { index: false, follow: false } };
import { headers } from "next/headers";
import AdminSidebar from "@/components/admin/AdminSidebar";
import ChatWidget from "@/components/public/ChatWidget";
import { requireAdmin } from "@/lib/auth/admin-session";

// Admin portal layout — requires full admin JWT with mfaVerified: true
// No skip path exists for any admin role (SUPER_ADMIN, OPERATIONS_ADMIN, etc.)
// Exception: /admin/auth/* routes skip auth check
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const isAdminAuthPage = headersList.get("x-admin-auth-route") === "true";

  // Skip auth check for admin auth routes (signin, setup-mfa, verify-mfa)
  if (isAdminAuthPage) {
    return <>{children}</>;
  }

  const admin = await requireAdmin();

  // CRM + Operations route in the Phase 2 CRM shell — full-viewport dark
  // chrome with its own sidebar. The CRM layout owns the canvas; the default
  // admin sidebar/chat widget would otherwise double up.
  const pathname = headersList.get("x-pathname") ?? "";
  const isCrmShell =
    pathname.startsWith("/admin/crm") || pathname.startsWith("/admin/operations");

  if (isCrmShell) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-[#F4F6FA]" data-testid="admin-portal">
      <AdminSidebar adminRole={admin.role} />
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">{children}</main>
      <ChatWidget
        chatEndpoint="/api/admin/ai/chat"
        initialGreeting="Hi! I'm Zura, your AutoLenis operations concierge. I can help you review platform activity, navigate admin tools, and prioritize tasks."
        placeholder="Ask about platform status, buyers, deals, or actions needed…"
      />
    </div>
  );
}
