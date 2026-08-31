// Phase 5 — the queue read-model: "who do I contact right now, and how?"
//
// WHY CONTACTABILITY IS NOT THE PLANNED FOUR OUTCOMES. The plan specified
// EMAIL_READY | SMS_READY | BOTH_READY | UNREACHABLE. Against the real data that
// model misleads: email coverage is 167/1,532, SMS reaches ZERO prospects
// (consent_basis defaults to NONE), and phone coverage is 1,527/1,532. It would
// therefore mark ~1,365 prospects UNREACHABLE — every one of which a human can
// call today, which is exactly what Phase 3 shipped enabled. A queue that hides
// its own addressable audience is worse than no queue.
//
// So contactability reports which CHANNELS are open. UNREACHABLE means nothing
// works, not "no email".
//
// PERSONNEL COME FROM dealer_contact_profiles ONLY. 594 dealer_prospects rows
// carry contact_name, and contact_source is NULL on all 1,532 — zero provenance
// for any of them. contact-resolution.service already treats those as
// untrustworthy (it CLEARS the person block when it falls back to a role inbox).
// Surfacing them in a work queue would present a guess as a fact to the person
// about to dial.

import { SEND_SAFE_STATUSES } from "./contact-resolution.service";
import { evaluateConsentBasis, type ConsentBasis } from "@/lib/services/sms/consent-basis";
import { normalizePhone } from "@/lib/utils/phone";
import { DealerProspectStatus, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

export type Contactability =
  | "EMAIL_AND_CALL_READY"
  | "EMAIL_READY"
  | "CALL_READY"
  | "UNREACHABLE";

export type PrimaryAction = "SEND_EMAIL" | "LOG_CALL" | "NONE";

export interface OpenChannels {
  email: boolean;
  call: boolean;
  sms: boolean;
}

export interface ContactabilityResult {
  contactability: Contactability;
  channels: OpenChannels;
  dncBlocked: boolean;
  primaryAction: PrimaryAction;
  /** Machine-readable explanations for every closed channel. */
  reasons: string[];
}

export interface QueueSourceRow {
  prospectId: string;
  name: string;
  city: string | null;
  state: string | null;
  status: string;
  score: number | null;
  email: string | null;
  emailVerificationStatus: string | null;
  emailSuppressed: boolean;
  phone: string | null;
  phoneSuppressed: boolean;
  consentBasis: string | null;
  dncStatus: string | null;
  phoneType: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactSource: string | null;
  contactConfidence: string | null;
  apolloLastSyncedAt: Date | null;
  lastTouchAt: Date | null;
  lastTouchChannel: string | null;
}

export interface QueueRow extends ContactabilityResult {
  prospectId: string;
  name: string;
  city: string | null;
  state: string | null;
  status: string;
  score: number | null;
  /** The number to dial. Manual calling is the only outreach that ships
   *  enabled, so withholding it here would send the operator on a second
   *  lookup for every row in the queue. */
  phone: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactSource: string | null;
  contactConfidence: string | null;
  apolloLastSyncedAt: Date | null;
  lastTouchAt: Date | null;
  lastTouchChannel: string | null;
}

export interface QueueCounts {
  total: number;
  emailReady: number;
  callReady: number;
  smsReady: number;
  dncBlocked: number;
  unreachable: number;
}

export interface QueueFilters {
  /** "work" (default) hides UNREACHABLE; "unreachable" shows only those. */
  bucket?: "work" | "unreachable" | "all";
}

export interface ContactProfileRow {
  name: string;
  title: string;
  contactSource: string;
  contactConfidence: string;
  apolloLastSyncedAt: Date | null;
}

export interface OutreachQueueDeps {
  prisma: PrismaClient;
  loadRows: () => Promise<QueueSourceRow[]>;
  loadProfiles: (prospectIds: string[]) => Promise<Record<string, ContactProfileRow>>;
}

/** The default statuses a work queue shows: not yet contacted. */
const WORKABLE_STATUSES: DealerProspectStatus[] = [
  DealerProspectStatus.DISCOVERED,
  DealerProspectStatus.SCRIPTED,
  DealerProspectStatus.DRAFTED,
];

/**
 * Which channels are open for one prospect, and which single action to offer.
 *
 * Pure — no IO — so the rule is testable in isolation and the UI cannot drift
 * from it by re-deriving contactability in a component.
 */
export function resolveContactability(row: QueueSourceRow): ContactabilityResult {
  const reasons: string[] = [];

  // EMAIL — send-safe status AND not suppressed. "Send-safe" is imported from
  // contact-resolution rather than restated, so the queue and the send path
  // cannot disagree about what is sendable.
  let email = false;
  if (!row.email) {
    reasons.push("no_email");
  } else if (!(SEND_SAFE_STATUSES as readonly string[]).includes(row.emailVerificationStatus ?? "")) {
    reasons.push("email_not_send_safe");
  } else if (row.emailSuppressed) {
    reasons.push("email_suppressed");
  } else {
    email = true;
  }

  const phone = normalizePhone(row.phone ?? "");

  // CALL — a valid, unsuppressed number. A human dialling needs no consent
  // basis; TCPA governs automated dialling and messaging, not a person calling a
  // published business line. DNC does NOT close this channel: the operator is
  // shown a badge and decides, because hiding the row removes the information
  // rather than protecting anyone.
  let call = false;
  if (!phone) {
    reasons.push("no_phone");
  } else if (row.phoneSuppressed) {
    reasons.push("phone_suppressed");
  } else {
    call = true;
  }

  // SMS — the full shared gate. Same decision the send service will make, so the
  // queue never offers an action the send path would refuse.
  const consent = evaluateConsentBasis({
    basis: (row.consentBasis ?? "NONE") as ConsentBasis,
    dncStatus: row.dncStatus,
    phoneType: row.phoneType,
  });
  const sms = !!phone && !row.phoneSuppressed && consent.allowed;
  if (!sms && phone && !row.phoneSuppressed && consent.reason) {
    reasons.push(`sms_${consent.reason.toLowerCase()}`);
  }

  const dncBlocked = row.dncStatus !== "not_found";

  const contactability: Contactability =
    email && call ? "EMAIL_AND_CALL_READY" : email ? "EMAIL_READY" : call ? "CALL_READY" : "UNREACHABLE";

  // Email first when both are open: it costs no operator time, and a call is the
  // scarcer resource.
  const primaryAction: PrimaryAction = email ? "SEND_EMAIL" : call ? "LOG_CALL" : "NONE";

  return { contactability, channels: { email, call, sms }, dncBlocked, primaryAction, reasons };
}

async function defaultLoadProfiles(
  prospectIds: string[],
  prisma: PrismaClient,
): Promise<Record<string, ContactProfileRow>> {
  if (prospectIds.length === 0) return {};
  const rows = await prisma.dealerProspect.findMany({
    where: { id: { in: prospectIds }, rooftopId: { not: null } },
    select: {
      id: true,
      rooftop: {
        select: {
          contacts: {
            // The designated contact first; otherwise the most recently synced.
            orderBy: [{ isPrimaryContact: "desc" }, { apolloLastSyncedAt: "desc" }],
            take: 1,
            select: {
              name: true,
              title: true,
              contactSource: true,
              contactConfidence: true,
              apolloLastSyncedAt: true,
            },
          },
        },
      },
    },
  });
  const out: Record<string, ContactProfileRow> = {};
  for (const r of rows) {
    const c = r.rooftop?.contacts?.[0];
    // A profile with no provenance is no better than the prospect columns it is
    // meant to replace, so it is not surfaced either.
    if (!c?.name || !c.contactSource) continue;
    out[r.id] = {
      name: c.name,
      title: c.title ?? "",
      contactSource: c.contactSource,
      contactConfidence: c.contactConfidence ?? "",
      apolloLastSyncedAt: c.apolloLastSyncedAt,
    };
  }
  return out;
}

/**
 * The real queue query.
 *
 * Reads the prospect, its rooftop's best contact profile, and the most recent
 * outreach_log row. Last touch comes from the LOG rather than from
 * dealer_prospects.contacted_at: the column is derived and, on this data, has
 * never been written — the log is the source of truth for what actually happened.
 */
async function defaultLoadRows(prisma: PrismaClient): Promise<QueueSourceRow[]> {
  const prospects = await prisma.dealerProspect.findMany({
    where: { status: { in: WORKABLE_STATUSES } },
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      status: true,
      searchScore: true,
      email: true,
      emailVerificationStatus: true,
      phone: true,
      rooftop: {
        select: {
          contacts: {
            orderBy: [{ isPrimaryContact: "desc" }, { apolloLastSyncedAt: "desc" }],
            take: 1,
            select: { consentBasis: true, dncStatus: true, phoneType: true },
          },
        },
      },
      outreachLog: {
        // Most recent real touch. A `failed` row is an attempt, not a touch, so
        // it does not become the "last contacted" the operator reads.
        where: { status: { in: ["sent", "delivered", "replied"] } },
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { sentAt: true, channel: true },
      },
    },
    take: 500,
  });

  return prospects.map((p) => {
    const contact = p.rooftop?.contacts?.[0];
    const touch = p.outreachLog?.[0];
    return {
      prospectId: p.id,
      name: p.name,
      city: p.city,
      state: p.state,
      status: p.status,
      score: p.searchScore,
      email: p.email,
      emailVerificationStatus: p.emailVerificationStatus,
      // Suppression is a SEND-time check against Supabase, not a column on this
      // row. The queue shows the channel as open and the send service refuses if
      // it must — the alternative is a per-row remote lookup on every page load.
      emailSuppressed: false,
      phone: p.phone,
      phoneSuppressed: false,
      consentBasis: contact?.consentBasis ?? "NONE",
      dncStatus: contact?.dncStatus ?? null,
      phoneType: contact?.phoneType ?? null,
      contactName: null,
      contactTitle: null,
      contactSource: null,
      contactConfidence: null,
      apolloLastSyncedAt: null,
      lastTouchAt: touch?.sentAt ?? null,
      lastTouchChannel: touch?.channel ?? null,
    };
  });
}

