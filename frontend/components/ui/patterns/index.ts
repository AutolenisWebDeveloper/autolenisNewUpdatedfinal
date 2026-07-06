// components/ui/patterns — the PATTERN tier of the AutoLenis kit (Ruling 1).
//
// Tier boundary (explicit by owner ruling):
//   • primitives — low-level building blocks (Button, Badge, DataTable,
//     Skeleton, Tabs, Dialog, …) exported from components/ui/kit.
//   • patterns — page-scaffold compositions built FROM primitives
//     (PageContainer, PageHeader, StatCard, Panel, EmptyState). This folder.
//
// This family was absorbed from the former standalone components/dashboard/*
// (deleted — one canonical import path, no parallel systems). Its private
// tokens (tokens.ts) are pending rebase onto the canonical --al-*/--crm-*
// roles; that commit is HELD until the CI visual baseline is live, because a
// token rebase carries visual-delta risk.
export { default as PageContainer } from "./PageContainer";
export { default as PageHeader, LiveIndicator } from "./PageHeader";
export { default as StatCard } from "./StatCard";
export { default as Panel } from "./Panel";
export { default as EmptyState } from "./EmptyState";
export * from "./tokens";
