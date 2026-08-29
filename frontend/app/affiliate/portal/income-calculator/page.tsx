import { requireAffiliateWithOnboarding } from "@/lib/auth/affiliate-session";
import IncomeCalculatorClient from "./IncomeCalculatorClient";

export const dynamic = "force-dynamic";

export default async function AffiliateIncomeCalculatorPage() {
  // P1-2 — gate runs in the PAGE, not only the layout: App Router does not
  // re-render the layout on soft navigation, so a sidebar click would bypass
  // a layout-only gate. The calculator itself stays a client component.
  await requireAffiliateWithOnboarding();
  return <IncomeCalculatorClient />;
}
