import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { getOnboardingProfile, computeOnboardingCompletion } from "@/lib/services/affiliate/onboarding.service";
import { Badge } from "@/components/ui/badge";
import { User, CheckCircle2, AlertTriangle, ExternalLink, Clock, Phone, MapPin, Wallet } from "lucide-react";
import Link from "next/link";
import CopyReferralCodeButton from "@/components/affiliate/CopyReferralCodeButton";
import WeeklyDigestToggle from "@/components/affiliate/WeeklyDigestToggle";

export const dynamic = "force-dynamic";

function statusVariant(status: string): "green" | "amber" | "destructive" | "secondary" {
  if (status === "ACTIVE") return "green";
  if (status === "PENDING") return "amber";
  if (status === "SUSPENDED" || status === "REJECTED") return "destructive";
  return "secondary";
}

function formatDate(date: Date | string | null) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatMonthYear(date: Date | string | null) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default async function AffiliateProfilePage() {
  const affiliate = await requireAffiliate();
  let onboardingData: Awaited<ReturnType<typeof getOnboardingProfile>> = { review: null, profile: null, taxProfile: null, paymentProfile: null, documents: [] };
  try {
    onboardingData = await getOnboardingProfile(affiliate.id);
  } catch {
    console.warn("[profile] onboarding tables not yet migrated — showing basic profile");
  }
  const completion = computeOnboardingCompletion(onboardingData);
  const { profile, taxProfile, paymentProfile } = onboardingData;

  const email       = affiliate.user.email;
  const displayName = (profile?.firstName && profile?.lastName)
    ? `${profile.firstName} ${profile.lastName}`
    : email;
  const initials    = (profile?.firstName && profile?.lastName)
    ? `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase()
    : email.slice(0, 2).toUpperCase();
  const memberSince = formatMonthYear(affiliate.createdAt);

  const READINESS_STEPS = [
    { key: "personalInfo",    label: "Personal Information", href: "/affiliate/portal/onboarding?step=2", done: completion.steps.personalInfo },
    { key: "businessProfile", label: "Business Profile",     href: "/affiliate/portal/onboarding?step=3", done: completion.steps.businessProfile },
    { key: "taxInfo",         label: "Tax / W-9",            href: "/affiliate/portal/onboarding?step=4", done: completion.steps.taxInfo },
    { key: "paymentProfile",  label: "Payment Profile",      href: "/affiliate/portal/onboarding?step=5", done: completion.steps.paymentProfile },
    { key: "documents",       label: "Identity Document",    href: "/affiliate/portal/documents",          done: completion.steps.documents },
  ];

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="affiliate-profile-page">
      <div className="flex items-center gap-3 mb-6">
        <User size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Profile</h1>
      </div>

      {/* Avatar + identity row */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-14 h-14 rounded-full bg-[#0B5FD1] flex items-center justify-center text-white text-xl font-bold">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 text-base truncate" data-testid="affiliate-display-name">{displayName}</p>
            <p className="text-sm text-slate-500 truncate" data-testid="affiliate-email">{email}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-slate-500 font-medium">L{affiliate.level} Affiliate</span>
              <span className="text-slate-300">·</span>
              <Badge variant={statusVariant(affiliate.status)} className="text-xs">{affiliate.status}</Badge>
            </div>
            {memberSince && (
              <p className="text-xs text-slate-400 mt-1">Member since {memberSince}</p>
            )}
          </div>
        </div>
      </div>

      {/* Payout Readiness */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Payout Readiness</p>
          <span className="text-xs font-semibold text-[#0B5FD1]">{completion.completedCount} / {completion.totalCount}</span>
        </div>
        <div className="space-y-2">
          {READINESS_STEPS.map(s => (
            <div key={s.key} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                {s.done
                  ? <CheckCircle2 size={14} className="text-green-600 shrink-0" />
                  : <Clock size={14} className="text-amber-500 shrink-0" />
                }
                <span className="text-sm text-slate-700">{s.label}</span>
              </div>
              {!s.done && (
                <Link href={s.href} className="text-xs font-semibold text-[#0B5FD1] hover:underline">
                  Complete →
                </Link>
              )}
            </div>
          ))}
        </div>
        {completion.isComplete && (
          <div className="mt-3 p-2 bg-green-50 rounded-lg text-center">
            <p className="text-xs font-semibold text-green-700">✓ Ready for payout</p>
          </div>
        )}
      </div>

      {/* Account details */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Account Details</p>
        <dl className="space-y-3">
          <div className="flex items-center justify-between">
            <dt className="text-sm text-slate-500">Email</dt>
            <dd className="text-sm font-medium text-slate-900">{email}</dd>
          </div>
          {profile?.phone && (
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500 flex items-center gap-1"><Phone size={12} /> Phone</dt>
              <dd className="text-sm font-medium text-slate-900">{profile.phone}</dd>
            </div>
          )}
          {(profile?.city || profile?.state) && (
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500 flex items-center gap-1"><MapPin size={12} /> Location</dt>
              <dd className="text-sm font-medium text-slate-900">
                {[profile?.city, profile?.state].filter(Boolean).join(", ")}
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between">
            <dt className="text-sm text-slate-500">Referral Code</dt>
            <dd className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-slate-900" data-testid="affiliate-referral-code">{affiliate.referralCode}</span>
              <CopyReferralCodeButton code={affiliate.referralCode} />
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-sm text-slate-500">Promo Method</dt>
            <dd className="text-sm text-slate-900">{affiliate.promotionMethod ?? "—"}</dd>
          </div>
          {affiliate.website && (
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Website</dt>
              <dd className="text-sm text-slate-900">
                {/^https?:\/\//i.test(affiliate.website) ? (
                  <a href={affiliate.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[#0B5FD1] hover:underline">
                    {affiliate.website} <ExternalLink size={11} />
                  </a>
                ) : (
                  <span>{affiliate.website}</span>
                )}
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between">
            <dt className="text-sm text-slate-500">Weekly Digest</dt>
            <dd>
              <WeeklyDigestToggle enabled={affiliate.weeklyDigestEnabled} affiliateId={affiliate.id} />
            </dd>
          </div>
        </dl>
      </div>

      {/* Compliance */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Compliance</p>
        <dl className="space-y-3">
          <div className="flex items-center justify-between">
            <dt className="text-sm text-slate-500">FTC Disclosure</dt>
            <dd className="flex items-center gap-1.5">
              {affiliate.ftcAcknowledgedAt ? (
                <>
                  <CheckCircle2 size={14} className="text-green-600" />
                  <span className="text-sm text-green-700 font-medium">Acknowledged {formatDate(affiliate.ftcAcknowledgedAt)}</span>
                </>
              ) : (
                <>
                  <AlertTriangle size={14} className="text-amber-500" />
                  <span className="text-sm text-amber-600 font-medium">Pending acknowledgment</span>
                </>
              )}
            </dd>
          </div>
          {taxProfile?.certifiedAt && (
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">W-9 Certification</dt>
              <dd className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-green-600" />
                <span className="text-sm text-green-700 font-medium">Certified {formatDate(taxProfile.certifiedAt)}</span>
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Finance Hub link */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Finance</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-[#0B5FD1]" />
            <p className="text-sm text-slate-700">
              {paymentProfile?.payoutMethod
                ? `Payout via ${paymentProfile.payoutMethod}${paymentProfile.accountLast4 ? ` ···${paymentProfile.accountLast4}` : ""}`
                : "Set up your banking and tax information"}
            </p>
          </div>
          <Link href="/affiliate/portal/finance" className="text-sm font-semibold text-[#0B5FD1] hover:underline flex items-center gap-1">
            Finance Hub <ExternalLink size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}

