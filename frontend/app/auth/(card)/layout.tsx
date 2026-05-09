// Centered-card layout for auxiliary auth pages:
// verify-email, forgot-password, reset-password, accept-terms

import Link from "next/link";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";

export default function AuthCardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8F9FB] via-white to-[#EDF6FD] flex flex-col" data-testid="auth-card-layout">
      <header className="px-6 py-5 border-b border-[#E5E7EB] bg-white/80 backdrop-blur">
        <AutoLenisLogo size="sm" variant="dark" href="/" testId="auth-home-logo" />
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm">
          {children}
        </div>
      </main>
      <footer className="px-6 py-4 text-center text-xs text-[#94A3B8]">
        <Link href="/legal/privacy" className="hover:text-[#0B5FD1] transition-colors">Privacy</Link>
        <span className="mx-2">·</span>
        <Link href="/legal/terms" className="hover:text-[#0B5FD1] transition-colors">Terms</Link>
      </footer>
    </div>
  );
}
