# Dealer Entry Funnel — Interaction & Visual Design

**Companion to** `docs/dealer-funnel-remediation-plan.md`. Screens covered: claim landing, sign-in
with a PENDING account, the four onboarding steps, manual inventory add, and both CSV upload paths.

**Tooling note, stated plainly:** the `frontend-design` skill named in the brief **is not available in
this session**. This design was produced against `autolenis-ui-design-system` (rank-1 token layer in
`app/globals.css`) and the promoted kit in `components/admin/crm/ui/`, and is audited with
`impeccable` in Phase 5. No new design language is introduced.

## 0. System constraints this design obeys

- **Tokens only.** `--color-al-*` utilities (`bg-al-primary`, `text-al-danger`, `border-al-border`,
  `rounded-al-lg`, `shadow-al-1`). No raw hex. `font-display` for headings, `font-body` for copy.
- **Kit first.** `EmptyState`, `ErrorState`, `Skeleton`, `Button`, `Badge`/`StatusPill`,
  `ConfirmDialog`, `PageHeader` from `components/admin/crm/ui/`.
- **Focus is never removed:** `focus-visible` ring 2px + 2px offset in `--color-al-focus`.
- **Status is never colour-only** — every state pairs colour with text and an icon.
- **Server Components by default**; the client boundary is the interactive leaf only.
- **No success message without persisted state.** Every "Saved" in this document is rendered *after*
  a 2xx whose body reflects a real write.

## 1. Governing principle — the funnel never dead-ends

Every screen below answers three questions in its markup: *where am I*, *what is wrong*, *what do I do
next*. Any terminal-looking state (expired token, consumed token, suspended account) must offer a
forward action or a named human contact. A bare "Access denied" is a defect in this funnel.

## 2. Claim landing — `/dealer/claim?token=…`

Server Component resolves the token via `validateClaimToken`; a small client leaf owns the password form.

| State | Trigger | Design |
| --- | --- | --- |
| **Loading** | token being validated | `Skeleton` — a card-height block with two input-height bars. No spinner-only screen. |
| **Valid** | `ok: true` | `PageHeader` "Set your password", dealership name as subtitle, two password fields with a live requirements list (8+ chars, one number), primary `Button` "Create account and continue". |
| **Invalid / not found** | `reason: "not_found"` | `ErrorState`, title "This link isn't valid", body naming the likely cause (copied wrong / truncated by an email client), action **Request a new link** → `mailto:` the dealer-relations address, secondary **Go to sign-in**. |
| **Expired** | `reason: "expired"` | `ErrorState` in `--color-al-warning`, "This invitation has expired", body giving the 7-day window, primary action **Request a new link**. Never a redirect to sign-in — that is the D1 failure mode restated as UX. |
| **Consumed** | `reason: "consumed"` | "This link has already been used" + primary **Sign in** (the account exists), secondary **Forgot password**. |
| **Submitting** | form POST in flight | Button enters loading, inputs `aria-busy`, form disabled. |
| **Error on submit** | 4xx/5xx | Inline `role="alert"` above the button; field-level messages under the offending field. Password is **never** cleared on error. |
| **Success** | 201 + session minted | Full-page redirect to `/dealer/onboarding` — no toast that outlives the navigation. |

**Mobile:** single column, 16px gutters, inputs full-width min 44px tall, the requirements list stacks
under the field rather than beside it.

## 3. Sign-in with a PENDING account — `/dealer/sign-in`

The behavioural change: PENDING no longer 403s. The dealer signs in and is routed to onboarding.

| State | Design |
| --- | --- |
| **Default** | Unchanged existing form. |
| **PENDING success** | 200 with `redirect: "/dealer/onboarding"`; client navigates. A one-line `Badge` (warning tone, icon + text "Onboarding incomplete") renders on arrival — informative, not an error. |
| **SUSPENDED / TERMINATED** | Existing 403 retained, `ErrorState` with the account-status message and a **Contact dealer relations** action. Deliberately terminal (§2.4 S7/S8) — but still names a next step. |
| **Bad credentials** | Existing generic message; never discloses whether the email exists. |

## 4. Onboarding — `/dealer/onboarding`, four steps

Stepper: `BUSINESS_INFO → LICENSE → INVENTORY → AGREEMENT`, then `COMPLETE`.

**Resume rule (the core requirement).** The server is the source of truth: `GET /api/dealer/onboarding`
returns the persisted `onboardingStep`, and the client opens **exactly that step**. A dealer who closes
the tab at step 3 returns to step 3 — never to step 1, never past their real progress. Steps already
completed are revisitable (to correct a typo); steps ahead are not clickable.

