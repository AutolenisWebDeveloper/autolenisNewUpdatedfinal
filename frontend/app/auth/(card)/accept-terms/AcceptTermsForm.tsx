"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { acceptTermsAction } from "@/lib/auth/actions";

// The accept-terms submit path.
//
// This is a Client Component for one reason: the acceptance round-trip was the
// ONLY state in this flow with no visible feedback. Every other outcome already
// renders something — a failed store write returns here with an error banner,
// an unhandled throw hits app/auth/error.tsx, and the destination has its own
// loading.tsx. But that loading boundary only appears once the action has
// returned its redirect, and acceptTermsAction makes three sequential round
// trips first (Supabase getUser, the Prisma stamp, the user_metadata sync).
// Throughout that window the page rendered identically and the button stayed
// live, so a slow or lost transition was indistinguishable from a dead button —
// exactly how this was reported: "clicking I Accept — Continue did nothing".
//
// useFormStatus gives the buyer feedback for that window and disables the
// button while the action is in flight, so a re-click cannot restart the action
// mid-transition. The form still posts natively without JS — the action is a
// server action, so progressive enhancement is unchanged.

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <>
      <Button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="w-full"
        size="lg"
        data-testid="accept-terms-btn"
      >
        {pending ? "Saving your acceptance…" : "I Accept — Continue"}
      </Button>
      {/* Announce the in-flight state to assistive tech: disabling the button
          can move focus, so the label change alone is not reliably announced. */}
      <span aria-live="polite" className="sr-only">
        {pending ? "Saving your acceptance, please wait." : ""}
      </span>
    </>
  );
}

export default function AcceptTermsForm({ redirectTo }: { redirectTo?: string }) {
  return (
    <form action={acceptTermsAction}>
      {/* Pass original destination so buyer returns there after accepting */}
      {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}
      <SubmitButton />
    </form>
  );
}
