// lib/services/ai/zura-transcript.service.ts
//
// The conversation-persistence SEAM. In Stage 3A this is a deliberate NO-OP.
//
// Why a stub and not the real thing: persisting authenticated transcripts needs
// `AiChatSession` to carry a polymorphic actor (its `buyer_id` is `NOT NULL` and
// buyer-only, so a dealer, affiliate, admin or public session cannot be
// represented) plus a `Buyer` FK with `onDelete: Cascade`, so account deletion
// reaches transcripts. That is a migration, and Stage 3B — every migration — is
// blocked until the production migration ledger is reconciled. Authoring a
// migration that cannot deploy invites it being applied out of band, which is
// the exact mechanism that produced the unrecorded migrations in the first place.
//
// Why the seam exists NOW rather than being added in 3B: the shared chat service
// calls it on every turn, on every surface, with the full turn already in hand.
// Wiring the call site now means 3B replaces one function body instead of
// threading a new argument back through six surfaces.
//
// WHAT THIS MUST NOT DO, in 3A or 3B:
//   • It must never write `prisma.conversation`. In production that table is the
//     CRM inbox (contact_id / phone / channel / assigned_to / unread_count — no
//     session_id at all), not an AI table. No Zura persistence is designed onto it.
//   • It must never fail a reply. Persistence is FAIL-OPEN: a transcript write
//     failure degrades support, and support is worth less than the answer the
//     user is waiting for. (The audit write is the opposite — fail-loud.)
//
// Stage 3B fills in: the `AiChatSession` upsert keyed on the polymorphic actor
// plus surface, two `AiChatMessage` rows per turn, and the 90-day retention drain.

import { logger } from "@/lib/logger";
import type { ActorType, AuthenticatedRole } from "@/lib/services/ai/action-intent";
import type { ZuraSurface } from "@/lib/ai/context-builder";

export interface TranscriptTurn {
  chatSessionId: string;
  surface: ZuraSurface;
  actor: {
    actorType: ActorType;
    actorId: string;
    authenticatedRole: AuthenticatedRole | null;
  };
  userMessage: string;
  assistantMessage: string;
  /** The model that actually answered, including a fallback. */
  model: string;
}

/** True once 3B has landed the schema change and enabled persistence. */
export function isTranscriptPersistenceEnabled(): boolean {
  // Hard-coded false in 3A. 3B replaces this with the real gate; until then it
  // is a single, greppable, obviously-inert expression rather than a config
  // value that could be flipped on against a schema that cannot hold the data.
  return false;
}

/**
 * Persist one turn. NO-OP in Stage 3A — see the header.
 *
 * Returns `false` when nothing was written so a caller can tell "persistence is
 * off" from "persistence ran". Never throws.
 */
export async function persistTurn(turn: TranscriptTurn): Promise<boolean> {
  if (!isTranscriptPersistenceEnabled()) return false;

  try {
    // Stage 3B implementation goes here. Intentionally unreachable in 3A.
    logger.warn("[zura-transcript] persistence enabled but unimplemented", {
      surface: turn.surface,
      chatSessionId: turn.chatSessionId,
    });
    return false;
  } catch (err) {
    // FAIL-OPEN: warn, never error, never rethrow. The reply already shipped.
    logger.warn("[zura-transcript] transcript write failed (reply unaffected)", {
      surface: turn.surface,
      err,
    });
    return false;
  }
}
