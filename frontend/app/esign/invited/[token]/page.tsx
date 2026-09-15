import type { Metadata } from "next";

// noindex, nofollow — unconditionally. This URL carries a bearer credential in its path, and
// the private-portal boundary in autolenis-accessibility-performance-seo applies with more
// force here than anywhere else in the app: an indexed signing link is a leaked one.
export const metadata: Metadata = {
  title: "Sign Your Contract",
  robots: { index: false, follow: false, nocache: true },
};

import { PenLine, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { resolveSignerToken, type SignerTokenReason } from "@/lib/services/esign/invited-signer.service";
import InvitedSigningCeremony from "@/components/esign/InvitedSigningCeremony";

export const dynamic = "force-dynamic";

/**
 * CONDITION 6 — a spent or expired link renders a NAMED STATE, not an error.
 *
 * A co-buyer clicking their link a second time is the COMMON case, not an edge: they signed,
 * the page said so, and later they open the email again to check. "Something went wrong" is
 * the wrong answer to that, and a 404 is worse — it suggests they were never invited.
 *
 * Every reason therefore gets its own sentence, its own icon, and its own tone. None of them
 * says "error", because from the co-buyer's side none of them is one.
 */
const STATES: Record<SignerTokenReason, { icon: "done" | "clock" | "warn"; heading: string; body: string }> = {
  consumed: {
    icon: "done",
    heading: "You've already signed",
    body:
      "This contract has your signature. There's nothing else for you to do — we'll email you a copy of the fully executed agreement once the dealership has countersigned it.",
  },
  expired: {
    icon: "clock",
    heading: "This signing link has expired",
    body:
      "Signing links are short-lived for your protection. Ask the buyer on this deal to request a new one from AutoLenis, and we'll send you a fresh link.",
  },
  envelope_not_signable: {
    icon: "warn",
    heading: "This contract is no longer the one to sign",
    body:
      "The agreement was withdrawn or revised after this link was sent, so it can't be signed as it stands. If a corrected contract is issued you'll receive a new link.",
  },
  subject_mismatch: {
    icon: "warn",
    heading: "This link no longer applies to you",
    body:
      "The signing requirements on this deal have changed since the link was sent. Please contact AutoLenis if you believe you should still be signing.",
  },
  not_a_co_buyer_token: {
    icon: "warn",
    heading: "This link can't be used here",
    body: "Please use the link from your own invitation email, or contact AutoLenis for help.",
  },
  not_found: {
    icon: "warn",
    heading: "We couldn't find this signing link",
    body:
      "The link may have been truncated by your email client. Try opening it again from the original message, or contact AutoLenis for a new one.",
  },
};

function StateCard({ reason }: { reason: SignerTokenReason }) {
  const s = STATES[reason];
  const Icon = s.icon === "done" ? CheckCircle2 : s.icon === "clock" ? Clock : AlertTriangle;
  const tone =
    s.icon === "done" ? "text-green-600" : s.icon === "clock" ? "text-amber-500" : "text-slate-400";
  return (
    <div
      className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 text-center"
      data-testid={`invited-signer-state-${reason}`}
    >
      <Icon size={32} className={`${tone} mx-auto mb-4`} aria-hidden="true" />
      <h1 className="text-lg font-bold text-slate-900 mb-2">{s.heading}</h1>
      <p className="text-sm text-slate-600 max-w-md mx-auto">{s.body}</p>
    </div>
  );
}

export default async function InvitedSignerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Resolving does NOT consume. A GET is safe to repeat, and a link-preview crawler in the
  // co-buyer's mail client cannot spend their one signature by fetching the page.
  const resolution = await resolveSignerToken(token);

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <PenLine size={24} className="text-al-primary" aria-hidden="true" />
          <span className="font-bold text-slate-900">AutoLenis</span>
        </div>

        {!resolution.ok ? (
          <StateCard reason={resolution.reason} />
        ) : (
          <InvitedSigningCeremony
            token={token}
            coBuyerName={resolution.view.coBuyerName}
            primaryBuyerFirstName={resolution.view.primaryBuyerFirstName}
            vehicle={resolution.view.vehicle}
            vin={resolution.view.vin}
            signingClosesAt={resolution.view.signingClosesAt?.toISOString() ?? null}
          />
        )}
      </div>
    </div>
  );
}
