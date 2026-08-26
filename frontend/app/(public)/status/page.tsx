// Feature 32 — Platform Status Page
// Reads the public /api/public/health endpoint, which exposes only sanitized
// fields (no admin-sensitive metrics like OFAC alerts or contract failures).
// No fake uptime percentages or SLA claims; only current known state is displayed.

import type { Metadata } from "next";
import { CheckCircle2, AlertTriangle, XCircle, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Platform Status",
  description: "Current operational status of AutoLenis platform services.",
  robots: { index: false, follow: false },
};

interface HealthData {
  status: "healthy" | "degraded" | "down";
  database: boolean;
  inventoryHealth: number;
  activeAuctions: number;
  alerts: string[];
  timestamp: string;
}

async function fetchHealth(): Promise<HealthData | null> {
  try {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").trim();
    const res = await fetch(`${base}/api/public/health`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: HealthData };
    return json.data ?? null;
  } catch {
    return null;
  }
}

const COMPONENTS = [
  { key: "database", label: "Database" },
  { key: "inventory", label: "Inventory Sync" },
  { key: "payments", label: "Payments (Stripe)" },
  { key: "esign", label: "E-Sign" },
  { key: "email", label: "Email (Resend)" },
  { key: "prequal", label: "Pre-Qualification" },
] as const;

export default async function StatusPage() {
  const health = await fetchHealth();

  const overallStatus = health?.status ?? "unknown";

  const componentStatus = health
    ? {
        database: health.database,
        inventory: health.inventoryHealth >= 70,
        // These services are not independently health-checked in the current backend.
        // Showing null (Status unavailable) is more honest than hardcoding operational.
        payments: null as boolean | null,
        esign: null as boolean | null,
        email: null as boolean | null,
        prequal: null as boolean | null,
      }
    : null;

  const STATUS_META = {
    healthy: {
      icon: CheckCircle2,
      label: "All Systems Operational",
      className: "bg-green-50 border-green-200 text-green-800",
      iconClass: "text-green-600",
    },
    degraded: {
      icon: AlertTriangle,
      label: "Partial Outage",
      className: "bg-amber-50 border-amber-200 text-amber-800",
      iconClass: "text-amber-600",
    },
    down: {
      icon: XCircle,
      label: "Major Outage",
      className: "bg-red-50 border-red-200 text-red-800",
      iconClass: "text-red-600",
    },
    unknown: {
      icon: AlertTriangle,
      label: "Status Unknown",
      className: "bg-slate-50 border-slate-200 text-slate-700",
      iconClass: "text-slate-500",
    },
  } as const;

  const meta = STATUS_META[overallStatus as keyof typeof STATUS_META] ?? STATUS_META.unknown;
  const StatusIcon = meta.icon;

  return (
    <div className="min-h-screen bg-[#F8F9FA] py-16 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">AutoLenis Status</h1>
          <p className="text-slate-500 text-sm">Current platform status · Feature 32</p>
        </div>

        {/* Overall status banner */}
        <div
          className={`rounded-2xl border-2 p-6 mb-8 flex items-center gap-4 ${meta.className}`}
          data-testid="status-banner"
        >
          <StatusIcon size={32} className={meta.iconClass} />
          <div>
            <p className="text-xl font-bold">{meta.label}</p>
            {health?.timestamp ? (
              <p className="text-sm opacity-70 mt-0.5">
                Last checked: {new Date(health.timestamp).toLocaleString()}
              </p>
            ) : (
              <p className="text-sm opacity-70 mt-0.5">
                Unable to retrieve live status. Please contact support if issues persist.
              </p>
            )}
          </div>
        </div>

        {/* Component statuses */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-8" data-testid="component-statuses">
          <div className="px-6 py-4 border-b border-slate-100">
            <p className="font-semibold text-slate-800 text-sm">System Components</p>
          </div>
          <div className="divide-y divide-slate-100">
            {COMPONENTS.map(comp => {
              const isOk = componentStatus ? componentStatus[comp.key] : null;
              return (
                <div
                  key={comp.key}
                  data-testid={`status-component-${comp.key}`}
                  className="flex items-center justify-between px-6 py-3.5"
                >
                  <p className="text-sm text-slate-700">{comp.label}</p>
                  {isOk === null ? (
                    <span className="text-xs text-slate-400" data-testid={`comp-unknown-${comp.key}`}>
                      Status unavailable
                    </span>
                  ) : isOk ? (
                    <div className="flex items-center gap-1.5" data-testid={`comp-ok-${comp.key}`}>
                      <CheckCircle2 size={14} className="text-green-500" />
                      <span className="text-xs font-semibold text-green-700">Operational</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5" data-testid={`comp-issue-${comp.key}`}>
                      <AlertTriangle size={14} className="text-amber-500" />
                      <span className="text-xs font-semibold text-amber-700">Issue Detected</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Active alerts */}
        {health?.alerts && health.alerts.length > 0 && (
          <div className="space-y-2 mb-8" data-testid="status-alerts">
            <p className="font-semibold text-slate-800 text-sm mb-3">Active Alerts</p>
            {health.alerts.map((alert, i) => (
              <div
                key={i}
                data-testid={`status-alert-${i}`}
                className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4"
              >
                <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900">{alert}</p>
              </div>
            ))}
          </div>
        )}

        {/* Support link */}
        <div className="text-center" data-testid="status-support">
          <p className="text-slate-500 text-sm mb-3">
            Experiencing an issue not reflected here?
          </p>
          <a
            href="mailto:support@autolenis.com"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#0B5FD1] hover:underline"
            data-testid="status-support-link"
          >
            Contact Support <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}
