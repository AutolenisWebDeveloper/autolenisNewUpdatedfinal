// /admin/system-health — Integration and system health dashboard
// Shows DB, inventory, OFAC, contract scans, active auctions, recent cron runs

"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Database, ShieldCheck, BarChart2, CreditCard, FileSignature, Mail, Building2, Loader2 } from "lucide-react";

interface IntegrationStatus {
  stripe: boolean;
  docusign: boolean;
  resend: boolean;
  microbilt: boolean;
}

interface HealthReport {
  status: "healthy" | "degraded" | "down";
  database: boolean;
  inventoryHealth: number;
  activeAuctions: number;
  pendingOFAC: number;
  contractFails: number;
  integrations: IntegrationStatus;
  alerts: string[];
  timestamp: string;
}

interface LiveIntegration {
  name: string;
  ok: boolean;
}

function _StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${ok ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"}`}>
      {ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
      {label}
    </div>
  );
}

export default function AdminSystemHealthPage() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveIntegrations, setLiveIntegrations] = useState<LiveIntegration[] | null>(null);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);

  const loadIntegrations = useCallback(async () => {
    setLoadingIntegrations(true);
    setLiveIntegrations(null);
    try {
      const res = await fetch("/api/admin/health/integrations");
      const json = await res.json() as { success?: boolean; data?: { integrations: LiveIntegration[] } };
      if (json.success && json.data?.integrations) setLiveIntegrations(json.data.integrations);
    } catch { /* ignore */ }
    setLoadingIntegrations(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadingIntegrations(true);
    setLiveIntegrations(null);
    try {
      const res = await fetch("/api/admin/health");
      const json = await res.json() as { success?: boolean; data?: { report: HealthReport } };
      if (json.success && json.data?.report) setReport(json.data.report);
    } catch { /* ignore */ }
    setLoading(false);
    void loadIntegrations();
  }, [loadIntegrations]);

  useEffect(() => { load(); }, [load]);

  const getLiveStatus = (name: string): boolean | null => {
    if (!liveIntegrations) return null;
    return liveIntegrations.find(i => i.name === name)?.ok ?? false;
  };

  const SYSTEM_INTEGRATIONS = [
    { name: "Supabase / Database",    icon: Database,       ok: report?.database ?? false,              testid: "health-db" },
    { name: "Inventory Health",       icon: BarChart2,      ok: (report?.inventoryHealth ?? 0) >= 70,   testid: "health-inventory" },
    { name: "OFAC Queue Clear",       icon: ShieldCheck,    ok: (report?.pendingOFAC ?? 1) === 0,       testid: "health-ofac" },
    { name: "Contract Scans Clear",   icon: ShieldCheck,    ok: (report?.contractFails ?? 1) <= 5,      testid: "health-contracts" },
  ];

  const EXTERNAL_INTEGRATIONS = [
    { name: "Stripe (Payment)",       icon: CreditCard,     liveKey: "stripe",    testid: "health-stripe" },
    { name: "DocuSign (E-Sign)",      icon: FileSignature,  liveKey: "docusign",  testid: "health-docusign" },
    { name: "Resend (Email)",         icon: Mail,           liveKey: "resend",    testid: "health-resend" },
    { name: "MicroBilt (PreQual)",    icon: Building2,      liveKey: "microbilt", testid: "health-microbilt" },
  ];

  const overallStatus = report?.status ?? "healthy";

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-system-health-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Activity size={22} className="text-[#0B5FD1]" />
          <h1 className="text-xl font-bold text-slate-900">System Health</h1>
        </div>
        <button
          onClick={load}
          disabled={loading}
          data-testid="health-refresh-btn"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Overall status */}
      <div className={`rounded-xl p-5 mb-6 border-2 flex items-center gap-4 ${
        overallStatus === "healthy" ? "bg-green-50 border-green-200" :
        overallStatus === "degraded" ? "bg-amber-50 border-amber-200" :
        "bg-red-50 border-red-200"
      }`} data-testid="overall-status">
        {overallStatus === "healthy" ? <CheckCircle2 size={28} className="text-green-600" /> :
         overallStatus === "degraded" ? <AlertTriangle size={28} className="text-amber-600" /> :
         <XCircle size={28} className="text-red-600" />}
        <div>
          <p className="font-bold text-slate-900 capitalize">{overallStatus}</p>
          {report?.timestamp && (
            <p className="text-xs text-slate-500">Last checked: {new Date(report.timestamp).toLocaleString()}</p>
          )}
        </div>
      </div>

      {/* Integration statuses */}
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Integration Statuses</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {SYSTEM_INTEGRATIONS.map(integ => (
          <div key={integ.name} data-testid={integ.testid}
            className={`bg-white border rounded-xl p-4 ${integ.ok ? "border-slate-200" : "border-red-200"}`}>
            <div className="flex items-center gap-2 mb-1.5">
              {integ.ok ? <CheckCircle2 size={14} className="text-green-600" /> : <XCircle size={14} className="text-red-500" />}
              <span className={`text-xs font-bold ${integ.ok ? "text-green-700" : "text-red-700"}`}>
                {integ.ok ? "OK" : "Issue"}
              </span>
            </div>
            <p className="text-xs text-slate-600 font-medium">{integ.name}</p>
          </div>
        ))}
        {EXTERNAL_INTEGRATIONS.map(integ => {
          const liveStatus = getLiveStatus(integ.liveKey);
          const isChecking = loadingIntegrations && liveStatus === null;
          const ok = liveStatus ?? false;
          return (
            <div key={integ.name} data-testid={integ.testid}
              className={`bg-white border rounded-xl p-4 ${isChecking ? "border-slate-200" : ok ? "border-slate-200" : "border-red-200"}`}>
              <div className="flex items-center gap-2 mb-1.5">
                {isChecking
                  ? <Loader2 size={14} className="text-slate-400 animate-spin" />
                  : ok
                    ? <CheckCircle2 size={14} className="text-green-600" />
                    : <XCircle size={14} className="text-red-500" />}
                <span className={`text-xs font-bold ${isChecking ? "text-slate-400" : ok ? "text-green-700" : "text-red-700"}`}>
                  {isChecking ? "Checking…" : ok ? "OK" : "Issue"}
                </span>
              </div>
              <p className="text-xs text-slate-600 font-medium">{integ.name}</p>
            </div>
          );
        })}
      </div>

      {/* Metrics */}
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Live Metrics</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Active Auctions", value: report?.activeAuctions ?? "—", testid: "metric-auctions" },
          { label: "Inventory Health", value: report ? `${report.inventoryHealth}%` : "—", testid: "metric-inventory-health" },
          { label: "OFAC Pending", value: report?.pendingOFAC ?? "—", testid: "metric-ofac" },
          { label: "Contract Fails", value: report?.contractFails ?? "—", testid: "metric-contract-fails" },
        ].map(m => (
          <div key={m.label} data-testid={m.testid} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-[#0B5FD1]">{m.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {report?.alerts && report.alerts.length > 0 ? (
        <div className="space-y-2" data-testid="health-alerts">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Active Alerts</h2>
          {report.alerts.map((alert, i) => (
            <div key={i} data-testid={`alert-${i}`}
              className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-900">{alert}</p>
            </div>
          ))}
        </div>
      ) : report && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3" data-testid="no-alerts">
          <CheckCircle2 size={16} className="text-green-600" />
          <p className="text-sm text-green-800 font-medium">No active alerts — all systems nominal</p>
        </div>
      )}
    </div>
  );
}

