// /admin/contract-shield/rules — System 8 ENH: Full CRUD for scan rules
// Backed by ContractScanRule DB model via /api/admin/contract-shield/rules.

"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Shield, Plus, Edit2, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

type Severity = "HIGH" | "MEDIUM" | "LOW";

interface ScanRule {
  id: string;
  name: string;
  description?: string | null;
  ruleType: string;
  severity: Severity;
  isActive: boolean;
  config: Record<string, unknown>;
}

interface SeedRule {
  name: string;
  description: string;
  ruleType: string;
  severity: Severity;
  isActive: boolean;
  threshold?: number;
  config: Record<string, unknown>;
}

const BUILT_IN_RULES: SeedRule[] = [
  { name: "Documentation Fee Cap", ruleType: "FEE_CAP", severity: "HIGH", isActive: true, threshold: 25000, config: { maxCents: 25000 }, description: "Documentation fees exceeding $250 are flagged as junk fees." },
  { name: "Nitrogen Tire Fill Detection", ruleType: "JUNK_FEE_KEYWORD", severity: "HIGH", isActive: true, config: { keywords: ["nitrogen", "nitro tire"] }, description: "Nitrogen tire fill charges are non-essential add-ons." },
  { name: "VIN Etching Detection", ruleType: "JUNK_FEE_KEYWORD", severity: "MEDIUM", isActive: true, config: { keywords: ["vin etch", "vin etching"] }, description: "Dealer-installed VIN etching is commonly marked up." },
  { name: "Paint Protection Film", ruleType: "JUNK_FEE_KEYWORD", severity: "MEDIUM", isActive: true, config: { keywords: ["paint protection", "ppf"] }, description: "PPF add-ons are typically unnecessary." },
  { name: "APR Suspicious Rate Flag", ruleType: "APR_VALIDATION", severity: "HIGH", isActive: true, threshold: 2900, config: { maxApr: 29.0 }, description: "APR rates exceeding 29% are flagged as suspicious." },
  { name: "Payment Packing Detection", ruleType: "PAYMENT_PACKING", severity: "HIGH", isActive: true, config: {}, description: "Monthly payment focus that obscures total price." },
  { name: "GAP Insurance Disclosure", ruleType: "DISCLOSURE_CHECK", severity: "MEDIUM", isActive: true, config: { requiredTerms: ["GAP", "guaranteed asset protection"] }, description: "GAP insurance must be clearly disclosed and itemized." },
  { name: "Dealer Reserve Markup", ruleType: "FINANCE_MARKUP", severity: "HIGH", isActive: true, threshold: 200, config: { maxMarkupBps: 200 }, description: "Dealer finance reserve markup exceeding 2% flagged." },
];

const SEVERITY_COLORS: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

function getThreshold(rule: ScanRule): number | undefined {
  const t = (rule.config as { threshold?: unknown })?.threshold;
  return typeof t === "number" ? t : undefined;
}

