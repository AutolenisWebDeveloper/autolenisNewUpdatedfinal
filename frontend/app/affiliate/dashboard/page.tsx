// Redirect legacy /affiliate/* → /affiliate/portal/* canonical routes
import { redirect } from "next/navigation";

// /affiliate/dashboard → /affiliate/portal/dashboard
export default function AffiliateDashboardRedirect() {
  redirect("/affiliate/portal/dashboard");
}
