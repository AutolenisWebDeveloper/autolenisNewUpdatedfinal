import type { Metadata } from "next";
import Link from "next/link";

import { buildPageMetadata } from "@/lib/seo/metadata";
import PillarArticle, { type PillarFaq } from "@/components/buying-guide/PillarArticle";

const SLUG = "car-trade-in-value-guide";
const TITLE = "How to Get the Best Trade-In Value for Your Car";
const DESCRIPTION =
  "How dealers use trade-ins against you, the right timing, and why separating " +
  "the trade from the purchase is the key to the best trade-in value.";

export const metadata: Metadata = buildPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: `/buying-guide/${SLUG}`,
  keywords: [
    "trade-in value",
    "best trade-in value",
    "trade-in vs sell privately",
    "how to maximize trade-in value",
  ],
});

export const revalidate = 86400;

const FAQS: PillarFaq[] = [
  {
    question: "How do I get the most for my trade-in?",
    answer:
      "Negotiate the new car's price first and keep the trade-in completely separate. Get your car appraised by several buyers so you have competing numbers, clean and detail it before appraisal, and gather your service records. The single biggest factor is having more than one offer so no dealer can lowball you.",
  },
  {
    question: "Is it better to trade in or sell privately?",
    answer:
      "Selling privately usually gets you more money because you cut out the dealer's resale margin, but it takes time and effort. Trading in is faster, simpler, and in many states reduces the sales tax you pay on the new car. Weigh the extra private-sale money against the convenience and any tax savings of trading in.",
  },
  {
    question: "Does a trade-in lower my sales tax?",
    answer:
      "In many states, yes — you're taxed on the new car's price minus the trade-in value, not the full price. That tax savings can close part of the gap between a trade-in and a private sale. The rules vary by state, so check how your state treats trade-in tax credits before deciding.",
  },
  {
    question: "Should I tell the dealer I have a trade-in upfront?",
    answer:
      "No. Settle the purchase price of the new car first and get it in writing. Only then bring up the trade. If you reveal the trade early, a dealer can give you a strong price on the car and quietly take it back by undervaluing your trade — or vice versa.",
  },
  {
    question: "Does paying off my loan affect my trade-in?",
    answer:
      "If you owe less than the car is worth, the equity goes toward your new purchase. If you owe more than it's worth (negative equity), that difference gets rolled into your new loan unless you pay it off — which increases what you finance. Know your payoff amount and your car's value before you trade.",
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
            Your trade-in is the part of the deal where the most money quietly changes
            hands — and the part most buyers pay the least attention to. Dealers know this.
            A few hundred or a few thousand dollars of trade-in value is easy to give on the
            new car and quietly take back on the old one, all inside a single &quot;great
            deal.&quot;
          </p>
          <p>
            This guide shows how dealers use trade-ins, how to time and prepare yours, and
            the one rule that protects you more than any other: keep the trade-in separate
            from the purchase. It applies in every US market, though trade-in tax treatment
            varies by state.
          </p>
        </>
      }
      faqs={FAQS}
    >
      <section>
        <h2>How do dealers actually use your trade-in?</h2>
        <p>
          To a dealer, your trade-in and the car you&apos;re buying are two levers on the
          same deal — and they only care about the total. That means they can show you a
          headline discount on the new car while undervaluing your trade by the same amount,
          leaving you exactly where you started but feeling like you won. The reverse happens
          too: a generous trade number paired with a stiff price on the new car.
        </p>
        <p>
          This is why a trade-in should never be discussed as part of the purchase price.
          The moment the two are blended, you lose the ability to tell whether you&apos;re
          getting a fair number on either one. The defense is simple structure, which we
          cover next.
        </p>
      </section>

      <section>
        <h2>Why should you separate the trade-in from the purchase?</h2>
        <p>
          Negotiate the new car&apos;s out-the-door price first, get it in writing, and only
          then bring up the trade-in as a separate transaction. When the two are kept apart,
          each number has to stand on its own. You can evaluate the purchase price against
          competing quotes and the trade-in value against competing appraisals, instead of
          trying to untangle one blended figure designed to be hard to read.
        </p>
        <p>
          The same principle drives good negotiation generally — keep price, trade, and
          financing in separate conversations so a dealer can&apos;t win on one by losing on
          another. For the full approach, see{" "}
          <Link href="/buying-guide/how-to-negotiate-car-price">
            how to negotiate car price with dealers
          </Link>
          .
        </p>
      </section>

      <section>
        <h2>How do you maximize your trade-in value?</h2>
        <p>
          The most powerful move is the same one that drives the rest of car buying:
          competition. Get your car appraised by several buyers — dealers and standalone car
          buyers — so you walk in with more than one real number. A dealer who knows another
          buyer has offered more will rarely lowball you. Beyond that:
        </p>
        <ul>
          <li>
            <strong>Clean and detail the car</strong> before any appraisal. First
            impressions move appraisal numbers more than they should.
          </li>
          <li>
            <strong>Gather service records and a second key.</strong> Documentation and
            completeness reduce a dealer&apos;s perceived risk.
          </li>
          <li>
            <strong>Handle small, cheap fixes</strong> — a burnt-out bulb or a missing floor
            mat — that an appraiser will otherwise use to mark you down.
          </li>
          <li>
            <strong>Know your payoff amount</strong> if you still owe, so you understand your
            equity before you negotiate.
          </li>
        </ul>
      </section>

      <section>
        <h2>Trade in or sell privately — which is better?</h2>
        <p>
          Selling privately almost always nets more money because you keep the margin a
          dealer would otherwise build in for reselling your car. The trade-offs are time,
          effort, and the hassle of dealing with strangers. Trading in is faster and simpler,
          and in many states it lowers the sales tax on your new car because you&apos;re taxed
          on the difference between the new price and the trade value rather than the full
          price.
        </p>
        <p>
          Run the actual comparison: the extra money from a private sale versus the
          convenience plus any trade-in tax savings in your state. For lower-value or
          high-mileage cars, the private-sale premium often isn&apos;t worth the effort; for
          desirable, well-kept cars it frequently is. Either way, knowing your car&apos;s
          real market value first is what keeps you from being lowballed.
        </p>
      </section>

      <section>
        <h2>How to get competing offers without the hassle</h2>
        <p>
          The thread running through every trade-in tactic is the same: more than one offer
          protects you. That&apos;s the entire idea behind how AutoLenis handles the purchase
          side too. You tell us the vehicle you want, our dealer-discovery system finds local
          dealers near your zip code, and up to 8 of them submit their best offers in a
          private 48-hour auction.
        </p>
        <p>
          With a clean, competitive out-the-door price locked in first, you&apos;re in the
          strongest possible position to negotiate your trade as a separate transaction. You
          compare the offers, pick the winner, then handle the trade on its own terms. It
          works in every US market. <Link href="/for-buyers">Start your auction</Link> when
          you&apos;re ready.
        </p>
      </section>
    </PillarArticle>
  );
}
