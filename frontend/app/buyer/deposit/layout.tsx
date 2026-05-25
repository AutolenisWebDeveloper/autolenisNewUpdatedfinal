import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Auction Access Fee",
  robots: { index: false, follow: false },
};
export default function DepositLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
