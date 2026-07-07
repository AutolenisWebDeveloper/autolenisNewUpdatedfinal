// /admin/settings/admins — admin account management.
// Lists all admin accounts and lets a SUPER_ADMIN invite new admins or
// deactivate existing ones. MFA status and last-login are derived from the
// Admin record (totpEnabled / mfaVerifiedAt). Actions are SUPER_ADMIN-gated.
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Shield } from "lucide-react";
import AdminAccountsManager, { type AdminRow } from "@/components/admin/AdminAccountsManager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin Accounts — Admin" };

export default async function AdminAccountsPage() {
  const admin = await requireAdmin();

  const admins = await prisma.admin.findMany({
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });

  const rows: AdminRow[] = admins.map(a => ({
    id: a.id,
    email: a.user.email,
    role: a.role,
    mfaEnabled: a.totpEnabled,
    lastLogin: a.mfaVerifiedAt ? a.mfaVerifiedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  }));

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-settings-admins-page">
      <div className="flex items-center gap-3 mb-1">
        <Shield size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Admin Accounts</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Create and manage platform administrator accounts.</p>

      <AdminAccountsManager
        admins={rows}
        currentAdminId={admin.adminId}
        isSuperAdmin={admin.role === "SUPER_ADMIN"}
      />
    </div>
  );
}