| Step | Complete when | Validation surfaced |
| --- | --- | --- |
| 1 Business info | name, phone, address, city, state, ZIP persisted | Inline per-field on blur; state is a select of the 50 codes; ZIP masked to 5 digits |
| 2 License | `recordDealerLicense` returns ok | 422 renders the server's reason under the field, not a generic failure |
| 3 Inventory (feed optional) | step advanced | Explicitly labelled **Optional** with a "Skip for now" secondary action, so nobody stalls behind a DMS URL they do not have |
| 4 Agreement | signature recorded → ACTIVE | Scroll-to-end required before the sign button enables; the enable condition is stated in text above the button, not implied by a dead control |

| State | Design |
| --- | --- |
| **Loading** | `Skeleton` stepper + form; the stepper renders immediately with the known step count so the page does not reflow. |
| **Empty** | Not applicable — every step always has fields. |
| **Saving** | Button loading; the stepper does **not** advance until the 2xx lands. |
| **Error** | Inline `role="alert"`; the step does not advance; entered values are preserved. |
| **Success (steps 1–3)** | Stepper advances; a `Badge` marks the step done. |
| **Success (step 4)** | Full-page transition to `/dealer/dashboard` with a success banner sourced from the dealer's real `status === "ACTIVE"`, not from a client flag. |

**Token fix while here:** `onboarding/page.tsx:33` currently uses `bg-[#059669]` / `bg-[#E2E8F0]`.
Replace with `bg-al-success` / `bg-al-border`. Completed-step colour is paired with a check icon and
the step label's `aria-current`, so progress is never colour-only.

**Mobile:** the horizontal stepper collapses to "Step 2 of 4 — License" plus a progress bar; the form is
single-column; the primary action is a full-width sticky footer button.

## 5. Manual inventory add — `/dealer/inventory/add`

| State | Design |
| --- | --- |
| **Default** | Condition becomes a 3-option select — **New / Used / Certified Pre-Owned** — sending `NEW`/`USED`/`CPO`. This is the D8 fix expressed in the UI: the control can no longer emit a value the API rejects. |
| **VIN decoding** | The VIN field shows an inline "Decoding…" affordance; decoded year/make/model populate and are marked "from VIN — edit if wrong". Decode failure is a non-blocking notice, never a hard stop: manual entry stays available. |
| **Validation error** | Field-level messages from the zod issue path, so `condition` and `description` errors land on their own fields rather than in a banner. |
| **Duplicate VIN (409)** | Distinct message: "You already have a vehicle with this VIN", with a link to that item. For a VIN owned by another tenant the message stays generic (no cross-tenant disclosure) and offers the support path. |
| **Success** | Redirect to `/dealer/inventory` with the new row visible. The success state is the row, not a toast. |

## 6. CSV upload — both paths

**One price convention, stated in the UI**, matching the plan §3: a helper line under the file input
reads *"Prices are read as dollars — `25000` means $25,000.00. Use a `price_cents` column header if your
export is already in cents."* The 100× ambiguity is removed from the product, not just the parser.

| State | Design |
| --- | --- |
| **Idle** | Drop zone + "Choose file", accepted format list, a **Download sample CSV** link. |
| **Parsing** | `Skeleton` table of the first rows. |
| **Preview (standard headers)** | Table rendered **from parsed cents** formatted back to currency — so what the dealer sees is what will be stored. This is the D11 fix expressed in the UI: the preview can no longer disagree with the write. |
| **Preview (non-standard headers)** | Mapping UI listing the dealer's **actual** CSV headers, each with a target-field select. Not a hardcoded column list. |
| **Row errors** | Per-row inline errors with row numbers; valid rows remain importable; the count of skipped rows is explicit with reasons. |
| **Importing** | Progress with a determinate count when known. |
| **Result** | "Imported N of M". Every skipped row is itemised with a reason — including a VIN already present — because a silent `skipDuplicates` drop reported as "skipped" is what made this path untrustworthy. |
| **Empty / all-invalid** | `EmptyState` naming the first concrete problem and linking the sample file. |

**Mobile:** the preview table scrolls inside `overflow-x:auto`; the page body never scrolls sideways.

## 7. Accessibility commitments

- Every error region is `role="alert"` and referenced by `aria-describedby` from its field.
- The stepper is a `<nav aria-label="Onboarding steps">` with `aria-current="step"`.
- Contrast: `--color-al-text-subtle` (4.8:1) only at ≥12px; all interactive text meets 4.5:1.
- Full keyboard traversal of the stepper, the mapping selects, and the drop zone (which has a real
  `<input type="file">` behind it, not a div listener).
