import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Trade-In",
  robots: { index: false, follow: false },
};
export default function TradeInLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
