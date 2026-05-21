import { CrmShell } from '@/components/admin/crm/CrmShell';

// The CRM shell owns the full viewport (the parent admin layout skips its
// chrome for /admin/crm/* — see app/admin/layout.tsx). Auth is still enforced
// upstream via requireAdmin().
export default function AdminCrmLayout({ children }: { children: React.ReactNode }) {
  return <CrmShell>{children}</CrmShell>;
}
