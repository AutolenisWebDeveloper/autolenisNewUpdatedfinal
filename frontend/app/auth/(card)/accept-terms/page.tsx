// /auth/accept-terms — enforced by proxy.ts middleware
// Buyers cannot bypass this page by navigating directly
// proxy.ts checks termsAcceptedAt and redirects to this page when null

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { acceptTermsAction } from "@/lib/auth/actions";

interface Props {
  searchParams: Promise<{ redirect?: string }>;
}

export default async function AcceptTermsPage({ searchParams }: Props) {
  const { redirect } = await searchParams;

  return (
    <div data-testid="accept-terms-page">
      <h1 className="text-2xl font-bold text-[#111827] mb-2 tracking-tight">Review our terms</h1>
      <p className="text-sm text-[#4B5563] mb-6">Please review and accept AutoLenis&apos;s terms before continuing.</p>

      <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-5 mb-6 space-y-3 text-sm text-[#4B5563] leading-relaxed max-h-60 overflow-y-auto" data-testid="terms-summary">
        <p><strong className="text-[#111827]">Service Summary:</strong> AutoLenis facilitates a reverse-auction process connecting buyers with licensed dealers. AutoLenis is not a dealer, broker, or party to any vehicle transaction.</p>
        <p><strong className="text-[#111827]">$99 Deposit:</strong> Fully refundable if no deal is selected. Credited toward the $499 concierge fee if you proceed.</p>
        <p><strong className="text-[#111827]">$499 Fee:</strong> Charged only after you select a deal. Covers everything from auction to vehicle pickup.</p>
        <p><strong className="text-[#111827]">Data:</strong> Your prequalification data is encrypted at rest and never shared with dealers until you select a deal.</p>
        <p><strong className="text-[#111827]">FCRA:</strong> Credit checks are soft-pull only and do not affect your score.</p>
      </div>

      <div className="flex flex-col gap-3">
        <form action={acceptTermsAction}>
          {/* Pass original destination so buyer returns there after accepting */}
          {redirect && (
            <input type="hidden" name="redirect" value={redirect} />
          )}
          <Button type="submit" className="w-full" size="lg" data-testid="accept-terms-btn">
            I Accept — Continue
          </Button>
        </form>
        <div className="text-center">
          <Link href="/legal/terms" target="_blank" className="text-xs text-[#94A3B8] hover:text-[#0B5FD1] hover:underline transition-colors" data-testid="view-full-terms-link">
            Read full Terms of Service →
          </Link>
        </div>
      </div>
    </div>
  );
}
