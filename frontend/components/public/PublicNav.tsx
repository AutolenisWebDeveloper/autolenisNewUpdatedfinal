"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X, ChevronDown, User, Car, DollarSign } from "lucide-react";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";

const NAV_LINKS = [
  { label: "How It Works", href: "/how-it-works" },
  { label: "About Us",     href: "/about" },
  { label: "Buyers",       href: "/for-buyers" },
  { label: "Dealers",      href: "/for-dealers" },
  { label: "Affiliates",   href: "/for-affiliates" },
  { label: "Pricing",      href: "/pricing" },
  { label: "Contact",      href: "/contact" },
];

export default function PublicNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/95 backdrop-blur-xl border-b border-[#E5E7EB] shadow-sm"
          : "bg-white/90 backdrop-blur-sm border-b border-transparent"
      }`}
      data-testid="public-nav"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <div className="flex h-16 items-center justify-between gap-8">
          {/* Logo */}
          <AutoLenisLogo size="sm" variant="dark" href="/" testId="nav-logo" className="shrink-0" />

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-0.5 flex-1 justify-center" data-testid="desktop-nav">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                data-testid={`nav-link-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
                className="px-3.5 py-2 text-sm font-medium text-[#4B5563] hover:text-[#0B5FD1] hover:bg-[#F0F4FF] rounded-md transition-all duration-200"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden lg:flex items-center gap-3 shrink-0">
            {/* Sign In dropdown */}
            <div className="relative" onMouseLeave={() => setSignInOpen(false)}>
              <button
                onClick={() => setSignInOpen(o => !o)}
                data-testid="nav-signin-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-[#4B5563] hover:text-[#0B5FD1] transition-colors"
              >
                Sign In
                <ChevronDown size={14} className={`transition-transform ${signInOpen ? "rotate-180" : ""}`} />
              </button>
              {signInOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-[#E5E7EB] rounded-xl shadow-lg overflow-hidden z-50">
                  <Link
                    href="/auth/signin"
                    onClick={() => setSignInOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-3 text-sm text-[#374151] hover:bg-[#F8F9FB] hover:text-[#0B5FD1] transition-colors"
                    data-testid="nav-signin-buyer"
                  >
                    <User size={14} /> Buyer Sign In
                  </Link>
                  <Link
                    href="/dealer/sign-in"
                    onClick={() => setSignInOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-3 text-sm text-[#374151] hover:bg-[#F8F9FB] hover:text-[#0B5FD1] transition-colors border-t border-[#F3F4F6]"
                    data-testid="nav-signin-dealer"
                  >
                    <Car size={14} /> Dealer Sign In
                  </Link>
                  <Link
                    href="/affiliate/signin"
                    onClick={() => setSignInOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-3 text-sm text-[#374151] hover:bg-[#F8F9FB] hover:text-[#0B5FD1] transition-colors border-t border-[#F3F4F6]"
                    data-testid="nav-signin-affiliate"
                  >
                    <DollarSign size={14} /> Affiliate Sign In
                  </Link>
                </div>
              )}
            </div>
            <Link
              href="/auth/signup"
              data-testid="nav-get-started-btn"
              className="px-5 py-2 text-sm font-semibold bg-[#0B5FD1] text-white rounded-md hover:bg-[#1A6FE0] transition-colors shadow-sm"
            >
              Get Prequalified
            </Link>
          </div>

          {/* Mobile toggle */}
          <button
            className="lg:hidden p-2 rounded-md text-[#4B5563] hover:text-[#0B5FD1] hover:bg-[#F0F4FF] transition-colors"
            onClick={() => setOpen(!open)}
            aria-label="Toggle navigation"
            data-testid="mobile-nav-toggle"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="lg:hidden border-t border-[#E5E7EB] bg-white px-6 pb-5" data-testid="mobile-nav-menu">
          <nav className="flex flex-col gap-0.5 pt-2">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="px-3 py-2.5 text-sm font-medium text-[#4B5563] hover:text-[#0B5FD1] hover:bg-[#F0F4FF] rounded-md transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex flex-col gap-2 pt-4 border-t border-[#E5E7EB] mt-3">
            <Link href="/auth/signin" data-testid="mobile-signin-btn" onClick={() => setOpen(false)} className="w-full px-4 py-2.5 text-center text-sm font-medium text-[#0B5FD1] border border-[#0B5FD1] rounded-md hover:bg-[#F0F4FF] transition-colors">Buyer Sign In</Link>
            <Link href="/dealer/sign-in" data-testid="mobile-signin-dealer-btn" onClick={() => setOpen(false)} className="w-full px-4 py-2.5 text-center text-sm font-medium text-[#0B5FD1] border border-[#0B5FD1] rounded-md hover:bg-[#F0F4FF] transition-colors">Dealer Sign In</Link>
            <Link href="/affiliate/signin" data-testid="mobile-signin-affiliate-btn" onClick={() => setOpen(false)} className="w-full px-4 py-2.5 text-center text-sm font-medium text-[#0B5FD1] border border-[#0B5FD1] rounded-md hover:bg-[#F0F4FF] transition-colors">Affiliate Sign In</Link>
            <Link href="/auth/signup" data-testid="mobile-get-started-btn" onClick={() => setOpen(false)} className="w-full px-4 py-2.5 text-center text-sm font-semibold bg-[#0B5FD1] text-white rounded-md hover:bg-[#1A6FE0] transition-colors">Get Prequalified</Link>
          </div>
        </div>
      )}
    </header>
  );
}
