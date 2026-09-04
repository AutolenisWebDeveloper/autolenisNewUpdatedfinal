---
description: Phase 1 — read-only audit of a surface. Produces an evidence table and a full capability inventory. Changes nothing.
argument-hint: "<surface>, e.g. the /admin/content bulk publish flow"
disallowed-tools: Edit, Write, NotebookEdit
---

Phase 1 repository-first audit of: $ARGUMENTS

This is **read-only**. You are building the "before" side of the capability map and
the evidence base a Phase 2 proposal will rest on. The Edit/Write tools are removed
from your pool for this turn — that is deliberate, not an obstacle to route around.
Do not propose changes, and do not begin one.

Load `autolenis-system-architecture`, then `autolenis-domain-model`, then the domain
skill(s) that match the surface (see the routing table in `CLAUDE.md`).

## 1. Restate the objective

One sentence: what is this surface for, and what is being asked about it?

## 2. Trace it end to end

Follow the real execution path — route → server component / route handler → service →
Prisma model → back to the rendered UI. Read the running code. Where a doc, a comment,
a plan, or a root-level `*_AUDIT*.md` disagrees with the code, the code wins
(`CLAUDE.md` → Source-of-truth hierarchy).

## 3. Capability inventory (the "before" side of the map)

Enumerate **every** capability on the surface, each with a `file:line`. Nothing is too
small to list — a capability that is not written down here is one that can silently
disappear later.

| # | Capability | Kind | Where | Who may use it | Notes |
|---|---|---|---|---|---|

`Kind` is one of: route · navigation · control · action · bulk action · filter · sort ·
export · background job · API endpoint · state/empty/error surface.

Cover, at minimum: every route and nested segment (including `loading`/`error`
boundaries); every API endpoint that serves the surface and its HTTP methods; every
button, link, menu item, form field, filter, sort, and toggle; every bulk and row-level
action; every destructive action and whether it confirms; every export; every job or
cron the surface triggers; and the loading / empty / error / success states.

## 4. Evidence table

Cite `file:line` for every material claim — architecture conclusions, security and
authorization boundaries, database and RLS behavior, API contracts, business-workflow
behavior, and existing functionality. Routine narration needs no citation.

| # | Claim | Evidence (`file:line`) | Confidence |
|---|---|---|---|

Confidence is **VERIFIED** (read it in this session) or **UNVERIFIED** (say what would
settle it). No material claim may rest on an unverified assumption about this repo.

## 5. Authorization boundaries

For each entry point: what the server actually enforces, in which file and at which
line. Frontend role checks are UX only and must be recorded as such. Name any endpoint
whose gate is weaker than the UI implies.

## 6. Findings — report, never fix

List anything obsolete, duplicated, unfinished, misleading, dead, or risky. **Report it
for an owner decision; do not change or delete it**, and do not fold a fix into a later
batch without separate authorization. Note where a finding is already known and
ring-fenced in `CLAUDE.md`.

## 7. Open questions

Only the ones that would materially change business behavior, security, data
integrity, architecture, or scope. Resolve low-risk ambiguity from repository evidence
and state the assumption instead of asking.

---

End with: `PHASE 1 COMPLETE — no changes made. N capabilities inventoried, M claims
evidenced.` Then stop. The next step is `/plan`, and after that the owner's approval.