export default function AdminContractShieldRulesPage() {
  const [rules, setRules] = useState<ScanRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<{ name: string; ruleType: string; severity: Severity; description: string; threshold: string }>({ name: "", ruleType: "JUNK_FEE_KEYWORD", severity: "MEDIUM", description: "", threshold: "" });

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ rules: ScanRule[] }>("/api/admin/contract-shield/rules");
      setRules(data.rules);
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to load rules"));
      return;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRules(); }, [loadRules]);

  async function toggleRule(rule: ScanRule) {
    const updated = rules.map(r => r.id === rule.id ? { ...r, isActive: !r.isActive } : r);
    setRules(updated);
    try {
      await api.patch<unknown>(`/api/admin/contract-shield/rules/${rule.id}`, { isActive: !rule.isActive });
    } catch {
      setError("Failed to update rule");
      await loadRules();
    }
  }

  async function deleteRule(id: string) {
    if (!confirm("Delete this scan rule? This cannot be undone.")) return;
    try {
      await api.del<unknown>(`/api/admin/contract-shield/rules/${id}`);
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to delete rule"));
      return;
    }
    setRules(rules.filter(r => r.id !== id));
  }

  function startEdit(rule: ScanRule) {
    const threshold = getThreshold(rule);
    setNewRule({
      name: rule.name,
      ruleType: rule.ruleType,
      severity: rule.severity,
      description: rule.description ?? "",
      threshold: threshold !== undefined ? String(threshold) : "",
    });
    setEditingId(rule.id);
    setShowAdd(true);
    setError(null);
  }

  function closeForm() {
    setNewRule({ name: "", ruleType: "JUNK_FEE_KEYWORD", severity: "MEDIUM", description: "", threshold: "" });
    setEditingId(null);
    setShowAdd(false);
  }

  async function saveRule() {
    if (!newRule.name || !newRule.ruleType) return;
    const payload: Record<string, unknown> = {
      name: newRule.name,
      severity: newRule.severity,
      description: newRule.description || undefined,
    };
    if (newRule.threshold) {
      const t = parseInt(newRule.threshold, 10);
      if (!Number.isNaN(t)) payload.threshold = t;
    } else if (editingId) {
      payload.threshold = null; // cleared in the edit form → remove from config
    }
    try {
      if (editingId) {
        await api.patch<unknown>(`/api/admin/contract-shield/rules/${editingId}`, payload);
      } else {
        await api.post<unknown>("/api/admin/contract-shield/rules", {
          ...payload,
          ruleType: newRule.ruleType,
          isActive: true,
          config: {},
        });
      }
    } catch (err) {
      setError(apiErrorMessage(err, editingId ? "Failed to update rule" : "Failed to create rule"));
      return;
    }
    closeForm();
    await loadRules();
  }

  async function handleSeedDefaults() {
    setSeeding(true);
    setError(null);
    try {
      const results = await Promise.all(
        BUILT_IN_RULES.map(rule =>
          fetch("/api/admin/contract-shield/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rule),
          }).then(r => r.ok)
        )
      );
      const failed = results.filter(ok => !ok).length;
      if (failed > 0) {
        setError(`${failed} of ${BUILT_IN_RULES.length} default rules failed to load`);
      }
      await loadRules();
    } finally {
      setSeeding(false);
    }
  }

  const activeCount = rules.filter(r => r.isActive).length;

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-contract-rules-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shield size={22} className="text-al-primary" />
          <h1 className="text-xl font-bold text-slate-900">Contract Scan Rules</h1>
          <Badge variant="secondary">{activeCount}/{rules.length} active</Badge>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} data-testid="add-rule-btn" disabled={loading}>
          <Plus size={14} /> Add Rule
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-5 text-sm" data-testid="rules-error">
          {error}
        </div>
      )}

      {/* Add rule form */}
      {showAdd && (
        <div className="bg-white border-2 border-al-primary/20 rounded-xl p-5 mb-5" data-testid="add-rule-form">
          <p className="font-semibold text-slate-800 text-sm mb-4">{editingId ? "Edit Scan Rule" : "New Scan Rule"}</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <Label>Rule name</Label>
              <Input className="mt-1.5" data-testid="rule-name-input" value={newRule.name} onChange={e => setNewRule({...newRule, name: e.target.value})} placeholder="Documentation Fee Cap" />
            </div>
            <div>
              <Label>Rule type</Label>
              <Select className="mt-1.5" data-testid="rule-type-select" value={newRule.ruleType} disabled={!!editingId} onChange={e => setNewRule({...newRule, ruleType: e.target.value})}>
                {["JUNK_FEE_KEYWORD", "FEE_CAP", "APR_VALIDATION", "PAYMENT_PACKING", "DISCLOSURE_CHECK", "FINANCE_MARKUP"].map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Severity</Label>
              <Select className="mt-1.5" data-testid="rule-severity-select" value={newRule.severity}
                onChange={e => {
                  const sev = e.target.value as Severity;
                  setNewRule(p => ({...p, severity: sev}));
                }}>
                {(["HIGH", "MEDIUM", "LOW"] as Severity[]).map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <Label>Threshold (cents, optional)</Label>
              <Input type="number" className="mt-1.5" data-testid="rule-threshold-input" value={newRule.threshold} onChange={e => setNewRule({...newRule, threshold: e.target.value})} placeholder="25000" />
            </div>
          </div>
          <div className="mb-4">
            <Label>Description</Label>
            <Textarea className="mt-1.5" data-testid="rule-description-input" value={newRule.description} onChange={e => setNewRule({...newRule, description: e.target.value})} placeholder="Explain what this rule detects and why it matters." />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveRule} data-testid="save-rule-btn" disabled={!newRule.name}>{editingId ? "Save Changes" : "Save Rule"}</Button>
            <Button size="sm" variant="ghost" onClick={closeForm} data-testid="cancel-rule-btn">Cancel</Button>
          </div>
        </div>
      )}

      {/* Empty state with seed button */}
      {!loading && rules.length === 0 && !showAdd && (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-xl" data-testid="rules-empty-state">
          <Shield size={28} className="mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-600 mb-1">No scan rules configured</p>
          <p className="text-sm text-slate-500 mb-4">Load the 8 built-in rules to get started.</p>
          <button
            onClick={handleSeedDefaults}
            disabled={seeding}
            data-testid="seed-rules-btn"
            className="px-4 py-2 bg-al-primary text-white text-sm rounded-xl font-semibold hover:bg-al-primary-hover disabled:opacity-50">
            {seeding ? "Loading…" : "Load Default Rules"}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <p className="text-sm text-slate-400" data-testid="rules-loading">Loading rules…</p>
      )}

      {/* Rules list */}
      {!loading && rules.length > 0 && (
        <div className="space-y-3">
          {rules.map(rule => {
            const threshold = getThreshold(rule);
            return (
              <div key={rule.id} data-testid={`rule-row-${rule.id}`}
                className={`bg-white border rounded-xl p-5 transition-colors ${rule.isActive ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-900 text-sm">{rule.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${SEVERITY_COLORS[rule.severity]}`}>{rule.severity}</span>
                      <span className="text-xs text-slate-400 font-mono">{rule.ruleType}</span>
                      {threshold !== undefined && <span className="text-xs text-slate-400">· threshold: {(threshold / 100).toFixed(2)}</span>}
                    </div>
                    {rule.description && <p className="text-xs text-slate-500">{rule.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggleRule(rule)} data-testid={`toggle-rule-${rule.id}`}
                      className={`p-1 rounded transition-colors ${rule.isActive ? "text-green-600 hover:text-green-700" : "text-slate-300 hover:text-slate-500"}`}>
                      {rule.isActive ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
                    </button>
                    <button onClick={() => startEdit(rule)} data-testid={`edit-rule-${rule.id}`} className="p-1 text-slate-400 hover:text-slate-600" title="Edit rule" aria-label={`Edit rule ${rule.name}`}>
                      <Edit2 size={15} aria-hidden />
                    </button>
                    <button onClick={() => deleteRule(rule.id)} data-testid={`delete-rule-${rule.id}`} className="p-1 text-slate-400 hover:text-red-500">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-slate-400 mt-6">
        Rule changes take effect on the next Contract Shield scan. Historical scan results are not retroactively updated.
        Active rules contribute to the PASS/WARNING/FAIL score calculation.
      </p>
    </div>
  );
}
