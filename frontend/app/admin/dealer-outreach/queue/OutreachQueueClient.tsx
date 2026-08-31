"use client";

// The dealer outreach work queue.
//
// Answers one question: who do I contact right now, and how? Everything on a row
// exists to answer it — dealer, where, who, which channels are open, what
// stopped us last time, and ONE action. Anything else belongs in the detail
// panel, not in a scan.
//
// Composed entirely from components/admin/crm/ui. No local table, drawer, empty
// state or dialog: the kit already carries the tone scale, focus behaviour and
// keyboard semantics, and a second implementation would drift from it.

import * as React from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  SlideOver,
  type Column,
} from "@/components/admin/crm/ui";
import { Phone, Mail, Inbox, PhoneOff, Users } from "lucide-react";
import { ContactabilityBadge, DncBadge } from "./ContactabilityBadges";
import type {
  QueueRow,
  QueueCounts,
} from "@/lib/services/dealer-recruitment/outreach-queue.service";

export type QueueBucket = "work" | "unreachable";

interface Props {
  rows: QueueRow[];
  counts: QueueCounts;
  bucket: QueueBucket;
  loadError: string | null;
  onBucketChange: (bucket: QueueBucket) => void;
}

function relativeDay(d: Date | null): string {
  if (!d) return "Never";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export default function OutreachQueueClient({
  rows,
  counts,
  bucket,
  loadError,
  onBucketChange,
}: Props) {
  const [selected, setSelected] = React.useState<QueueRow | null>(null);

  const columns: Column<QueueRow>[] = [
    {
      id: "name",
      header: "Dealer",
      sortable: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-al-text">{r.name}</div>
          <div className="truncate text-xs text-al-text-subtle">
            {[r.city, r.state].filter(Boolean).join(", ") || "Location unknown"}
          </div>
        </div>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      cell: (r) =>
        r.contactName ? (
          <div className="min-w-0">
            <div className="truncate text-al-text">{r.contactName}</div>
            <div className="truncate text-xs text-al-text-subtle">
              {r.contactTitle || "Title unknown"}
            </div>
          </div>
        ) : (
          // Not "—". 594 prospects carry a name with no recorded source; saying
          // so is more useful than a dash the reader has to interpret.
          <span className="text-xs text-al-text-subtle">No verified contact</span>
        ),
    },
    {
      id: "channels",
      header: "Reachable by",
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <ContactabilityBadge contactability={r.contactability} channels={r.channels} />
          {r.channels.call ? <DncBadge dncStatus={r.dncBlocked ? "found" : "not_found"} /> : null}
        </div>
      ),
    },
    {
      id: "lastTouch",
      header: "Last touch",
      sortable: true,
      sortValue: (r) => (r.lastTouchAt ? new Date(r.lastTouchAt).getTime() : 0),
      cell: (r) => (
        <div className="whitespace-nowrap text-sm text-al-text-muted">
          {relativeDay(r.lastTouchAt)}
          {r.lastTouchChannel ? (
            <span className="ml-1 text-xs text-al-text-subtle">({r.lastTouchChannel})</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "action",
      header: "Next step",
      align: "right",
      cell: (r) => {
        if (r.primaryAction === "SEND_EMAIL") {
          return (
            <Button size="sm" variant="primary" onClick={() => setSelected(r)}>
              <Mail size={14} aria-hidden="true" className="mr-1.5" />
              Draft email
            </Button>
          );
        }
        if (r.primaryAction === "LOG_CALL") {
          return (
            <Button size="sm" variant="secondary" onClick={() => setSelected(r)}>
              <Phone size={14} aria-hidden="true" className="mr-1.5" />
              Log a call
            </Button>
          );
        }
        return <span className="text-xs text-al-text-subtle">Nothing to try</span>;
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Counts are the navigation. Each tile answers "how much work of this
          kind is there", and the unreachable tile is a BUTTON because that
          bucket is the one an operator most needs to open and fix. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Ready to call" value={counts.callReady} icon={Phone} />
        <KpiCard label="Ready to email" value={counts.emailReady} icon={Mail} />
        <KpiCard label="Do-not-call" value={counts.dncBlocked} icon={PhoneOff} />
        <KpiCard
          label="Unreachable"
          value={counts.unreachable}
          icon={Users}
          onClick={() => onBucketChange(bucket === "unreachable" ? "work" : "unreachable")}
          sublabel={bucket === "unreachable" ? "Showing — tap to return" : "Tap to review"}
        />
      </div>

      <DataTable
        data-testid="outreach-queue"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.prospectId}
        onSelect={(r) => setSelected(r)}
        activeRowId={selected?.prospectId ?? null}
        error={
          loadError ? (
            <ErrorState
              title="The queue could not be loaded"
              description={loadError}
              retryLabel="Reload"
              onRetry={() => window.location.reload()}
            />
          ) : undefined
        }
        empty={
          bucket === "unreachable" ? (
            <EmptyState
              icon={Inbox}
              title="Nothing is unreachable"
              description="Every prospect has at least one open channel."
            />
          ) : (
            <EmptyState
              icon={Inbox}
              title="No dealers waiting"
              description={
                counts.unreachable > 0
                  ? `Nothing is ready to work. ${counts.unreachable} prospect(s) have no open channel — review them to find out why.`
                  : "Run an Apollo sync to bring in new prospects."
              }
            />
          )
        }
      />

      <SlideOver
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        subtitle={selected ? [selected.city, selected.state].filter(Boolean).join(", ") : undefined}
        width="lg"
      >
        {selected ? <ProspectDetail row={selected} /> : null}
      </SlideOver>
    </div>
  );
}

/**
 * The detail panel.
 *
 * Leads with provenance, because the operator's first question about a name and
 * number they did not gather themselves is "where did this come from, and when".
 */
function ProspectDetail({ row }: { row: QueueRow }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="contact-heading">
        <h3 id="contact-heading" className="mb-2 font-display text-sm font-semibold text-al-text">
          Contact
        </h3>
        {row.contactName ? (
          <div className="space-y-1.5">
            <div className="text-al-text">{row.contactName}</div>
            <div className="text-sm text-al-text-muted">{row.contactTitle || "Title unknown"}</div>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {row.contactSource ? (
                <Badge tone="neutral" size="sm">
                  Source: {row.contactSource}
                </Badge>
              ) : null}
              {row.contactConfidence ? (
                <Badge tone="neutral" size="sm">
                  Confidence: {row.contactConfidence}
                </Badge>
              ) : null}
              {row.apolloLastSyncedAt ? (
                <Badge tone="neutral" size="sm">
                  Synced {relativeDay(row.apolloLastSyncedAt)}
                </Badge>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-al-text-muted">
            No contact with recorded provenance. Names held against this prospect have no source
            recorded, so they are not shown here.
          </p>
        )}
      </section>

      <section aria-labelledby="channels-heading">
        <h3 id="channels-heading" className="mb-2 font-display text-sm font-semibold text-al-text">
          Channels
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <ContactabilityBadge contactability={row.contactability} channels={row.channels} />
          {row.channels.call ? <DncBadge dncStatus={row.dncBlocked ? "found" : "not_found"} /> : null}
        </div>
        {row.reasons.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm text-al-text-muted">
            {row.reasons.map((reason) => (
              <li key={reason}>{HUMAN_REASON[reason] ?? reason}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="history-heading">
        <h3 id="history-heading" className="mb-2 font-display text-sm font-semibold text-al-text">
          Outreach history
        </h3>
        <p className="text-sm text-al-text-muted">
          {row.lastTouchAt
            ? `Last ${row.lastTouchChannel ?? "touch"} ${relativeDay(row.lastTouchAt)}.`
            : "No outreach has been recorded for this prospect."}
        </p>
      </section>
    </div>
  );
}

/**
 * Machine reasons, said in words.
 *
 * The resolver emits stable keys so the rule stays testable; an operator needs
 * the sentence. Anything unmapped falls through to the raw key rather than being
 * hidden — an unexplained row is better than a silently dropped one.
 */
const HUMAN_REASON: Record<string, string> = {
  no_email: "No email address on file.",
  email_not_send_safe: "The email address has not been verified as deliverable.",
  email_suppressed: "The email address is suppressed (bounced or unsubscribed).",
  no_phone: "No phone number on file.",
  phone_suppressed: "The phone number is suppressed (opted out).",
  sms_no_consent_basis: "SMS needs a consent basis, and none is recorded.",
  sms_dnc_blocked: "SMS is blocked: the number is not cleared against do-not-call.",
  sms_phone_type_blocked: "SMS is blocked: this kind of number is not permitted.",
};
