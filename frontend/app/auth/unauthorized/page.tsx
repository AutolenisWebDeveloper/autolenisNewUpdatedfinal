import Link from "next/link";
import { ShieldOff, LifeBuoy } from "lucide-react";
import { signOutAction } from "@/lib/auth/actions";

// Reason-aware copy. The generic "Access Restricted" message is wrong for a
// buyer whose account provisioning never finished — they DO have permission,
// their account record is incomplete — so telling them to "sign in with the
// correct account" sends them in a circle.
const REASONS: Record<string, { title: string; body: string }> = {
  account_setup: {
    title: "We couldn't finish setting up your account",
    body:
      "Your sign-in worked, but your AutoLenis buyer profile didn't finish being created, so the portal has nothing to show you yet. Signing out and back in usually completes it. If it doesn't, contact support and we'll finish it for you.",
  },
};

const DEFAULT = {
  title: "Access Restricted",
  body:
    "You don't have permission to access this area. If you believe this is a mistake, please sign in with the correct account.",
};

interface Props {
  searchParams: Promise<{ reason?: string }>;
}

export default async function UnauthorizedPage({ searchParams }: Props) {
  const { reason } = await searchParams;
  const copy = (reason && REASONS[reason]) || DEFAULT;
  const isAccountSetup = reason === "account_setup";

  return (
    <div className="min-h-screen bg-[#F8F9FB] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-10 text-center">
        <div className="w-16 h-16 rounded-full bg-[#EFF6FF] flex items-center justify-center mx-auto mb-6">
          {isAccountSetup ? (
            <LifeBuoy size={28} className="text-[#0B5FD1]" aria-hidden="true" />
          ) : (
            <ShieldOff size={28} className="text-[#0B5FD1]" aria-hidden="true" />
          )}
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-3">{copy.title}</h1>
        <p className="text-[#4B5563] text-sm leading-relaxed mb-8">{copy.body}</p>
        <div className="flex flex-col gap-3">
          {/* Sign out is the one action that reliably escapes a broken
              authenticated state: while a session exists, proxy.ts redirects
              this user off /auth/signin and back into the portal. */}
          <form action={signOutAction}>
            <button
              type="submit"
              data-testid="unauthorized-signout-btn"
              className="w-full py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FD1] focus-visible:ring-offset-2"
            >
              Sign Out and Try Again
            </button>
          </form>
          {isAccountSetup && (
            <a
              href="mailto:support@autolenis.com?subject=Account%20setup%20did%20not%20complete"
              className="w-full py-3 border border-[#E5E7EB] text-[#4B5563] font-medium text-sm rounded-xl hover:bg-[#F8F9FB] transition-colors inline-block"
            >
              Contact Support
            </a>
          )}
          <Link
            href="/"
            className="w-full py-3 border border-[#E5E7EB] text-[#4B5563] font-medium text-sm rounded-xl hover:bg-[#F8F9FB] transition-colors"
          >
            Return to Homepage
          </Link>
        </div>
      </div>
    </div>
  );
}
