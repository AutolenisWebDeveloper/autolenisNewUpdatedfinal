// Full-screen split-panel buyer sign-in
// Mirror of dealer and affiliate auth visual standard
// Live platform stats fetched server-side for SSR social proof

import { getAuthPageStats } from "@/lib/services/auth/stats.service";
import SignInClient from "./SignInClient";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const stats = await getAuthPageStats();
  return <SignInClient stats={stats} />;
}
