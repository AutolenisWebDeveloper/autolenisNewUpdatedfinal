// In-flight idempotency decision logic for inbound Make.com dispatches.
// Kept in its own dependency-free module (no next/server, prisma, or supabase
// imports) so the duplicate-handling semantics are unit-testable in isolation.

// How a duplicate idempotency key is handled, derived purely from the prior
// request's execution_status:
//   - 'replay'  → the original COMPLETED; return its stored response_payload.
//   - 'reclaim' → the original FAILED; not-yet-succeeded, so allow a retry.
//   - 'reject'  → the original is still PROCESSING (or unknown); tell the caller
//                 to retry (409). NEVER return the still-null payload as a 200.
export type DuplicateDecision = 'replay' | 'reclaim' | 'reject';

export function resolveDuplicateDispatch(
  status: string | null | undefined,
): DuplicateDecision {
  switch (status) {
    case 'completed':
      return 'replay';
    case 'failed':
      return 'reclaim';
    default:
      // 'processing' or any unexpected value — fail safe to a retryable reject.
      return 'reject';
  }
}
