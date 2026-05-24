"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Loader2, AlertTriangle, CheckCircle2, ShieldCheck, ShieldAlert } from "lucide-react";

const ROLES = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMPLIANCE_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN"] as const;

export interface AdminRow {
  id: string;
  email: string;
  role: string;
  mfaEnabled: boolean;
  lastLogin: string | null;
  createdAt: string;
}

export default function AdminAccountsManager({
  admins, currentAdminId, isSuperAdmin,
}: { admins: AdminRow[]; currentAdminId: string; isSuperAdmin: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("SUPPORT_ADMIN");
  const [inviting, setInviting] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; error: boolean } | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  async function invite() {
    if (!email.trim()) { setFeedback({ msg: "Email is required.", error: true }); return; }
    setInviting(true); setFeedback(null);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = await res.json() as { success?: boolean; error?: { message: string } };
      if (!res.ok || !data.success) { setFeedback({ msg: data.error?.message ?? "Invite failed.", error: true }); setInviting(false); return; }
      setFeedback({ msg: `Invitation sent to ${email.trim()}.`, error: false });
      setEmail("");
      router.refresh();
    } catch {
      setFeedback({ msg: "Network error — please try again.", error: true });
    } finally {
      setInviting(false);
    }
  }

  async function deactivate(row: AdminRow) {
    if (!confirm(`Deactivate ${row.email}? This revokes their admin access immediately.`)) return;
    setDeactivatingId(row.id); setFeedback(null);
    try {
      const res = await fetch(`/api/admin/admins/${row.id}`, { method: "DELETE" });
      const data = await res.json() as { success?: boolean; error?: { message: string } };
      if (!res.ok || !data.success) { setFeedback({ msg: data.error?.message ?? "Deactivation failed.", error: true }); setDeactivatingId(null); return; }
      setFeedback({ msg: `${row.email} deactivated.`, error: false });
      router.refresh();
    } catch {
      setFeedback({ msg: "Network error — please try again.", error: true });
    } finally {
      setDeactivatingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Invite */}
      <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="admin-invite-form">
        <h2 className="font-semibold text-slate-800 text-sm mb-3 flex items-center gap-2">
          <UserPlus size={15} /> Invite New Admin
        </h2>
        {!isSuperAdmin && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            Only a SUPER_ADMIN can create or deactivate admin accounts.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-slate-500 font-medium mb-1 block">Email</label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="new.admin@autolenis.com" disabled={!isSuperAdmin || inviting} data-testid="invite-email" />
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1 block">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)} disabled={!isSuperAdmin || inviting}
              className="text-sm border border-slate-200 rounded-lg px-2.5 py-2 bg-white disabled:opacity-50" data-testid="invite-role">
              {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <Button onClick={invite} disabled={!isSuperAdmin || inviting} data-testid="invite-submit">
            {inviting ? <><Loader2 size={14} className="animate-spin" /> Inviting…</> : "Send Invite"}
          </Button>
        </div>
        <p className="text-xs text-slate-400 mt-2">The invitee receives a temporary password and must complete MFA setup before first access.</p>
      </div>

      {feedback && (
        <div className={`text-xs px-3 py-2 rounded-lg flex items-center gap-2 ${feedback.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`} data-testid="admin-mgmt-feedback">
          {feedback.error ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />} {feedback.msg}
        </div>
      )}

      {/* Roster */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="admin-roster">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 text-sm">Admin Accounts ({admins.length})</h2>
        </div>
        {admins.length === 0 ? (
          <p className="text-sm text-slate-400 px-5 py-8 text-center">No admin accounts.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {admins.map(a => {
              const isSelf = a.id === currentAdminId;
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" data-testid={`admin-row-${a.id}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {a.email} {isSelf && <span className="text-xs text-slate-400">(you)</span>}
                    </p>
                    <p className="text-xs text-slate-400">
                      {a.role.replace(/_/g, " ")} · last login {a.lastLogin ? new Date(a.lastLogin).toLocaleDateString() : "never"} · created {new Date(a.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.mfaEnabled
                      ? <Badge variant="green" className="text-xs"><ShieldCheck size={11} /> MFA active</Badge>
                      : <Badge variant="amber" className="text-xs"><ShieldAlert size={11} /> MFA setup pending</Badge>}
                    <Button size="sm" variant="destructive" className="text-xs"
                      disabled={!isSuperAdmin || isSelf || deactivatingId === a.id}
                      title={isSelf ? "You cannot deactivate your own account" : undefined}
                      onClick={() => deactivate(a)} data-testid={`deactivate-${a.id}`}>
                      {deactivatingId === a.id ? <Loader2 size={12} className="animate-spin" /> : "Deactivate"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
