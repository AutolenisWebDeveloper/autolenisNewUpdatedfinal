import type { Metadata } from "next";
import Link from "next/link";

import { buildPageMetadata } from "@/lib/seo/metadata";
import PillarArticle, { type PillarFaq } from "@/components/buying-guide/PillarArticle";

const SLUG = "how-to-get-best-car-price";
const TITLE = "How to Get the Best Price on Any Car — The Complete Guide";
const DESCRIPTION =
  "MSRP vs invoice, dealer markup, and how to know what to actually pay. A " +
  "national, no-nonsense guide to getting the best price on any car.";

export const metadata: Metadata = buildPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: `/buying-guide/${SLUG}`,
  keywords: [
    "best price on a car",
    "what price to pay for a car",
    "MSRP vs invoice",
    "dealer markup",
    "car buying guide",
  ],
});

export const revalidate = 86400;

const FAQS: PillarFaq[] = [
  {
    question: "What is the lowest price a dealer will accept on a car?",
    answer:
      "There is no single number. The floor depends on the dealer's invoice cost, any manufacturer holdback or incentives, how close it is to month-end, and how much the dealer values moving that specific unit. The most reliable way to find the true floor is to make several dealers compete for the same sale at the same time so each one reveals how low they're willing to go.",
  },
  {
    question: "Is MSRP the price I should pay?",
    answer:
      "Rarely. MSRP is the manufacturer's suggested retail price — a starting point, not a fair price. On most non-scarce vehicles, the transaction price lands below MSRP. On high-demand models a dealer may try to add a markup above MSRP, which is negotiable and often removable.",
  },
  {
    question: "How much below MSRP can you negotiate?",
    answer:
      "It varies by vehicle, region, and demand. The gap between MSRP and invoice gives you a rough sense of the dealer's room, but incentives and holdback can create additional room below invoice. Competition between dealers surfaces the real number faster than any rule of thumb.",
  },
  {
    question: "Should I focus on monthly payment or total price?",
    answer:
      "Always negotiate the total out-the-door price first. Monthly payment is a function of price, down payment, interest rate, and loan term — a low payment can hide a high price stretched over more months. Lock the price, then talk financing.",
  },
  {
    question: "Does paying cash get me a better price?",
    answer:
      "Not usually, and sometimes the opposite. Many dealers earn money arranging financing, so a cash buyer removes one of their profit centers. Negotiate the vehicle price as if you're financing, settle on the out-the-door number, and decide how to pay afterward.",
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
            Getting the best price on a car is not about being a tough negotiator or
            knowing a secret phrase. It&apos;s about understanding how dealer pricing
            actually works, knowing what number to anchor to, and putting yourself in a
            position where dealers compete instead of you negotiating alone. This guide
            applies in every US market — the fundamentals don&apos;t change from Los
            Angeles to Miami to Chicago.
          </p>
          <p>
            By the end you&apos;ll know the difference between MSRP and invoice, how
            dealer markup and incentives really work, how to verify you&apos;re getting a
            fair price, and the single fastest way to reach the true floor without
            spending a weekend haggling.
          </p>
        </>
      }
      faqs={FAQS}
    >
      <section>
        <h2>What price should you actually pay for a car?</h2>
        <p>
          The price you should pay is the lowest number a dealer will accept while still
          completing the sale — and that number is almost always below the sticker. The
          sticker price (MSRP) is a suggestion, not a fair-market value. Your real target
          sits somewhere between the dealer&apos;s cost and MSRP, adjusted for incentives
          and demand.
        </p>
        <p>
          To set a realistic target, you need three reference points: the MSRP, the
          dealer invoice (what the dealer nominally paid the manufacturer), and the
          current manufacturer incentives on that model. The invoice gives you a sense of
          the dealer&apos;s starting room, and incentives often create additional room
          below it. Once you have those numbers, you have a defensible target instead of a
          guess.
        </p>
        <p>
          The mistake most buyers make is anchoring to MSRP and feeling good about any
          discount off it. A $1,000 discount off an inflated sticker can still be a worse
          deal than what the dealer down the street would offer unprompted. The anchor
          should be the dealer&apos;s cost, not the sticker.
        </p>
      </section>

      <section>
        <h2>How does dealer markup really work?</h2>
        <p>
          Dealer markup is the difference between what the dealership pays for a vehicle
          and what it sells it for — but that gap is more layered than a single number.
          The visible layer is MSRP minus invoice. Underneath sit holdback (a percentage
          the manufacturer rebates to the dealer after the sale), volume bonuses, and
          financing reserve. These hidden layers are why a dealer can sell at or even
          below invoice and still make money.
        </p>
        <p>
          On high-demand vehicles, some dealers add a line above MSRP — variously called a
          market adjustment, additional dealer markup (ADM), or addendum. This is pure
          profit with no cost behind it. It is always negotiable, and many dealers will
          remove it when they know you can buy the same vehicle elsewhere. Our{" "}
          <Link href="/buying-guide/dealer-fees-complete-guide">complete dealer fee guide</Link>{" "}
          breaks down which charges are real and which are markup dressed up as a fee.
        </p>
        <p>
          The practical takeaway: don&apos;t treat MSRP as the ceiling and invoice as the
          floor. Treat invoice as a reference point and recognize that incentives,
          holdback, and end-of-month volume pressure can all push the real floor lower.
        </p>
      </section>

      <section>
        <h2>How do you know you&apos;re getting a fair price?</h2>
        <p>
          You know you&apos;re getting a fair price when multiple independent dealers,
          competing for the same sale, converge on a similar number — and you&apos;ve
          chosen the lowest of them on an out-the-door basis. A single quote, no matter
          how good it sounds, tells you nothing without something to compare it to.
        </p>
        <p>
          Always compare on the <strong>out-the-door (OTD) price</strong>: the total of
          vehicle price, taxes, title, registration, and every dealer fee. A low vehicle
          price with padded fees can cost more than a higher vehicle price with clean
          fees. Ask every dealer for a complete OTD breakdown in writing before you
          compare. For more on what those fees should look like in your state, see the{" "}
          <Link href="/buying-guide/dealer-fees-complete-guide">dealer fee guide</Link>.
        </p>
        <p>
          Timing helps too. Dealers work to monthly and quarterly targets, so the last
          days of a month or quarter can produce more aggressive offers. But timing only
          matters if dealers know they&apos;re competing — pressure without competition
          doesn&apos;t move price. That&apos;s where the structure of the deal matters more
          than the calendar.
        </p>
      </section>

      <section>
        <h2>How to get competing offers without the hassle</h2>
        <p>
          The fastest way to reach a fair price is to make dealers compete for your
          business at the same time — privately, on your terms. That is exactly what
          AutoLenis does. You tell us the vehicle you want, and our dealer-discovery
          system finds local dealers near your zip code automatically. Up to 8 dealers
          then submit their best offers in a private 48-hour auction.
        </p>
        <p>
          You don&apos;t negotiate, you don&apos;t field sales calls, and you don&apos;t
          drive from lot to lot. You compare the offers side by side and pick the one that
          wins. Because dealers know they&apos;re bidding against each other, they lead with
          a competitive number instead of starting high and waiting for you to grind it
          down. The competition does the work that haggling used to.
        </p>
        <p>
          This works in every US market because the system finds dealers near any zip
          code. When you&apos;re ready, you can{" "}
          <Link href="/for-buyers">start an auction</Link> and let the offers come to you.
        </p>
      </section>
    </PillarArticle>
  );
}
