// /auth/accept-terms — enforced by proxy.ts middleware
// Buyers cannot bypass this page by navigating directly
// proxy.ts checks termsAcceptedAt and redirects to this page when null

import Link from "next/link";
import AcceptTermsForm from "./AcceptTermsForm";

interface Props {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}

// Acceptance writes to TWO stores (Prisma + Supabase user_metadata) and both
// terms gates bounce an unaccepted buyer back here. A half-applied acceptance
// used to redirect into that loop with nothing shown; acceptTermsAction now
// returns here with an error code instead, which this renders as an actionable
// message so the buyer knows what happened and can retry or reach support.
const ERROR_COPY: Record<string, string> = {
  NO_BUYER_PROFILE:
    "We couldn't finish setting up your buyer profile, so your acceptance wasn't saved. Please try once more — if this keeps happening, contact support@autolenis.com and we'll fix it for you.",
  SYNC_FAILED:
    "Your acceptance was saved but we couldn't finish syncing your session, so you'd be asked again. Please try once more — if this keeps happening, contact support@autolenis.com.",
};

export default async function AcceptTermsPage({ searchParams }: Props) {
  const { redirect, error } = await searchParams;
  const errorMessage = error ? ERROR_COPY[error] ?? ERROR_COPY.SYNC_FAILED : null;

  return (
    <div data-testid="accept-terms-page">
      <h1 className="text-2xl font-bold text-[#111827] mb-2 tracking-tight">Review our terms</h1>
      <p className="text-sm text-[#4B5563] mb-6">Please review and accept AutoLenis&apos;s terms before continuing.</p>

      {errorMessage && (
        <div
          role="alert"
          data-testid="accept-terms-error"
          className="mb-6 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]"
        >
          <p className="font-semibold mb-0.5">We couldn&apos;t save your acceptance</p>
          <p className="leading-relaxed">{errorMessage}</p>
        </div>
      )}

      <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-5 mb-6 space-y-3 text-sm text-[#4B5563] leading-relaxed max-h-60 overflow-y-auto" data-testid="terms-summary">
        <p><strong className="text-[#111827]">Service Summary:</strong> AutoLenis facilitates a reverse-auction process connecting buyers with licensed dealers. AutoLenis is not a dealer, broker, or party to any vehicle transaction.</p>
        <p><strong className="text-[#111827]">$99 Deposit:</strong> If no deal is selected, you can request a refund — our team reviews every request. Credited toward the $499 concierge fee if you proceed.</p>
        <p><strong className="text-[#111827]">$499 Fee:</strong> Charged only after you select a deal. Covers everything from auction to vehicle pickup.</p>
        <p><strong className="text-[#111827]">Data:</strong> Your prequalification data is encrypted at rest and never shared with dealers until you select a deal.</p>
        <p><strong className="text-[#111827]">FCRA:</strong> Credit checks are soft-pull only and do not affect your score.</p>
      </div>

      <div className="flex flex-col gap-3">
        {/* The submit path is a Client Component so the acceptance round-trip
            has a visible pending state and cannot be double-submitted. */}
        <AcceptTermsForm redirectTo={redirect} />
        <div className="text-center">
          <Link href="/legal/terms" target="_blank" className="text-xs text-[#94A3B8] hover:text-[#0B5FD1] hover:underline transition-colors" data-testid="view-full-terms-link">
            Read full Terms of Service →
          </Link>
        </div>
      </div>
    </div>
  );
}
