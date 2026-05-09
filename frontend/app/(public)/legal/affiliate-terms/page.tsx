import type { Metadata } from "next";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.affiliateTerms);
export default function AffiliateTermsPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-20" data-testid="legal-affiliate-terms-page">
      <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">Legal</p>
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Affiliate Program Terms</h1>
      <p className="text-sm text-slate-400 mb-10">Last updated: January 1, 2026</p>
      <div className="prose prose-slate max-w-none space-y-6 text-slate-700 leading-relaxed text-sm">
        <p>These Affiliate Program Terms (&quot;Affiliate Terms&quot;) govern participation in the AutoLenis Affiliate Program. By enrolling in the program, you agree to these Affiliate Terms in addition to the AutoLenis general Terms of Service.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">1. Enrollment</h2>
        <p>Participation in the AutoLenis Affiliate Program is open to individuals and entities who create an account and are approved by AutoLenis. AutoLenis reserves the right to approve or reject affiliate applications at its sole discretion.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">2. Commission Structure</h2>
        <p>AutoLenis operates a 3-level affiliate commission model. Commissions are calculated as a percentage of the $499 AutoLenis concierge fee on completed transactions:</p>
        <ul className="list-none space-y-2 ml-0">
          <li><strong>Level 1 (Direct Referral):</strong> 15% — $74.85 per completed deal</li>
          <li><strong>Level 2:</strong> 3% — $14.97 per completed deal originated by an L1 referral</li>
          <li><strong>Level 3:</strong> 2% — $9.98 per completed deal originated by an L2 referral</li>
        </ul>
        <p>Total maximum commission payout across all levels: 20% of the concierge fee. No Level 4 or Level 5 commissions exist under any circumstances.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">3. Commission Triggers</h2>
        <p>Commissions are triggered only upon successful payment of the AutoLenis $499 concierge fee (Stripe checkout.session.completed event with type=service_fee). Commissions are not earned on deposits, refunds, or cancelled deals.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">4. Commission Reversals</h2>
        <p>If a concierge fee payment is refunded, all associated commissions are reversed. Commissions subject to reversal are not eligible for payout until the reversal window has passed.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">5. Self-Referral Prohibition</h2>
        <p>Affiliates may not refer themselves or create accounts for the purpose of earning commissions on their own transactions. Self-referral results in immediate disqualification and forfeiture of all pending commissions.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">6. Marketing Standards</h2>
        <p>Affiliates must accurately represent the AutoLenis platform in all promotional materials. Misleading claims, spam, and paid search bidding on AutoLenis brand terms are prohibited. TCPA compliance is required for all affiliate communications.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">7. Payout</h2>
        <p>Commissions are paid on a monthly basis to the payment method on file, subject to a minimum payout threshold of $25. AutoLenis reserves the right to hold commissions pending deal verification.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">8. Termination</h2>
        <p>AutoLenis may terminate affiliate participation for violations of these terms, fraudulent activity, or inactivity exceeding 12 months.</p>
      </div>
    </article>
  );
}
