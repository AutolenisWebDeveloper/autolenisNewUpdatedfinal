// components/ui/kit.ts — the promoted AutoLenis primitive kit (Phase 2, T1).
//
// The token-driven kit originally lived under components/admin/crm/ui and was
// admin-only. Its variable definitions are now global (:root, see globals.css),
// so these primitives render on any dashboard. This barrel is the canonical
// import path platform-wide:
//
//   import { DataTable, KpiCard, EmptyState, Skeleton, PageHeader, Tabs } from "@/components/ui/kit";
//
// Re-export (not move) keeps the ~existing admin/crm imports working unchanged
// while giving buyer/dealer/affiliate a stable shared entry point. The physical
// file relocation is a later, mechanical follow-up; the import surface is what
// matters for adoption.
export * from "@/components/admin/crm/ui";
