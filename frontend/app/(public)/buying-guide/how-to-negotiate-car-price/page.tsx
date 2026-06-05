import type { Metadata } from "next";
import Link from "next/link";

import { buildPageMetadata } from "@/lib/seo/metadata";
import PillarArticle, { type PillarFaq } from "@/components/buying-guide/PillarArticle";

const SLUG = "how-to-negotiate-car-price";
const TITLE = "How to Negotiate Car Price With Dealers (2024 Guide)";
const DESCRIPTION =
  "Negotiation tactics that actually work, the best timing to buy, and what " +
  "dealers really respond to. A national guide to negotiating car price.";

export const metadata: Metadata = buildPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: `/buying-guide/${SLUG}`,
  keywords: [
    "how to negotiate car price",
    "car negotiation tactics",
    "negotiating with car dealers",
    "best time to buy a car",
  ],
});

export const revalidate = 86400;

const FAQS: PillarFaq[] = [
  {
    question: "What should I say to negotiate a car price?",
    answer:
      "Keep it simple and factual: state the out-the-door price you're prepared to pay, mention that you're getting competing quotes, and ask the dealer to beat them. Avoid talking about monthly payment or trade-in until the vehicle price is settled. The strongest line isn't a phrase — it's a credible alternative offer the dealer has to beat.",
  },
  {
    question: "What is the best day or time to buy a car?",
    answer:
      "The end of the month, quarter, and year tend to produce the most aggressive offers because dealers are working toward sales targets and manufacturer bonuses. Weekday mornings are quieter than weekends, giving you more attention. That said, timing only helps when dealers know they're competing.",
  },
  {
    question: "Should I negotiate by email or in person?",
    answer:
      "Email or text first. Getting out-the-door quotes in writing from several dealers lets you compare clearly, removes showroom pressure, and creates a paper trail you can use to make dealers beat each other. Walk in only to finalize a number you've already agreed to.",
  },
  {
    question: "How do I negotiate when I have a trade-in?",
    answer:
      "Keep the trade-in completely separate from the purchase price. Negotiate the new vehicle's out-the-door price first, get it in writing, and only then discuss the trade. Blending the two lets a dealer give you a great price on one and quietly take it back on the other.",
  },
  {
    question: "What if the dealer won't budge on price?",
    answer:
      "Be willing to walk away — and mean it. A dealer holding firm usually means another dealer will do better, especially when they know you're shopping. The simplest way to test it is to have multiple dealers quote the same vehicle so a firm 'no' from one is checked against a real offer from another.",
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
            Negotiating a car price feels intimidating because the system is built to make
            you feel that way. You&apos;re one person, doing this once every few years,
            sitting across from professionals who do it all day. But negotiation is far
            more winnable than it looks once you understand what actually moves a
            dealer&apos;s number — and what just wastes everyone&apos;s afternoon.
          </p>
          <p>
            This guide covers the tactics that work, the timing that helps, and the single
            biggest lever most buyers never pull. It applies in every US market; the
            psychology of a dealership is the same in Phoenix as it is in Boston.
          </p>
        </>
      }
      faqs={FAQS}
    >
      <section>
        <h2>What actually makes a dealer lower the price?</h2>
        <p>
          A dealer lowers the price for exactly one reason: they believe they&apos;ll lose
          the sale otherwise. Everything else — your charm, your research, your patience —
          only matters to the extent it makes that belief credible. The most powerful
          thing you can bring to a negotiation is a real, comparable offer from another
          dealer.
        </p>
        <p>
          This is why isolated negotiation is so hard. When you haggle with one
          dealership, they know you walked in the door and might not want to start over
          somewhere else. The leverage is theirs. The moment they understand that three
          other dealers are quoting the same vehicle, the dynamic flips. You don&apos;t
          have to be aggressive — you just have to be credibly willing to buy elsewhere.
        </p>
        <p>
          Concrete numbers beat vague pressure. &quot;Can you do better?&quot; invites a
          token discount. &quot;Another dealer quoted $X out the door on this exact trim —
          can you beat it?&quot; gives them a target and a reason to hit it.
        </p>
      </section>

      <section>
        <h2>When is the best time to negotiate?</h2>
        <p>
          Timing won&apos;t save a weak negotiating position, but it amplifies a strong
          one. Dealers operate on monthly and quarterly sales targets tied to manufacturer
          bonuses, so the final days of a month, quarter, or calendar year are when a
          dealer is most willing to take a thin deal to hit a number. End-of-model-year
          clearances and the arrival of next year&apos;s inventory also create pressure on
          outgoing units.
        </p>
        <p>
          Time of day matters in a smaller way. Weekday mornings are slow, so you get more
          attention and less competition for the salesperson&apos;s time. Weekends are busy
          and rushed. But none of this overrides the core principle: a dealer with a slow
          month who knows you have other offers will move; a dealer who thinks you have
          nowhere else to go won&apos;t, regardless of the date.
        </p>
        <p>
          For a deeper look at what a fair target number looks like before you ever start
          negotiating, read{" "}
          <Link href="/buying-guide/how-to-get-best-car-price">
            how to get the best price on any car
          </Link>
          .
        </p>
      </section>

      <section>
        <h2>How do you negotiate without getting played?</h2>
        <p>
          The dealership&apos;s advantage is complexity. Price, trade-in, financing, fees,
          and add-ons all move at once, and it&apos;s easy to win on one while losing on
          three. The defense is to negotiate each piece separately and in order.
        </p>
        <ul>
          <li>
            <strong>Lock the out-the-door price first.</strong> Get the total — vehicle,
            taxes, title, registration, and all fees — in writing before anything else.
          </li>
          <li>
            <strong>Handle the trade-in separately.</strong> Only after the purchase price
            is set. See our{" "}
            <Link href="/buying-guide/car-trade-in-value-guide">trade-in value guide</Link>.
          </li>
          <li>
            <strong>Talk financing last.</strong> Know your own pre-approved rate so the
            dealer&apos;s financing has to beat a real number, not just sound good.
          </li>
          <li>
            <strong>Decline add-ons by default.</strong> Paint protection, nitrogen tires,
            and VIN etching are almost always pure markup. The{" "}
            <Link href="/buying-guide/dealer-fees-complete-guide">dealer fee guide</Link>{" "}
            explains which charges to reject outright.
          </li>
        </ul>
        <p>
          Keep the conversation on total price, stay willing to walk, and never let a
          discussion of monthly payment substitute for a discussion of total cost. A
          smaller payment over a longer term can quietly cost you thousands more.
        </p>
      </section>

      <section>
        <h2>How to get competing offers without the hassle</h2>
        <p>
          If the single biggest lever is making dealers compete, the obvious move is to set
          up that competition deliberately instead of hoping to bluff it across a desk.
          AutoLenis does this for you. You name the vehicle you want, and our
          dealer-discovery system finds local dealers near your zip code. Up to 8 of them
          submit their best offers in a private 48-hour auction.
        </p>
        <p>
          There&apos;s no back-and-forth, no showroom pressure, and no need to rehearse a
          script. Because every dealer knows they&apos;re bidding against the others, they
          lead with a competitive out-the-door number. You compare the offers and choose
          the winner. The leverage that&apos;s so hard to manufacture in a one-on-one
          negotiation is built into the process from the start.
        </p>
        <p>
          It works in every US market because the system finds dealers near any zip code.
          When you&apos;re ready, <Link href="/for-buyers">start your auction</Link> and let
          the dealers do the negotiating against each other.
        </p>
      </section>
    </PillarArticle>
  );
}
