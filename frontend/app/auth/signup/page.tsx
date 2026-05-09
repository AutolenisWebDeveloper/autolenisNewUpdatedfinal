// Full-screen split-panel buyer sign-up
// Mirror of dealer and affiliate auth visual standard

import { getAuthPageStats } from "@/lib/services/auth/stats.service";
import SignUpClient from "./SignUpClient";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const stats = await getAuthPageStats();
  return <SignUpClient stats={stats} />;
}
