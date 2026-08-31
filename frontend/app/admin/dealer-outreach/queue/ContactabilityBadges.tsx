// Presentational badges for the outreach queue.
//
// Composed from the CRM kit's Badge rather than styled locally: the kit already
// carries the tone scale, the border treatment and the focus behaviour, and a
// second badge implementation would drift from it.
//
// Every badge pairs its tone with TEXT and an icon. Status is never encoded by
// colour alone — a red pill is invisible to anyone who cannot distinguish it
// from the amber one, and this particular pill is the thing standing between an
// operator and a call they must not place.
import { Badge } from "@/components/admin/crm/ui";
import { Mail, Phone, MessageSquare, PhoneOff, CircleSlash } from "lucide-react";
import type { Contactability, OpenChannels } from "@/lib/services/dealer-recruitment/outreach-queue.service";

const LABEL: Record<Contactability, string> = {
  EMAIL_AND_CALL_READY: "Email + call",
  EMAIL_READY: "Email",
  CALL_READY: "Call",
  UNREACHABLE: "Unreachable",
};

export function ContactabilityBadge({
  contactability,
  channels,
}: {
  contactability: Contactability;
  channels: OpenChannels;
}) {
  if (contactability === "UNREACHABLE") {
    return (
      <Badge tone="neutral" size="sm">
        <CircleSlash size={12} aria-hidden="true" className="mr-1 inline-block align-[-1px]" />
        {LABEL.UNREACHABLE}
      </Badge>
    );
  }
  const Icon = channels.email ? Mail : Phone;
  return (
    <Badge tone={channels.email ? "primary" : "success"} size="sm">
      <Icon size={12} aria-hidden="true" className="mr-1 inline-block align-[-1px]" />
      {LABEL[contactability]}
      {channels.sms ? (
        <MessageSquare size={12} aria-hidden="true" className="ml-1 inline-block align-[-1px]" />
      ) : null}
    </Badge>
  );
}

/**
 * The DNC badge.
 *
 * Rendered whenever the phone channel is open and the number is not cleared, so
 * it appears on the rows an operator is about to dial — which is the only place
 * it is any use. It carries its own text, so it is not a colour the reader has
 * to decode.
 */
export function DncBadge({ dncStatus }: { dncStatus: string | null }) {
  if (dncStatus === "not_found") return null;
  const label = dncStatus === "found" ? "Do not call" : dncStatus === "pending" ? "DNC pending" : "DNC unchecked";
  return (
    <Badge tone="danger" size="sm" title={`dnc_status: ${dncStatus ?? "null"}`}>
      <PhoneOff size={12} aria-hidden="true" className="mr-1 inline-block align-[-1px]" />
      {label}
    </Badge>
  );
}
