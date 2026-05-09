import { requireAdmin } from "@/lib/auth/admin-session";
import SearchToolClient from "./SearchToolClient";

export const dynamic = "force-dynamic";

export default async function AdminInventorySearchToolPage() {
  await requireAdmin();
  return <SearchToolClient />;
}
