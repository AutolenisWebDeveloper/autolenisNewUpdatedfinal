import type { Metadata } from "next";

export const metadata: Metadata = { title: "Account Suspended", robots: { index: false, follow: false } };

// /buyer/suspended — shown to suspended buyers attempting to access the portal
// No navigation — standalone page explaining the account is suspended

import { getAuthenticatedBuyer } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function BuyerSuspendedPage() {
  // Require authentication — but do NOT call requireBuyer() which would
  // redirect suspended buyers. Check auth manually and redirect only
  // unauthenticated visitors. Non-suspended buyers go to the dashboard.
  const buyer = await getAuthenticatedBuyer();
  if (!buyer) redirect("/auth/signin");
  if (!buyer.isSuspended) redirect("/buyer/dashboard");

  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@autolenis.com";
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Account Suspended</h1>
        <p className="text-gray-600 text-sm mb-6 leading-relaxed">
          Your AutoLenis buyer account has been temporarily suspended by our team.
          You cannot access your account at this time.
        </p>
        <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
          <p className="text-sm text-gray-700 font-medium mb-1">Need help?</p>
          <p className="text-sm text-gray-600">
            Contact our support team to resolve this issue or appeal the suspension.
          </p>
        </div>
        <a
          href={`mailto:${supportEmail}?subject=Account Suspension Appeal`}
          className="inline-flex items-center justify-center gap-2 bg-al-primary text-white font-semibold text-sm px-6 py-3 rounded-xl hover:bg-al-primary-hover transition-colors"
        >
          Contact Support
        </a>
        <p className="mt-4 text-xs text-gray-400">{supportEmail}</p>
      </div>
    </div>
  );
}
