// Phase 5.5 — Admin source visibility helpers.
// BuyerOpportunity.source records the entry-point provenance for a buyer lead,
// stored as "<channel>" or "<channel>:<campaign>" (e.g. "lp_campaign:facebook",
// "voice_dispatch:tollfree"). These helpers parse that raw value into a channel
// + campaign pair and provide display metadata for the admin UI.

// Canonical channel keys. Mirrors the IntakeSource union in
// unified-buyer-intake.service.ts plus the synthetic "unknown" bucket used for
// null/legacy records.
export type SourceChannel =
  | "buyer_dashboard"
  | "request_vehicle_wizard"
  | "voice_dispatch"
  | "phone_intake"
  | "zura_widget"
  | "lp_campaign"
  | "public_api"
  | "unknown";

export const SOURCE_CHANNELS: SourceChannel[] = [
  "buyer_dashboard",
  "request_vehicle_wizard",
  "voice_dispatch",
  "phone_intake",
  "zura_widget",
  "lp_campaign",
  "public_api",
  "unknown",
];

export interface ParsedSource {
  raw: string | null;
  channel: SourceChannel;
  campaign: string | null;
  label: string;
}

const CHANNEL_LABELS: Record<SourceChannel, string> = {
  buyer_dashboard: "Buyer Dashboard",
  request_vehicle_wizard: "Vehicle Wizard",
  voice_dispatch: "Voice",
  phone_intake: "Phone Intake",
  zura_widget: "Zura Widget",
  lp_campaign: "Landing Page",
  public_api: "Public API",
  unknown: "Unknown",
};

/**
 * Parses a raw BuyerOpportunity.source string into its channel + campaign parts.
 * Null/empty/unrecognized values collapse to the "unknown" channel so the admin
 * UI always has something to render.
 */
export function parseSource(raw: string | null | undefined): ParsedSource {
  if (!raw || !raw.trim()) {
    return { raw: raw ?? null, channel: "unknown", campaign: null, label: CHANNEL_LABELS.unknown };
  }
  const [channelPart, ...campaignParts] = raw.trim().split(":");
  const campaign = campaignParts.length > 0 ? campaignParts.join(":") : null;
  const channel = (SOURCE_CHANNELS.includes(channelPart as SourceChannel)
    ? channelPart
    : "unknown") as SourceChannel;
  const label =
    channel === "unknown"
      ? CHANNEL_LABELS.unknown
      : campaign
        ? `${CHANNEL_LABELS[channel]} · ${campaign}`
        : CHANNEL_LABELS[channel];
  return { raw, channel, campaign, label };
}

/**
 * Tailwind badge classes per channel. Voice + widget use the AutoLenis brand
 * purple, web flows use blue, landing pages green, API slate, unknown gray.
 */
export function sourceBadgeClasses(channel: SourceChannel): string {
  switch (channel) {
    case "buyer_dashboard":
    case "request_vehicle_wizard":
      return "bg-blue-100 text-blue-700";
    case "voice_dispatch":
    case "phone_intake":
    case "zura_widget":
      return "bg-purple-100 text-[#643293]";
    case "lp_campaign":
      return "bg-green-100 text-green-700";
    case "public_api":
      return "bg-slate-100 text-slate-600";
    case "unknown":
    default:
      return "bg-gray-100 text-gray-500";
  }
}

// High-level groupings used by the admin source filter dropdown.
export type SourceFilterKey = "all" | "web" | "voice" | "lp" | "widget" | "unknown";

export const SOURCE_FILTERS: { key: SourceFilterKey; label: string }[] = [
  { key: "all", label: "All Sources" },
  { key: "web", label: "Web (Dashboard + Wizard)" },
  { key: "voice", label: "Voice" },
  { key: "lp", label: "Landing Page" },
  { key: "widget", label: "Widget" },
  { key: "unknown", label: "Unknown" },
];

/** Maps a filter key to the set of channels it includes. */
export function channelsForFilter(key: SourceFilterKey): SourceChannel[] | null {
  switch (key) {
    case "web":
      return ["buyer_dashboard", "request_vehicle_wizard"];
    case "voice":
      return ["voice_dispatch", "phone_intake"];
    case "lp":
      return ["lp_campaign"];
    case "widget":
      return ["zura_widget"];
    case "unknown":
      return ["unknown"];
    case "all":
    default:
      return null;
  }
}
