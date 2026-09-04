---
description: Phase 2 — workflow/UX proposal with a before → after capability map. Stops at the owner gate; will not write code.
argument-hint: "<objective>, e.g. make the bulk publish flow safer"
disallowed-tools: Edit, Write, NotebookEdit
---

Phase 2 proposal for: $ARGUMENTS

**This command stops before implementation. It does not write code.** The Edit/Write
tools are removed from your pool for this turn by design. Owner approval of this
proposal is the implementation gate (`CLAUDE.md` → "Phased batches with a hard gate").
A request to improve a surface is **not** advance authorization to implement it.

If Phase 1 has not been run for this surface in this session, run `/investigate` first
or do its work now — a proposal without an evidence base is a guess.

## 1. Objective

One sentence, in outcome terms. Then the non-goals: what this batch explicitly excludes.

## 2. Reuse before create

Run the reuse-before-create protocol
(`autolenis-system-architecture` → `reference/capability-index.md`) and state, for each
thing the batch needs:

| Need | Existing capability | REUSE / EXTEND / CONSOLIDATE / CREATE | Why |
|---|---|---|---|

`CREATE` needs a sentence saying what you searched for and did not find. Never build a
parallel or duplicate system.

## 3. Before → after capability map (mandatory)

Every route, control, action, and workflow from the Phase 1 inventory appears here.
This is the artifact that makes "simplification is not feature removal" checkable.

| # | Capability (before) | After | Disposition | Where it lives now |
|---|---|---|---|---|

Disposition is exactly one of: **KEPT** · **MOVED** · **REGROUPED** · **PROGRESSIVE**
(still reachable, behind a disclosure) · **RENAMED** · **REMOVED**.

**REMOVED requires explicit owner sign-off and its own line of justification.** A
capability may be moved, regrouped, or made progressive — it may never silently
disappear. Finish this section with the arithmetic: `N before → N after (X kept, Y
moved, Z regrouped, W progressive, V removed)`. If the counts do not reconcile, the
map is wrong.

## 4. Information architecture

Confirm the proposal preserves the established Content IA — Growth → `/admin/content`
as the primary rail destination, `/admin/content/bulk` and `/admin/content/attribution`
as related hubs, `/admin/content/[id]` as the detail drill-down. No competing navigation
system, no second sidebar, no independent page chrome. Say explicitly if the batch
touches navigation at all.

## 5. Design

The workflow and UX, at the level someone could disagree with: screens and states
(loading / empty / error / success), the interaction model, responsive behavior,
accessibility, destructive-action confirmation, and which existing design-system
components are reused (`autolenis-ui-design-system`). Prefer one strong proposal to a
menu of options; name the alternative you rejected and why, in one line.

## 6. Blast radius

Files and services to be touched · models and state transitions affected · callers and
consumers downstream · migrations (new file only — never edit an existing one) ·
RLS implications · jobs/crons · third-party adapters · what could regress.

## 7. Security & authorization

What the server will enforce, and where. Confirm no change to any server authorization
boundary — that requires a separately authorized security batch. Confirm no PII
exposure is added, and name any PII the surface already handles.

## 8. Test plan

The specific cases, mapped to the repo's real harness — `node:test` run through `tsx`
(`tsx --test`), plus Playwright for visual/E2E. Do not invent a framework. Name the
`test:*` script each new file belongs to; a `*.test.ts` unreachable from a `test:*`
script fails `pnpm test:coverage-check`.

## 9. Rollback

How this is undone if it goes wrong, and what cannot be undone.

## 10. What is NOT verifiable here

There is no non-production authenticated environment; branch previews share the
PRODUCTION Supabase project. State up front which acceptance criteria will end as
**NOT VERIFIED** and why. That is the correct answer on this repo, not a gap to close
by provisioning infrastructure or weakening authentication.

---

Finish with exactly this, and then **stop**:

```
PHASE 2 PROPOSAL — AWAITING OWNER APPROVAL
Capability map: N before → N after (V removed)
Not verifiable without owner action: <list>
Implementation will not begin until the owner approves this proposal explicitly.
```

Do not continue into Phase 3 in the same turn, and do not treat silence, enthusiasm, or
a follow-up question as approval.
