import { CrmShell } from '@/components/admin/crm/CrmShell';

// Operations dashboard sits inside the CRM shell so admin navigation remains
// consistent between CRM and operational visibility surfaces.
export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  return <CrmShell>{children}</CrmShell>;
}
