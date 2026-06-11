// Server component - admin dealer applications queue
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import type { DealerApplication } from "@prisma/client";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Row shape derived directly from the Prisma DealerApplication model so the
// admin UI always tracks the real column names (contactEmail/contactPhone/notes
// — not the stale email/phone/message names a previous version mapped against).
type ApplicationRow = Pick<
  DealerApplication,
  | "id"
  | "dealershipName"
  | "dealershipType"
  | "contactName"
  | "contactEmail"
  | "contactPhone"
  | "city"
  | "state"
  | "zip"
  | "licenseNumber"
  | "annualVolume"
  | "status"
  | "notes"
> & { createdAt: string };

export default async function AdminDealerApplicationsPage() {
  await requireAdmin();

  const raw = await prisma.dealerApplication.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const applications: ApplicationRow[] = raw.map((a) => ({
    id: a.id,
    dealershipName: a.dealershipName,
    dealershipType: a.dealershipType,
    contactName: a.contactName,
    contactEmail: a.contactEmail,
    contactPhone: a.contactPhone,
    city: a.city,
    state: a.state,
    zip: a.zip,
    licenseNumber: a.licenseNumber,
    annualVolume: a.annualVolume,
    status: a.status,
    notes: a.notes,
    createdAt: a.createdAt.toISOString(),
  }));

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-dealer-applications-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dealer Applications</h1>
          <p className="text-sm text-slate-500 mt-1">
            {applications.length} application{applications.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/admin/dealers/invite"
          className="bg-[#0B5FD1] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#3a0063] transition-colors"
          data-testid="admin-send-invitation-link"
        >
          Send Direct Invitation
        </Link>
      </div>

      {applications.length === 0 ? (
        <div className="text-center py-16 text-slate-400" data-testid="admin-applications-empty">
          <p className="text-lg font-medium">No applications yet</p>
          <p className="text-sm mt-1">Applications submitted via /dealer/apply will appear here.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Dealership
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Type / Volume
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Location
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Submitted
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {applications.map((app) => (
                <tr key={app.id} className="hover:bg-slate-50" data-testid={`application-row-${app.id}`}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/dealers/applications/${app.id}`}
                      className="font-medium text-slate-900 hover:text-[#0B5FD1] hover:underline"
                      data-testid={`application-link-${app.id}`}
                    >
                      {app.dealershipName}
                    </Link>
                    <p className="text-xs text-slate-400">License: {app.licenseNumber}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{app.contactName}</p>
                    <p className="text-xs text-slate-400">{app.contactEmail}</p>
                    {app.contactPhone && (
                      <p className="text-xs text-slate-400">{app.contactPhone}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <p>{app.dealershipType || "—"}</p>
                    {app.annualVolume && (
                      <p className="text-xs text-slate-400">{app.annualVolume}/yr</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {[app.city, app.state, app.zip].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                        app.status === "PENDING"
                          ? "bg-amber-50 text-amber-700"
                          : app.status === "APPROVED"
                          ? "bg-green-50 text-green-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {app.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {new Date(app.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {app.status === "PENDING" && (
                      <div className="flex gap-2">
                        <form action={`/api/admin/dealers/applications/${app.id}/approve`} method="POST">
                          <button
                            type="submit"
                            className="px-3 py-1 bg-green-600 text-white text-xs rounded font-semibold hover:bg-green-700"
                            data-testid={`approve-btn-${app.id}`}
                          >
                            Approve
                          </button>
                        </form>
                        <form action={`/api/admin/dealers/applications/${app.id}/reject`} method="POST">
                          <button
                            type="submit"
                            className="px-3 py-1 bg-red-600 text-white text-xs rounded font-semibold hover:bg-red-700"
                            data-testid={`reject-btn-${app.id}`}
                          >
                            Reject
                          </button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
