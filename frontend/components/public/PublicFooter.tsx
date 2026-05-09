import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";

const FOOTER_LINKS = {
  Buyers: [
    { label: "How It Works",     href: "/how-it-works" },
    { label: "Vehicles",         href: "/inventory" },
    { label: "Pricing",          href: "/pricing" },
    { label: "Request a Car",    href: "/request-a-car" },
    { label: "Compare",          href: "/compare" },
    { label: "Contract Shield",  href: "/contract-shield" },
    { label: "Insurance",        href: "/insurance" },
    { label: "FAQ",              href: "/faq" },
  ],
  Dealers: [
    { label: "Partner With Us",    href: "/for-dealers" },
    { label: "Dealer Application", href: "/dealer-application" },
  ],
  Company: [
    { label: "About AutoLenis",   href: "/about" },
    { label: "Affiliate Network", href: "/for-affiliates" },
    { label: "Testimonials",      href: "/testimonials" },
    { label: "Refinance",         href: "/refinance" },
    { label: "Contact Us",        href: "/contact" },
  ],
  Legal: [
    { label: "Privacy Policy",   href: "/legal/privacy" },
    { label: "Terms of Service", href: "/legal/terms" },
    { label: "Security",         href: "/trust" },
    { label: "Cookie Policy",    href: "/legal/cookie-policy" },
  ],
};

export default function PublicFooter() {
  return (
    <footer className="bg-[#111111] text-white" data-testid="public-footer">
      <div className="mx-auto max-w-7xl px-6 md:px-12 py-20 md:py-24">
        {/* Brand */}
        <div className="mb-16">
          <AutoLenisLogo size="sm" variant="light" href="/" testId="footer-logo" className="mb-4" />
          <p className="text-slate-400 text-sm max-w-xs leading-relaxed mt-3">
            Buy Smarter. Pay Less. No Games. — The buyer-first platform that gives you leverage, dealer competition, and financial clarity.
          </p>
        </div>

        {/* Links grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-16">
          {Object.entries(FOOTER_LINKS).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-xs tracking-widest uppercase font-semibold text-slate-500 mb-4">{category}</h3>
              <ul className="space-y-2.5">
                {links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      data-testid={`footer-link-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
                      className="text-sm text-slate-400 hover:text-white transition-colors"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Separator className="border-white/10 mb-8" />

        {/* Bottom */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <p className="text-xs text-slate-500">
            AutoLenis &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </footer>
  );
}
