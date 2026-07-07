import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-session";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export const dynamic = "force-dynamic";

function statusVariant(status: string): "green" | "amber" | "destructive" | "secondary" {
  if (status === "APPROVED")                                    return "green";
  if (status === "REJECTED" || status === "NEEDS_CORRECTION")  return "destructive";
  if (status === "SUBMITTED" || status === "UNDER_REVIEW")     return "amber";
  return "secondary";
}

export default async function AdminAffiliateOnboardingPage() {
  await requireAdmin();
  const reviews = await prisma.affiliateOnboardingReview.findMany({
    include: {
      affiliate: { include: { user: { select: { email: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Affiliate Onboarding Review</h1>
        <span className="text-sm text-slate-500">{reviews.length} records</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Email</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Step</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Submitted</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reviews.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-slate-400">No onboarding records found.</td>
              </tr>
            )}
            {reviews.map(review => (
              <tr key={review.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-slate-900">{review.affiliate.user.email}</td>
                <td className="px-4 py-3">
                  <Badge variant={statusVariant(review.status)}>{review.status.replace("_", " ")}</Badge>
                </td>
                <td className="px-4 py-3 text-slate-600">{review.currentStep} / 7</td>
                <td className="px-4 py-3 text-slate-500">
                  {review.submittedAt ? new Date(review.submittedAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/affiliates/${review.affiliateId}`}
                    className="text-al-primary hover:underline font-medium text-xs"
                  >
                    View Affiliate →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
