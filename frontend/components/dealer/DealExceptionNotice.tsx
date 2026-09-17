import { AlertTriangle, Clock } from "lucide-react";
import type { ExceptionLineage } from "@/lib/services/operations/exception-lineage.service";

// The dealer half of the ONE lineage — §8.1 row 10: "buyer portal, dealer portal and
// Ops queue render the same checkpoint, owner, deadline and recovery from ONE
// lineage."
//
// Same `exceptionLineage` service, same `checkpoint`, same `deadlineAt`, same owner —
// only the audience differs, and that difference is DISCLOSURE rather than fact. The
// dealer projection is an allowlist inside the service (`DEALER_VISIBLE_CODES`), so a
// code that is about the buyer's money or their prequalification is not merely
// unstyled here: it never reaches this component at all.
//
// WHY THAT ALLOWLIST IS IN THE SERVICE AND NOT IN THIS FILE. §25.1's identity firewall
// is a server-side rule. A component that received every exception and chose which to
// paint would already have the buyer's facts in the page props, where a dealership can
// read them in the RSC payload whatever the markup shows.
//
// This is deliberately a NOTICE and not a panel: a dealership needs to know the deal
// is held and what it owes, in one line, above the stage rail. The buyer's surface is
// the one that carries a recovery link, because the buyer is the one whose journey
// resumes.

interface Props {
  readonly exceptions: readonly ExceptionLineage[];
  /** The read failed. Rendered honestly — silence would read as "nothing is wrong". */
  readonly unavailable?: boolean;
}

export function DealExceptionNotice({ exceptions, unavailable }: Props) {
  if (unavailable) {
    return (
      <div
        className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm"
        data-testid="dealer-exception-unavailable"
      >
        We could not load this deal&apos;s current holds. Refresh in a moment — do not treat this as
        &ldquo;no holds&rdquo;.
      </div>
    );
  }

  if (exceptions.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="Holds on this deal" data-testid="dealer-exception-notice">
      {exceptions.map((ex) => {
        const tone = ex.overdue
          ? { ring: "border-red-200", icon: "bg-red-50 text-red-600", chip: "bg-red-50 text-red-700" }
          : { ring: "border-amber-200", icon: "bg-amber-50 text-amber-600", chip: "bg-amber-50 text-amber-800" };

        return (
          <div key={ex.id} className={`rounded-2xl border ${tone.ring} bg-white p-5 shadow-sm`}>
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 shrink-0 rounded-lg p-2 ${tone.icon}`}>
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                {/* The same checkpoint string the buyer and Operations see. */}
                <h3 className="text-sm font-semibold text-slate-900">{ex.checkpoint}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{ex.recovery}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${tone.chip}`}>
                    With {ex.ownerLabel}
                  </span>
                  {ex.deadlineAt && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {ex.overdue ? "Was due" : "By"}{" "}
                      {new Date(ex.deadlineAt).toLocaleString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short",
                      })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
