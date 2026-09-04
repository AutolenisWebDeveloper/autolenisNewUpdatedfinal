# Master implementation prompt template — AutoLenis

Copy this, fill every section. If a section is genuinely N/A, write `N/A — <reason>`.
**A section left blank is the single biggest cause of a misunderstood objective.**

This template is the input to Phase 2 (`/plan`). It is not authorization to implement —
owner approval of the resulting Phase 2 proposal is the implementation gate
(`CLAUDE.md` → "Phased batches with a hard owner gate").

---

## Objective & business outcome

<!-- What must be true for the business/users after this ships. Outcome, not a task list. -->

## Non-goals / out of scope

<!-- Explicitly excluded. This is what prevents scope creep. -->

## Existing functionality that MUST be preserved

<!-- Named capabilities that must not regress. Every route, control, action, and
     workflow on the touched surface must appear in the before → after capability
     map. Simplification is not feature removal. -->

## Files/modules to inspect FIRST (investigate before coding)

<!-- Known entry points. Claude must trace end-to-end, cite file:line, and build an
     EVIDENCE TABLE before writing code. Name anything that must be verified rather
     than assumed. Start with /investigate <surface>. -->

## Architecture constraints & invariants

<!-- e.g. business logic lives in frontend/lib/services/**; route handlers stay thin;
     no raw third-party SDK calls outside adapters; money is integer minor units;
     server-side authorization always; RLS is the security boundary; target the
     current engine, not the legacy one. Name the owning autolenis-* skill. -->

## Data-model implications

<!-- New Prisma migration? Backfill? RLS policy change? Index impact?
     NEVER edit an existing file in frontend/prisma/migrations/** or
     frontend/migrations/** — add a new one.
     Migrations are applied by CI/owner, never from a Claude session. -->

## Integration points

<!-- Routes, services, external adapters (Stripe, Supabase, Twilio, Resend, DocuSign,
     MicroBilt, MarketCheck, Groq/Anthropic/Gemini), QStash/cron jobs, webhooks. -->

## Edge cases & failure modes

<!-- Enumerate them AND specify expected handling for each: retries, duplicates /
     idempotency, malformed input, partial provider failure, timeout, stale data,
     concurrency, authorization failure, empty state, recovery. -->

## Security / authorization boundaries

<!-- Who may do what; buyer/dealer/admin/affiliate scoping; dealer isolation; tenant
     and RLS scoping; input trust boundaries; webhook signature verification; PII in
     logs. Server-side authorization always — frontend role checks are UX only. -->

## UI/UX requirements

<!-- States: loading / empty / error / success. Responsive behavior. Accessibility
     (WCAG 2.2 AA). Destructive-action confirmation. Which existing design-system
     components to reuse (autolenis-ui-design-system). Preserve the established
     information architecture — no competing navigation, no second sidebar. -->

## Test requirements (mapped to the repo's ACTUAL harness)

<!-- The harness is node:test run through tsx (`tsx --test`), plus Playwright for
     visual/E2E. Do NOT invent Jest/Vitest. Name the specific cases and the
     `test:*` script each belongs to; a new *.test.ts must be reachable from a
     test:* script or `pnpm test:coverage-check` fails. -->

## Verification steps

<!-- From frontend/:
       pnpm typecheck
       pnpm lint
       pnpm test:coverage-check
       pnpm test:all
       pnpm build            (needs Prisma/Supabase env values)
       pnpm test:visual      (UI changes)
     Browser verification via the Playwright MCP is READ-ONLY and
     unauthenticated/public paths only on this repo. Authenticated write paths are
     reported NOT VERIFIED — that is the correct answer here, not a failure. -->

## Acceptance criteria

<!-- Objective pass/fail checklist. Someone else should be able to score it. -->

## Authorization limits

<!-- What may be done autonomously vs what requires stopping and asking.
     Always requires separate explicit authorization: migrations against production,
     merges, deploys, server-authorization changes, deleting anything that merely
     looks obsolete. -->

## Required completion report format

<!-- Three-bucket verification with output shown:
       CODE-VERIFIED   — proven by tests/typecheck/lint/build, output shown
       BROWSER-VERIFIED — proven in a browser, read-only, public paths only
       NOT VERIFIED    — stated plainly, with the reason
     Plus: evidence table (claim → file:line), files changed and why, and an
     explicit before → after capability delta. -->
