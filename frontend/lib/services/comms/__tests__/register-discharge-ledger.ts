// lib/services/comms/__tests__/register-discharge-ledger.ts
//
// §27.1 REGISTER ROWS THAT ARE NOT DISCHARGED BY AN ENQUEUE SITE — with the reason each
// one is not, where it lives rather than inside the test that enforces it.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// §8.3 makes Phase 10 assert that every `template_key` in the register has at least one
// enqueue site, and the gate's own message offers two dispositions: enqueue it, or "remove
// the registry entry with a recorded reason". Removing a registry entry deletes a
// communication the platform is supposed to send, which under CLAUDE.md's
// capability-preservation invariant is a REMOVED capability needing owner sign-off.
//
// There is a third case the binary misses: a message that IS SENT TODAY, reliably, on the
// older direct rail, whose migration to `comms_outbox` is not a plumbing change. Deleting
// its register row would be false (the message exists), and migrating it inside this batch
// would change something outside this batch's remit. So it is recorded, with the reason,
// and the gate enforces the record.
//
// ── THE SHAPE OF THE RULE, WHICH IS THE POINT ───────────────────────────────
//
// This is the same convention `direct-send-allowlist.ts` already uses next door: a named,
// reasoned ledger module beside the test that reads it. An entry is expensive — it needs a
// reason a reviewer can disagree with, a statement of how the message reaches its recipient
// today, and a named follow-up — and the ceiling is pinned so a second cannot appear in
// passing. `communications-register-completeness.test.ts` fails if a ledgered key GAINS an
// enqueue site, so the list cannot rot into a loophole.

export interface RegisterDischargeEntry {
  /** The registry constant, as an enqueue site would name it (`PHASE_2_TEMPLATES.X`). */
  readonly constantName: string;
  /** Its `template_key` value. */
  readonly templateKey: string;
  /** Why this row is not discharged by an enqueue site. Prose, not a label. */
  readonly reason: string;
  /** How the message actually reaches its recipient today. */
  readonly sentBy: string;
  /** What would discharge it properly, named so this is a tracked item and not an excuse. */
  readonly followUp: string;
  /**
   * The question that must be answered BEFORE the follow-up is attempted, and by whom — or the
   * explicit statement that there is none.
   *
   * Required, not optional, and the reason is the entry below: its follow-up is a compliance
   * migration whose correctness turns on a legal question this programme has no standing to
   * answer. A ledger that recorded only the follow-up would read as a work item somebody could
   * simply pick up. Naming the prerequisite is what stops that.
   */
  readonly openQuestion: string;
}

export const REGISTER_DISCHARGE_LEDGER: readonly RegisterDischargeEntry[] = [
  {
    constantName: "PREQUAL_DECLINED",
    templateKey: "prequal_declined",
    reason:
      // THE REQUIREMENT, CITED PRECISELY. An earlier framing of this entry reached for §12, which is
      // financing checkpoints (12a–12d) and has nothing to do with adverse action. The governing
      // lines are Stage 3 L394 and L398, the §26 register L1243, and §29 — corrected here rather
      // than repeated.
      "Required by Stage 3 L394 ('decline with applicable adverse-action information') and L398 " +
      "('delivery outcome is recorded as sent, duplicate, or failed [BUILT]'), the §26 register " +
      "L1243, and §29's 'adverse-action outcomes distinguished'. NOT §12. " +
      "This is the FCRA §615 adverse-action notice, and it is SENT TODAY — the gap is the rail, " +
      "not the message. Moving it to the outbox is not a plumbing change: `sendAdverseActionEmail` " +
      "returns an `EmailSendOutcome` discriminant that four call sites feed to " +
      "`classifyAdverseActionDelivery`, which writes one of ADVERSE_ACTION_NOTICE_SENT / " +
      "_SUPPRESSED_DUPLICATE / _SEND_FAILED to `compliance_events`, and `raiseAdverseActionFollowUp` " +
      "opens a §26 row on anything that is not a confirmed delivery. `enqueueTransactional` returns " +
      "`{ enqueued }` — an ENQUEUE, not a delivery — so a faithful migration has to carry the " +
      "outbox's eventual delivery result BACK into the compliance record, or the audit trail starts " +
      "claiming a notice was sent when a row was written. §29 lists 'adverse-action outcomes " +
      "distinguished' among the safeguards that must not be weakened, and doing this inside a " +
      "control-plane batch would weaken it by accident. Phase 10 reports it rather than attempting it.",
    sentBy:
      "lib/services/email/resend.service.ts `sendAdverseActionEmail`, called from " +
      "prequal.service.ts, admin-prequal.service.ts, app/api/admin/prequal/[id]/decide/route.ts and " +
      "app/api/admin/buyers/[buyerId]/prequal/manual-override/route.ts — all four on the §8.4 " +
      "direct-send allowlist with removalPhase 10.",
    followUp:
      "An owner-approved compliance batch that migrates the §615 notice onto `comms_outbox` and " +
      "feeds the outbox's delivery result back into `compliance_events`, replacing the synchronous " +
      "`EmailSendOutcome` classification without losing the three outcomes §29 requires to stay " +
      "distinguishable. The register row and the direct sender both stay until then.",
    openQuestion:
      "WHETHER AN ENQUEUED NOTICE MAY EVER BE RECORDED AS DISCHARGING §615, AND WHAT TIMING " +
      "OBLIGATION ATTACHES. This is a legal question about the platform's own obligations, and " +
      "neither this programme nor the owner has ruled it — deliberately, and it was declined in " +
      "those words on 2026-09-18. COUNSEL SETTLES IT BEFORE THE FOLLOW-UP IS ATTEMPTED, because " +
      "the answer decides whether a synchronous ENQUEUED compliance row is a legitimate artefact " +
      "or a statement that a notice was sent when none was. A migration written before that answer " +
      "would be choosing one of those two by accident.",
  },
];

/**
 * How many rows may be ledgered. Pinned so a second cannot appear unnoticed.
 *
 * OWNER RULING 2026-09-18 (option A): the entry below is not a deferral — it is a DOCUMENTED
 * EXCEPTION, and §8.4's direct-send target was restated to match it: "zero §27.1 transactional
 * traffic WITHOUT A DOCUMENTED REASON", not literal zero. The ceiling and the
 * gains-an-enqueue-site check in `communications-register-completeness.test.ts` are what keep the
 * exception singular; raising this number is a decision about what §27.1 means, not a refactor.
 */
export const MAX_LEDGERED_ROWS = 1;
