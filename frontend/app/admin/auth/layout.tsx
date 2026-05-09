// Admin auth layout — NO requireAdmin check here
// This layout is for unauthenticated admin auth flows only
export default function AdminAuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
