import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "External Pre-Approval",
  robots: { index: false, follow: false },
};
export default function ExternalPreApprovalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
