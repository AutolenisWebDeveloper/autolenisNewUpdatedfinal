"use client";

// Client-side filter / search / sort layer for the dealer recruitment pipeline.
// Operates over the prospect set loaded by the server page so the founder can
// slice the list instantly without a round-trip. Reuses the existing per-row
// cells (EmailCell, OutreachActions, SequenceCell) unchanged.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X, Users } from "lucide-react";
import EmailCell from "./EmailCell";
import OutreachActions from "./OutreachActions";
import SequenceCell, { type SequenceStep } from "./SequenceCell";

export interface ProspectRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  brand: string | null;
  phone: string | null;
  email: string | null;
  emailSource: string | null;
  emailEnrichedAt: string | null;
  website: string | null;
  contactName: string | null;
  contactTitle: string | null;
  status: string;
  contactedAt: string | null;
  createdAt: string;
  replyDetectedAt: string | null;
  sequencePausedAt: string | null;
  sequencePauseReason: string | null;
  lastOutreachStatus: string | null;
  sequenceSteps: SequenceStep[];
  buyerOpp: {
    make: string | null;
    model: string | null;
    bodyStyle: string | null;
    budgetAmount: number | null;
    monthlyPayment: number | null;
    timeline: string | null;
  } | null;
}

const STATUS_BADGE: Record<string, string> = {
  DISCOVERED: "bg-slate-100 text-slate-600",
  SCRIPTED: "bg-blue-100 text-blue-700",
  DRAFTED: "bg-indigo-100 text-indigo-700",
  CONTACTED: "bg-amber-100 text-amber-700",
  REPLIED: "bg-purple-100 text-purple-700",
  ONBOARDED: "bg-green-100 text-green-700",
  DEAD: "bg-red-100 text-red-700",
};

const STATUS_OPTIONS = [
  "DISCOVERED",
  "SCRIPTED",
  "CONTACTED",
  "REPLIED",
  "ONBOARDED",
  "DEAD",
];

const KNOWN_BRANDS = [
  "Toyota",
  "Honda",
  "Ford",
  "Chevrolet",
  "Lexus",
  "Kia",
  "Hyundai",
  "Jeep",
  "Ram",
  "GMC",
  "Mercedes",
  "BMW",
  "Nissan",
  "Subaru",
  "Mazda",
  "Multi-Brand",
];

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];

type SortKey =
  | "newest"
  | "oldest"
  | "name_asc"
  | "name_desc"
  | "last_contacted"
  | "state_asc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name_asc", label: "Name A-Z" },
  { value: "name_desc", label: "Name Z-A" },
  { value: "last_contacted", label: "Last Contacted" },
  { value: "state_asc", label: "State A-Z" },
];

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function domainOnly(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "");
}

const SELECT_CLS =
  "rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172A] focus:border-al-primary focus:outline-none";