/** Load the work queue with its channel counts. */
export async function loadOutreachQueue(
  filters: QueueFilters,
  deps?: Partial<OutreachQueueDeps>,
): Promise<{ rows: QueueRow[]; counts: QueueCounts }> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const loadRows = deps?.loadRows ?? (() => defaultLoadRows(prisma));
  const loadProfiles = deps?.loadProfiles ?? ((ids: string[]) => defaultLoadProfiles(ids, prisma));

  const source = await loadRows();
  const profiles = await loadProfiles(source.map((r) => r.prospectId));

  const resolved = source.map((r) => ({ row: r, contact: resolveContactability(r) }));

  const counts: QueueCounts = {
    total: resolved.length,
    emailReady: resolved.filter((r) => r.contact.channels.email).length,
    callReady: resolved.filter((r) => r.contact.channels.call).length,
    smsReady: resolved.filter((r) => r.contact.channels.sms).length,
    dncBlocked: resolved.filter((r) => r.contact.dncBlocked && r.contact.channels.call).length,
    unreachable: resolved.filter((r) => r.contact.contactability === "UNREACHABLE").length,
  };

  const bucket = filters.bucket ?? "work";
  const visible = resolved.filter(({ row, contact }) => {
    if (bucket === "unreachable") return contact.contactability === "UNREACHABLE";
    if (bucket === "all") return true;
    return (
      contact.contactability !== "UNREACHABLE" &&
      (WORKABLE_STATUSES as string[]).includes(row.status)
    );
  });

  // Highest score first. A null score sorts LAST — an unscored prospect is not
  // more promising than a scored one, and treating null as 0 would be a silent
  // claim we have not made.
  visible.sort((a, b) => (b.row.score ?? -1) - (a.row.score ?? -1));

  const rows: QueueRow[] = visible.map(({ row, contact }) => {
    const profile = profiles[row.prospectId];
    return {
      prospectId: row.prospectId,
      name: row.name,
      city: row.city,
      state: row.state,
      status: row.status,
      score: row.score,
      phone: row.phone,
      // Provenance-bearing profile data only. Never the prospect's own
      // contact_* columns, which have no source recorded anywhere.
      contactName: profile?.name ?? null,
      contactTitle: profile?.title ?? null,
      contactSource: profile?.contactSource ?? null,
      contactConfidence: profile?.contactConfidence ?? null,
      apolloLastSyncedAt: profile?.apolloLastSyncedAt ?? null,
      lastTouchAt: row.lastTouchAt,
      lastTouchChannel: row.lastTouchChannel,
      ...contact,
    };
  });

  return { rows, counts };
}
