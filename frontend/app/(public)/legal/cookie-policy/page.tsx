import type { Metadata } from "next";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.cookiePolicy);
export default function CookiePolicyPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-20" data-testid="legal-cookie-policy-page">
      <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">Legal</p>
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Cookie Policy</h1>
      <p className="text-sm text-slate-400 mb-10">Last updated: January 1, 2026</p>
      <div className="prose prose-slate max-w-none space-y-6 text-slate-700 leading-relaxed text-sm">
        <p>This Cookie Policy explains how AutoLenis, Inc. uses cookies and similar tracking technologies on our website and platform. By using our Services, you consent to the use of cookies as described in this policy.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">What Are Cookies?</h2>
        <p>Cookies are small text files placed on your device by websites you visit. They are widely used to make websites work efficiently, provide a better user experience, and provide reporting information to site owners.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">Types of Cookies We Use</h2>
        <div className="space-y-4">
          <div className="border-l-2 border-[#0B5FD1]/20 pl-4">
            <p className="font-semibold text-slate-800">Essential Cookies (Always Active)</p>
            <p>Required for the platform to function. These include session authentication cookies, CSRF protection tokens, and user preference storage. Cannot be disabled.</p>
          </div>
          <div className="border-l-2 border-slate-200 pl-4">
            <p className="font-semibold text-slate-800">Functional Cookies</p>
            <p>Remember your preferences, such as saved search filters and notification settings. These can be disabled without affecting core platform functionality.</p>
          </div>
          <div className="border-l-2 border-slate-200 pl-4">
            <p className="font-semibold text-slate-800">Analytics Cookies</p>
            <p>Help us understand how users interact with our platform so we can improve the experience. We use privacy-first analytics that do not track across sites. You may opt out at any time.</p>
          </div>
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">Managing Cookies</h2>
        <p>You can control cookies through your browser settings. Disabling essential cookies will affect platform functionality including authentication. Non-essential cookies can be managed through our cookie preference center.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">Third-Party Cookies</h2>
        <p>We use Stripe for payment processing. Stripe may set cookies for fraud prevention purposes. These are essential service cookies and cannot be disabled without affecting payment functionality.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">Contact</h2>
        <p>Cookie-related inquiries: privacy@autolenis.com</p>
      </div>
    </article>
  );
}
