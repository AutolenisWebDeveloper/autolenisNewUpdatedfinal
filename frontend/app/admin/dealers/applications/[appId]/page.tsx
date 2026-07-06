// /admin/dealers/applications/[appId] — Dealer application detail + approve/reject actions
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ApproveButtonClient from "./ApproveButtonClient";
import RejectFormClient from "./RejectFormClient";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ appId: string }>;
}

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "PENDING"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : status === "APPROVED"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-red-50 text-red-700 border-red-200";
  return (
    <span
      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}
      data-testid="application-status-badge"
    >
      {status}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-slate-100 last:border-0">
      <dt className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
        {label}
      </dt>
      <dd className="text-sm text-slate-800 break-words">{value || "—"}</dd>
    </div>
  );
}

export default async function AdminDealerApplicationDetailPage({ params }: Props) {
  await requireAdmin();
  const { appId } = await params;

  const app = await prisma.dealerApplication.findUnique({ where: { id: appId } });
  if (!app) notFound();

  // Look up reviewer email if present
  let reviewerEmail: string | null = null;
  if (app.reviewedBy) {
    const reviewer = await prisma.admin.findUnique({
      where: { id: app.reviewedBy },
      include: { user: { select: { email: true } } },
    });
    reviewerEmail = reviewer?.user.email ?? null;
  }

  // If approved, link to created dealer
  let createdDealerEmail: string | null = null;
  if (app.dealerId) {
    const dealer = await prisma.dealer.findUnique({
      where: { id: app.dealerId },
      include: { user: { select: { email: true } } },
    });
    createdDealerEmail = dealer?.user.email ?? null;
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-application-detail-page">
      {/* Back link */}
      <Link
        href="/admin/dealers/applications"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-al-primary mb-4 transition-colors"
        data-testid="back-to-applications-link"
      >
        <ArrowLeft size={14} />
        Back to applications
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900" data-testid="application-dealership-name">
            {app.dealershipName}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Application ID <span className="font-mono text-xs text-slate-400">{app.id.slice(0, 8)}…</span>
          </p>
        </div>
        <StatusBadge status={app.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Application details */}
        <div className="lg:col-span-2 space-y-5">
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Dealership</h2>
            <dl>
              <Field label="Dealership Name" value={app.dealershipName} />
              <Field label="Type" value={app.dealershipType} />
              <Field label="License Number" value={<span className="font-mono">{app.licenseNumber}</span>} />
              <Field
                label="Location"
                value={[app.city, app.state, app.zip].filter(Boolean).join(", ")}
              />
              <Field label="Annual Volume" value={app.annualVolume} />
            </dl>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Contact</h2>
            <dl>
              <Field label="Contact Name" value={app.contactName} />
              <Field
                label="Email"
                value={
                  <a
                    href={`mailto:${app.contactEmail}`}
                    className="text-al-primary hover:underline"
                    data-testid="application-contact-email"
                  >
                    {app.contactEmail}
                  </a>
                }
              />
              <Field
                label="Phone"
                value={
                  app.contactPhone ? (
                    <a href={`tel:${app.contactPhone}`} className="text-al-primary hover:underline">
                      {app.contactPhone}
                    </a>
                  ) : null
                }
              />
            </dl>
          </section>

          {app.notes && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Notes from Applicant</h2>
              <p className="text-sm text-slate-700 whitespace-pre-wrap" data-testid="application-notes">
                {app.notes}
              </p>
            </section>
          )}

          {app.status === "REJECTED" && app.rejectReason && (
            <section className="bg-red-50 border border-red-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-red-900 mb-1">Rejection Reason</h2>
              <p className="text-sm text-red-800 whitespace-pre-wrap" data-testid="application-reject-reason">
                {app.rejectReason}
              </p>
            </section>
          )}
        </div>

        {/* Sidebar — actions + audit */}
        <aside className="space-y-5">
          {app.status === "PENDING" ? (
            <>
              <ApproveButtonClient appId={app.id} />
              <RejectFormClient appId={app.id} />
            </>
          ) : (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Review</h3>
              <dl>
                <Field label="Reviewed By" value={reviewerEmail || app.reviewedBy} />
                <Field label="Reviewed At" value={fmtDate(app.reviewedAt)} />
                {app.dealerId && (
                  <Field
                    label="Dealer Account"
                    value={
                      <Link
                        href={`/admin/dealers/${app.dealerId}`}
                        className="text-al-primary hover:underline"
                        data-testid="application-dealer-link"
                      >
                        {createdDealerEmail || app.dealerId.slice(0, 8) + "…"}
                      </Link>
                    }
                  />
                )}
              </dl>
            </section>
          )}

          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Timeline</h3>
            <dl>
              <Field label="Submitted" value={fmtDate(app.createdAt)} />
              <Field label="Last Updated" value={fmtDate(app.updatedAt)} />
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
