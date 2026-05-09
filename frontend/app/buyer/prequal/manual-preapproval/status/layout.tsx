import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Pre-Approval Status",
  robots: { index: false, follow: false },
};
export default function ManualPreApprovalStatusLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
