// /admin/manual-reviews — Manual prequal review queue (MANUAL_REVIEW + OFAC decisions)
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ShieldAlert, Clock, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

const REVIEW_DECISIONS = ["MANUAL_REVIEW", "OFAC_ESCALATED", "OFAC_REVIEW"] as const;

function fmtDate(d: Date) {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtCents(cents: number | null) {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString()}`;
}

function ageInHours(d: Date) {
  return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60));
}

function DecisionBadge({ decision }: { decision: string }) {
  const cls =
    decision === "OFAC_ESCALATED" || decision === "OFAC_REVIEW"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      {decision.replace(/_/g, " ")}
    </span>
  );
}

export default async function AdminManualReviewsPage() {
  await requireAdmin();

  // PreQualifications awaiting human review
  const reviews = await prisma.preQualification.findMany({
    where: { decision: { in: [...REVIEW_DECISIONS] } },
    orderBy: { createdAt: "asc" }, // oldest-first (FIFO triage)
    include: {
      buyer: {
        include: { user: { select: { email: true } } },
      },
    },
    take: 200,
  });

  // OFAC-flagged buyers without a pending prequal (still need review)
  const ofacBuyers = await prisma.buyer.findMany({
    where: {
      preQualification: {
        AND: [
          { checkOfacAlert: true },
          { decision: { notIn: [...REVIEW_DECISIONS] } },
        ],
      },
    },
    include: {
      user: { select: { email: true } },
      preQualification: true,
    },
    take: 100,
  });

  const ofacCount = reviews.filter(
    (r) => r.decision === "OFAC_ESCALATED" || r.decision === "OFAC_REVIEW",
  ).length;
  const manualCount = reviews.length - ofacCount;

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-manual-reviews-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Manual Reviews</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Prequalifications and OFAC alerts awaiting compliance decision
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="stat-total-reviews">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
            Awaiting Review
          </p>
          <p className="text-2xl font-bold text-slate-900">{reviews.length}</p>
        </div>
        <div className="bg-white border border-red-200 rounded-xl p-4" data-testid="stat-ofac-reviews">
          <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wide mb-1">
            OFAC Escalations
          </p>
          <p className="text-2xl font-bold text-red-700">{ofacCount}</p>
        </div>
        <div className="bg-white border border-amber-200 rounded-xl p-4" data-testid="stat-manual-reviews">
          <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide mb-1">
            Manual Review
          </p>
          <p className="text-2xl font-bold text-amber-700">{manualCount}</p>
        </div>
      </div>

      {/* Queue */}
      {reviews.length === 0 && ofacBuyers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center" data-testid="reviews-empty">
          <ShieldAlert size={32} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-500">No reviews pending</p>
          <p className="text-xs text-slate-400 mt-1">All prequalifications and OFAC alerts are clear.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1.4fr_1.6fr_1fr_1fr_0.8fr_0.6fr] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
            {["Buyer", "Email", "Decision", "Submitted", "Age", ""].map((h) => (
              <span
                key={h}
                className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide"
              >
                {h}
              </span>
            ))}
          </div>
          {reviews.map((r) => {
            const age = ageInHours(r.createdAt);
            const isStale = age > 48;
            return (
              <div
                key={r.id}
                className="grid md:grid-cols-[1.4fr_1.6fr_1fr_1fr_0.8fr_0.6fr] gap-3 px-5 py-4 items-center border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors"
                data-testid={`review-row-${r.id}`}
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {r.buyer.firstName} {r.buyer.lastName}
                  </p>
                  <p className="text-xs text-slate-400">{fmtCents(r.maxOtdAmountCents)} budget</p>
                </div>
                <span className="text-xs text-slate-500 truncate">{r.buyer.user.email}</span>
                <DecisionBadge decision={r.decision} />
                <span className="text-xs text-slate-500">{fmtDate(r.createdAt)}</span>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium ${
                    isStale ? "text-red-600" : "text-slate-500"
                  }`}
                >
                  <Clock size={11} />
                  {age}h
                </span>
                <Link
                  href={`/admin/prequal/${r.id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-al-primary hover:underline justify-self-end"
                  data-testid={`review-open-${r.id}`}
                >
                  Review
                  <ArrowRight size={11} />
                </Link>
              </div>
            );
          })}

          {/* OFAC flagged but no manual_review decision — separate group */}
          {ofacBuyers.length > 0 && (
            <>
              <div className="px-5 py-2 bg-red-50/60 border-y border-red-100">
                <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wide">
                  OFAC Flagged (decision: {ofacBuyers[0]?.preQualification?.decision ?? "—"})
                </p>
              </div>
              {ofacBuyers.map((b) => (
                <div
                  key={b.id}
                  className="grid md:grid-cols-[1.4fr_1.6fr_1fr_1fr_0.8fr_0.6fr] gap-3 px-5 py-4 items-center border-b border-slate-50 last:border-0 hover:bg-red-50/30 transition-colors"
                  data-testid={`ofac-row-${b.id}`}
                >
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {b.firstName} {b.lastName}
                  </p>
                  <span className="text-xs text-slate-500 truncate">{b.user.email}</span>
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-red-50 text-red-700 border-red-200">
                    OFAC FLAG
                  </span>
                  <span className="text-xs text-slate-500">
                    {b.preQualification ? fmtDate(b.preQualification.createdAt) : "—"}
                  </span>
                  <span className="text-xs text-slate-400">—</span>
                  <Link
                    href={b.preQualification ? `/admin/prequal/${b.preQualification.id}` : `/admin/buyers/${b.id}?tab=prequal`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-al-primary hover:underline justify-self-end"
                  >
                    Open
                    <ArrowRight size={11} />
                  </Link>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
