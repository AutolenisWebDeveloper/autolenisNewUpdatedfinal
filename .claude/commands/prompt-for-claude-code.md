---
description: Turn a rough request into a complete, unambiguous implementation prompt using the AutoLenis template. Produces a prompt, not code.
argument-hint: "<rough request>, e.g. clean up the content review queue"
disallowed-tools: Edit, Write, NotebookEdit
---

Turn this rough request into a complete implementation prompt: $ARGUMENTS

The template to fill is here — read it and use its section headings verbatim:

@docs/claude/implementation-prompt-template.md

A blank section is the single biggest cause of a misunderstood objective. Fill every
one. Where a section is genuinely inapplicable, write `N/A — <reason>`; never leave it
empty and never delete the heading.

## How to fill it

**Ground it in this repository, not in generalities.** Before writing, look: find the
real entry points, the owning service under `frontend/lib/services/**`, the Prisma
models, and the existing tests. Name them by path. A prompt that says "the relevant
service" is a prompt that will be misread.

**Resolve what you can; ask only what matters.** Settle low-risk ambiguity from
repository evidence and existing conventions, and write the assumption into the prompt
so it is visible and correctable. Reserve questions for what would change business
behavior, security, data integrity, architecture, or scope.

**Get these right, because they are the ones that go wrong:**

- *Existing functionality that MUST be preserved* — list named capabilities, not "don't
  break anything". This is what the before → after capability map will be scored against.
- *Test requirements* — the harness is `node:test` run through `tsx` (`tsx --test`), plus
  Playwright for visual/E2E. Name the `test:*` script each new file belongs to. There is
  no Jest or Vitest here; a prompt that implies one produces a broken suite.
- *Verification steps* — from `frontend/`: `pnpm typecheck`, `pnpm lint`,
  `pnpm test:coverage-check`, `pnpm test:all`, `pnpm build`, and `pnpm test:visual` for
  UI. Browser checks are read-only and public paths only.
- *Data-model implications* — a new migration file only. Never edit an existing one, and
  never apply one from a Claude session.
- *Authorization limits* — say plainly what may be done autonomously and what stops for
  the owner. Migrations against production, merges, deploys, and server-authorization
  changes always stop.
- *Required completion report format* — three buckets (CODE-VERIFIED / BROWSER-VERIFIED /
  NOT VERIFIED), an evidence table, and an explicit capability delta.

**Write in the environment boundary.** There is no non-production authenticated
environment; branch previews share the PRODUCTION Supabase project. Say in the prompt
which acceptance criteria will end as NOT VERIFIED, so the answer is planned for rather
than improvised — and so nobody is tempted to manufacture a test environment.

## Output

Emit the finished prompt as a single fenced block the owner can copy without editing.
Below it, list — briefly — the assumptions you made and anything you could not resolve
from the repository. Do not begin the work.
