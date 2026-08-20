import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerPickupActions, type DealerPickupAction } from "@/lib/services/dealer/dealer-deals.service";
import { resolveDealerAvailability } from "@/lib/services/pickup/availability.service";
import { Badge } from "@/components/ui/badge";
import { Truck, MapPin } from "lucide-react";
import PickupActionsClient from "@/components/dealer/PickupActionsClient";
import PickupConfirmClient, { type AvailabilityHint } from "@/components/dealer/PickupConfirmClient";
import { PageContainer, PageHeader, EmptyState, CARD } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Pickup times are rendered in the DEALER's business timezone (Server Components
// run in UTC on Vercel, so an unqualified toLocaleString would show UTC).
function makeFmt(timeZone: string, label: string) {
  return (d: Date | null): string =>
    d
      ? `${d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })} ${label}`
      : "—";
}

function location(a: DealerPickupAction): string {
  const parts = [a.buyerCity, a.buyerState].filter(Boolean);
  return parts.length ? parts.join(", ") : "Buyer location on file";
}

function CardShell({ a, children }: { a: DealerPickupAction; children: React.ReactNode }) {
  return (
    <div data-testid={`pickup-item-${a.id}`} className={cn(CARD, "p-5")}>
      {children}
    </div>
  );
}

function CardHead({ a, when, label, badge }: { a: DealerPickupAction; when: string; label: string; badge: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <p className="font-mono font-semibold tabular-nums text-al-text">Deal #{a.id.slice(0, 8)}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-al-text-muted">
          <MapPin size={13} aria-hidden="true" /> {location(a)}
        </p>
        <p className="mt-1 text-sm text-al-text">
          <span className="text-al-text-muted">{label}:</span>{" "}
          <span className="font-medium tabular-nums">{when}</span>
        </p>
      </div>
      {badge}
    </div>
  );
}

export default async function DealerPickupsPage() {
  const dealer = await requireDealer();
  const [actions, availability] = await Promise.all([
    getDealerPickupActions(dealer.id),
    resolveDealerAvailability(dealer.id),
  ]);

  const hint: AvailabilityHint = {
    minLeadTimeHours: availability.minLeadTimeHours,
    maxAdvanceDays: availability.maxAdvanceDays,
    openHour: availability.openHour,
    closeHour: availability.closeHour,
    days: availability.days,
    timezoneLabel: availability.timezoneLabel,
  };
  const fmt = makeFmt(availability.timezone, availability.timezoneLabel);

  const needsConfirmation = actions.filter((a) => a.pickup.status === "PROPOSED");
  const waitingOnBuyer = actions.filter((a) => a.pickup.status === "DEALER_COUNTERED");
  const readyToScan = actions.filter((a) => a.pickup.status === "SCHEDULED" || a.pickup.status === "CHECKED_IN");

  return (
    <PageContainer testId="dealer-pickups-page">
      <PageHeader
        title="Pickups"
        subtitle="Confirm pickup times, propose alternatives, and hand off vehicles."
        actions={<Badge variant="secondary">{actions.length}</Badge>}
      />

      {actions.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No pickups yet"
          body="When a buyer proposes a pickup time on a won deal, it will appear here for you to confirm."
          testId="no-pickups"
        />
      ) : (
        <div className="space-y-8">
          {needsConfirmation.length > 0 && (
            <section aria-labelledby="needs-confirmation-h" data-testid="section-needs-confirmation">
              <h2 id="needs-confirmation-h" className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-al-text-muted">
                Needs your confirmation ({needsConfirmation.length})
              </h2>
              <div className="space-y-4">
                {needsConfirmation.map((a) => (
                  <CardShell key={a.id} a={a}>
                    <CardHead a={a} label="Buyer proposed" when={fmt(a.pickup.proposedTime)} badge={<Badge variant="amber">Action needed</Badge>} />
                    {a.pickup.proposedAt && (
                      <PickupConfirmClient dealId={a.id} proposedAt={a.pickup.proposedAt.toISOString()} availability={hint} />
                    )}
                  </CardShell>
                ))}
              </div>
            </section>
          )}

          {waitingOnBuyer.length > 0 && (
            <section aria-labelledby="waiting-buyer-h" data-testid="section-waiting-on-buyer">
              <h2 id="waiting-buyer-h" className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-al-text-muted">
                Waiting on the buyer ({waitingOnBuyer.length})
              </h2>
              <div className="space-y-4">
                {waitingOnBuyer.map((a) => (
                  <CardShell key={a.id} a={a}>
                    <CardHead a={a} label="You proposed" when={fmt(a.pickup.proposedTime)} badge={<Badge variant="gray">Awaiting buyer</Badge>} />
                    <p className="text-sm text-al-text-muted">The buyer will accept your time or suggest another. We&apos;ll notify you.</p>
                  </CardShell>
                ))}
              </div>
            </section>
          )}

          {readyToScan.length > 0 && (
            <section aria-labelledby="ready-scan-h" data-testid="section-ready-to-scan">
              <h2 id="ready-scan-h" className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-al-text-muted">
                Ready for handoff ({readyToScan.length})
              </h2>
              <div className="space-y-4">
                {readyToScan.map((a) => (
                  <CardShell key={a.id} a={a}>
                    <CardHead a={a} label="Scheduled" when={fmt(a.pickup.scheduledAt)} badge={<Badge variant="blue">Confirmed</Badge>} />
                    <PickupActionsClient dealId={a.id} />
                  </CardShell>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </PageContainer>
  );
}
