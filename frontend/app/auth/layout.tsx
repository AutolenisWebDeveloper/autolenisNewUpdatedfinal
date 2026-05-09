// Root auth layout — pass-through for full-screen auth pages (signin/signup)
// Centered card pages live under /auth/(card)/*

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign In — AutoLenis" };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
