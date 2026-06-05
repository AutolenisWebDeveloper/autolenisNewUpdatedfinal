import type { Metadata } from "next";
import Link from "next/link";

import { buildPageMetadata } from "@/lib/seo/metadata";
import PillarArticle, { type PillarFaq } from "@/components/buying-guide/PillarArticle";

const SLUG = "car-buying-concierge-service";
const TITLE = "What Is a Car Buying Concierge? How It Works";
const DESCRIPTION =
  "What a car buying concierge does, how it differs from a dealer or broker, " +
  "and how AutoLenis makes 8 dealers compete for your business in 48 hours.";

export const metadata: Metadata = buildPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: `/buying-guide/${SLUG}`,
  keywords: [
    "car buying concierge",
    "what is a car buying service",
    "auto broker vs concierge",
    "car buying service explained",
  ],
});

export const revalidate = 86400;

const FAQS: PillarFaq[] = [
  {
    question: "What is a car buying concierge?",
    answer:
      "A car buying concierge is a buyer-side service that handles the work of getting you a good deal — finding the vehicle, sourcing competitive offers, and removing the negotiation — so you don't have to deal with dealerships directly. Unlike a dealer, a concierge works for the buyer, not the seller.",
  },
  {
    question: "How is AutoLenis different from a dealership?",
    answer:
      "A dealership sells you a car and profits from the transaction. AutoLenis is buyer-side: instead of selling you a car, it makes up to 8 local dealers compete in a private 48-hour auction for your business. You compare their offers and pick the best one. The incentives point toward your best price, not the dealer's.",
  },
  {
    question: "How is a concierge different from an auto broker?",
    answer:
      "An auto broker typically negotiates with one or a few dealers on your behalf, often with existing dealer relationships. AutoLenis instead runs an open, private auction where multiple dealers bid against each other simultaneously, so the competition — not a single negotiation — sets the price.",
  },
  {
    question: "Does AutoLenis work everywhere in the US?",
    answer:
      "Yes. The dealer-discovery system finds local dealers near any US zip code automatically, so the platform works in every market — not just major metros. A buyer in a smaller city gets the same competitive process as one in Los Angeles or New York.",
  },
  {
    question: "What does the AutoLenis process look like?",
    answer:
      "You tell AutoLenis the vehicle you want. The system finds local dealers near your zip code and invites up to 8 of them into a private 48-hour auction. Dealers submit their best out-the-door offers. You compare them side by side and choose the winner. No haggling, no showroom visits, no pressure.",
  },
];

export default function Page() {
  return (
    <PillarArticle
      slug={SLUG}
      title={TITLE}
      description={DESCRIPTION}
      intro={
        <>
          <p>
            For decades, buying a car meant doing battle with the people selling it. The
            buyer was always the least-experienced person in the room, negotiating alone
            against professionals. A car buying concierge flips that arrangement: it puts a
            service on the buyer&apos;s side of the table, working to get you the best deal
            instead of selling you one.
          </p>
          <p>
            This guide explains what a car buying concierge actually is, how it differs from
            a dealership and an auto broker, and exactly how the AutoLenis process works. It
            applies nationwide — the model works in every US market because dealers are found
            near any zip code automatically.
          </p>
        </>
      }
      faqs={FAQS}
    >
      <section>
        <h2>What does a car buying concierge actually do?</h2>
        <p>
          A car buying concierge is a buyer-side service that takes the hardest, most
          adversarial parts of buying a car off your plate. Rather than representing a
          dealership and its inventory, a concierge represents you — locating the vehicle you
          want, gathering competitive offers, and handling or eliminating the negotiation so
          you never have to sit across from a sales team and defend yourself.
        </p>
        <p>
          The defining feature is whose interest the service serves. A dealership profits
          when you pay more; a concierge succeeds when you pay less and the process is
          painless. That difference in incentives is the whole point, and it&apos;s what
          separates a genuine buyer-side service from anything that&apos;s ultimately trying
          to sell you a specific car.
        </p>
      </section>

      <section>
        <h2>How is a concierge different from a dealer or broker?</h2>
        <p>
          A <strong>dealership</strong> is the seller. Every incentive points toward a higher
          transaction price, more financed add-ons, and more margin. You can still get a fair
          deal from a dealer, but you&apos;re negotiating against someone whose job is the
          opposite of your goal.
        </p>
        <p>
          An <strong>auto broker</strong> works on your behalf but usually negotiates with one
          or a handful of dealers, often leaning on established relationships. That can help,
          but it concentrates the outcome in a single negotiation rather than open
          competition.
        </p>
        <p>
          A <strong>buyer-side concierge like AutoLenis</strong> runs an open, private
          auction. Instead of one negotiation, multiple dealers bid against each other at the
          same time, and the competition sets the price. You&apos;re not relying on one
          person&apos;s relationships or one negotiation&apos;s outcome — you&apos;re letting
          the market work in your favor. The same logic underpins{" "}
          <Link href="/buying-guide/how-to-get-best-car-price">
            getting the best price on any car
          </Link>
          : competition beats negotiation.
        </p>
      </section>

      <section>
        <h2>How does the AutoLenis process work, step by step?</h2>
        <p>
          AutoLenis turns the concierge idea into a simple, transparent process:
        </p>
        <ol>
          <li>
            <strong>You name the vehicle.</strong> Tell AutoLenis the make, model, and trim
            you want, along with your zip code.
          </li>
          <li>
            <strong>The system finds local dealers.</strong> Dealer-discovery locates dealers
            near your zip code automatically — anywhere in the US.
          </li>
          <li>
            <strong>Up to 8 dealers compete.</strong> They&apos;re invited into a private
            48-hour auction and submit their best out-the-door offers.
          </li>
          <li>
            <strong>You compare and choose.</strong> Every offer is laid out side by side,
            fees included, so you can pick the genuine best deal — not the best pitch.
          </li>
        </ol>
        <p>
          There&apos;s no haggling, no showroom pressure, and no sales calls. Because dealers
          know they&apos;re bidding against each other, they lead with competitive numbers and
          clean fees — and a padded offer stands out immediately. For what those fees should
          look like, see the{" "}
          <Link href="/buying-guide/dealer-fees-complete-guide">dealer fee guide</Link>.
        </p>
      </section>

      <section>
        <h2>How to get competing offers without the hassle</h2>
        <p>
          A car buying concierge only matters if it actually delivers competition, and that
          is exactly what AutoLenis is built to do. You tell us what you want, our system
          finds local dealers near your zip code, and up to 8 of them compete for your
          business in a private 48-hour auction. You stay in control the entire time — you
          compare every offer and pick the winner.
        </p>
        <p>
          It works in every US market, for every kind of buyer, because the competition is
          built into the process rather than left to your negotiating skill on a given
          afternoon. When you&apos;re ready,{" "}
          <Link href="/for-buyers">start your auction</Link> and let the dealers come to you.
        </p>
      </section>
    </PillarArticle>
  );
}
