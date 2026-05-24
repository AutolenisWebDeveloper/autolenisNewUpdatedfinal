import Link from "next/link";
import { Facebook, Instagram, Twitter, Linkedin } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";

const SOCIAL_LINKS = [
  { label: "Facebook",  href: "https://www.facebook.com/autolenis",          icon: Facebook },
  { label: "Instagram", href: "https://www.instagram.com/autolenis",         icon: Instagram },
  { label: "X",         href: "https://twitter.com/autolenis",               icon: Twitter },
  { label: "LinkedIn",  href: "https://www.linkedin.com/company/autolenis",  icon: Linkedin },
];

// CAN-SPAM requires a valid physical postal address in commercial footers.
// Overridable per-environment; the default is AutoLenis's mailing address.
const COMPANY_ADDRESS =
  process.env.NEXT_PUBLIC_COMPANY_ADDRESS ??
  "AutoLenis, Inc., 12800 Westridge Blvd, Suite 114, Frisco, TX 75035";

const FOOTER_LINKS = {
  Buyers: [
    { label: "How It Works",     href: "/how-it-works" },
    { label: "Vehicles",         href: "/inventory" },
    { label: "Pricing",          href: "/pricing" },
    { label: "Request a Car",    href: "/request-a-car" },
    { label: "Request a Vehicle", href: "/request-vehicle" },
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

        {/* Social */}
        <div className="flex items-center gap-3 mb-10">
          {SOCIAL_LINKS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              data-testid={`footer-social-${s.label.toLowerCase()}`}
              className="w-9 h-9 flex items-center justify-center rounded-full border border-white/10 text-slate-400 hover:text-white hover:border-white/30 transition-colors"
            >
              <s.icon size={16} />
            </a>
          ))}
        </div>

        {/* Compliance disclosure */}
        <p className="text-xs text-slate-500 leading-relaxed max-w-3xl mb-4" data-testid="footer-lender-disclosure">
          AutoLenis is not a lender or dealer. AutoLenis is a car-buying concierge
          and marketplace platform that connects buyers with independent, verified
          dealers and third-party financing partners. AutoLenis does not originate
          loans, extend credit, or sell vehicles.
        </p>

        <Separator className="border-white/10 mb-8" />

        {/* Bottom */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            AutoLenis &copy; {new Date().getFullYear()}
          </p>
          <p className="text-xs text-slate-500" data-testid="footer-physical-address">
            {COMPANY_ADDRESS}
          </p>
        </div>
      </div>
    </footer>
  );
}