export default function DealerPipelineClient({
  prospects,
}: {
  prospects: ProspectRow[];
}) {
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState("");
  const [contact, setContact] = useState(""); // "" | "has" | "none"
  const [sort, setSort] = useState<SortKey>("newest");

  const brandOptions = useMemo(() => {
    const present = new Set(
      prospects.map((p) => p.brand).filter((b): b is string => !!b),
    );
    KNOWN_BRANDS.forEach((b) => present.add(b));
    return Array.from(present).sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  const hasActiveFilter =
    q !== "" ||
    state !== "" ||
    brand !== "" ||
    status !== "" ||
    contact !== "" ||
    sort !== "newest";

  function clearFilters() {
    setQ("");
    setState("");
    setBrand("");
    setStatus("");
    setContact("");
    setSort("newest");
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = prospects.filter((p) => {
      if (needle) {
        const haystack = [p.name, p.city, p.email, p.contactName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (state && p.state !== state) return false;
      if (brand && p.brand !== brand) return false;
      if (status && p.status !== status) return false;
      if (contact === "has" && !p.email) return false;
      if (contact === "none" && p.email) return false;
      return true;
    });

    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.createdAt.localeCompare(b.createdAt);
        case "name_asc":
          return a.name.localeCompare(b.name);
        case "name_desc":
          return b.name.localeCompare(a.name);
        case "last_contacted":
          return (b.contactedAt ?? "").localeCompare(a.contactedAt ?? "");
        case "state_asc":
          return (a.state ?? "~").localeCompare(b.state ?? "~");
        case "newest":
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
    return sorted;
  }, [prospects, q, state, brand, status, contact, sort]);

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-sm">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search dealer name, city, email..."
            data-testid="dealer-search-input"
            className="w-full rounded-xl border border-[#E2E8F0] bg-white py-2 pl-9 pr-3 text-sm text-[#0F172A] focus:border-al-primary focus:outline-none"
          />
        </div>

        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          className={SELECT_CLS}
          data-testid="dealer-filter-state"
          aria-label="Filter by state"
        >
          <option value="">All States</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className={SELECT_CLS}
          data-testid="dealer-filter-brand"
          aria-label="Filter by brand"
        >
          <option value="">All Brands</option>
          {brandOptions.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={SELECT_CLS}
          data-testid="dealer-filter-status"
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>

        <select
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          className={SELECT_CLS}
          data-testid="dealer-filter-contact"
          aria-label="Filter by email presence"
        >
          <option value="">All Contacts</option>
          <option value="has">Has Email</option>
          <option value="none">No Email</option>
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className={SELECT_CLS}
          data-testid="dealer-filter-sort"
          aria-label="Sort prospects"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {hasActiveFilter && (
          <button
            onClick={clearFilters}
            data-testid="dealer-clear-filters"
            className="inline-flex items-center gap-1 px-2 py-2 text-sm font-medium text-al-primary hover:underline"
          >
            <X size={14} /> Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#E2E8F0] bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-[#F8FAFC] text-left text-xs uppercase text-[#64748B]">
            <tr>
              <th className="px-3 py-3 font-medium w-44">Dealer</th>
              <th className="px-3 py-3 font-medium w-24 hidden lg:table-cell">Brand</th>
              <th className="px-3 py-3 font-medium w-36 hidden xl:table-cell">Contact</th>
              <th className="px-3 py-3 font-medium w-44">Email</th>
              <th className="px-3 py-3 font-medium w-32 hidden lg:table-cell">Website</th>
              <th className="px-3 py-3 font-medium w-24">Status</th>
              <th className="px-3 py-3 font-medium w-44">Outreach</th>
              <th className="px-3 py-3 font-medium w-20 hidden xl:table-cell">Sequence</th>
              <th className="px-3 py-3 font-medium w-28 hidden lg:table-cell">Last Contact</th>
              <th className="px-3 py-3 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-[#94A3B8]">
                  No prospects match the current filters.
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-[#F8FAFC]">
                <td className="px-3 py-3 max-w-[176px]">
                  <div className="font-semibold text-[#0F172A] truncate" title={p.name}>
                    {p.name}
                  </div>
                  <div className="text-xs text-[#94A3B8] truncate">
                    {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                  </div>
                </td>
                <td className="px-3 py-3 hidden lg:table-cell">
                  {p.brand ? (
                    <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {p.brand}
                    </span>
                  ) : (
                    <span className="text-[#94A3B8]">—</span>
                  )}
                </td>
                <td className="px-3 py-3 hidden xl:table-cell max-w-[144px]">
                  {p.contactName ? (
                    <div className="truncate">
                      <div className="text-[#0F172A] truncate">{p.contactName}</div>
                      {p.contactTitle && (
                        <div className="text-xs text-[#94A3B8] truncate">
                          {p.contactTitle}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-[#94A3B8]">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <EmailCell
                    prospectId={p.id}
                    email={p.email}
                    emailSource={p.emailSource}
                    emailEnrichedAt={p.emailEnrichedAt}
                  />
                </td>
                <td className="px-3 py-3 hidden lg:table-cell max-w-[128px]">
                  {p.website ? (
                    <a
                      href={p.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-al-primary hover:underline truncate inline-block max-w-full"
                      title={p.website}
                    >
                      {domainOnly(p.website)}
                    </a>
                  ) : (
                    <span className="text-[#94A3B8]">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                      STATUS_BADGE[p.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <OutreachActions
                    prospectId={p.id}
                    hasEmail={!!p.email}
                    lastStatus={p.lastOutreachStatus}
                  />
                </td>
                <td className="px-3 py-3 hidden xl:table-cell">
                  <SequenceCell
                    prospectId={p.id}
                    steps={p.sequenceSteps}
                    replyDetectedAt={p.replyDetectedAt}
                    sequencePausedAt={p.sequencePausedAt}
                    sequencePauseReason={p.sequencePauseReason}
                  />
                </td>
                <td className="px-3 py-3 text-xs text-[#64748B] hidden lg:table-cell whitespace-nowrap">
                  {relativeTime(p.contactedAt)}
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/admin/dealer-outreach/${p.id}`}
                    className="rounded-xl bg-al-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0a52b5]"
                    data-testid={`dealer-view-${p.id}`}
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-[#94A3B8]">
        <Users size={14} />
        Showing {filtered.length} of {prospects.length} loaded prospect
        {prospects.length === 1 ? "" : "s"} (most recent 250).
      </div>
    </div>
  );
}
