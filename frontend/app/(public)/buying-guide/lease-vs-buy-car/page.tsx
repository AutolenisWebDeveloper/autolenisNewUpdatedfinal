import type { Metadata } from "next";
import Link from "next/link";

import { buildPageMetadata } from "@/lib/seo/metadata";
import PillarArticle, { type PillarFaq } from "@/components/buying-guide/PillarArticle";

const SLUG = "lease-vs-buy-car";
const TITLE = "Lease vs Buy: The Complete Decision Framework";
const DESCRIPTION =
  "Money factor, residual value, total cost of ownership, and when leasing or " +
  "buying actually makes sense. A clear framework for the lease vs buy decision.";

export const metadata: Metadata = buildPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: `/buying-guide/${SLUG}`,
  keywords: [
    "lease vs buy",
    "should I lease or buy a car",
    "money factor",
    "residual value",
    "car total cost of ownership",
  ],
});

export const revalidate = 86400;

const FAQS: PillarFaq[] = [
  {
    question: "Is it cheaper to lease or buy a car?",
    answer:
      "Over a single short term, leasing usually has lower monthly payments because you only pay for the depreciation during the lease, not the whole car. Over the long run, buying and keeping a vehicle past its loan is almost always cheaper per mile because you eventually drive payment-free. The cheaper option depends on how long you keep cars.",
  },
  {
    question: "What is a money factor and how do I know if it's good?",
    answer:
      "The money factor is the interest rate on a lease, expressed as a small decimal. Multiply it by 2,400 to get the rough equivalent APR. A money factor of 0.00125, for example, is about 3% APR. Like any rate, it's negotiable and tied to your credit — always ask for it and convert it so you can compare.",
  },
  {
    question: "What is residual value and why does it matter?",
    answer:
      "Residual value is the car's projected worth at lease-end, set as a percentage of MSRP. A higher residual means the car depreciates less on paper, so your lease payment is lower. High-residual vehicles are the ones that lease most attractively, which is why two similarly priced cars can have very different lease payments.",
  },
  {
    question: "Can you negotiate a lease?",
    answer:
      "Yes. The vehicle's selling price (the capitalized cost) is negotiable on a lease just like a purchase, and lowering it lowers your payment. The money factor can also move with strong credit. The residual is generally fixed by the leasing company. Negotiate the cap cost first, exactly as you would a purchase price.",
  },
  {
    question: "Should I buy out my lease at the end?",
    answer:
      "Sometimes. If the car's market value is higher than the buyout price set at lease signing, buying it out can be a good deal. If the buyout is above market value, walk away or use it as leverage. Compare the contractual buyout to current market value before deciding.",
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
            Lease or buy is one of the most consequential — and most misunderstood —
            decisions in car buying. It&apos;s not a question of which is &quot;smarter&quot;
            in the abstract; it&apos;s a question of which fits how you actually use and keep
            cars. The same person can be right to lease one year and right to buy the next.
          </p>
          <p>
            This framework breaks down the numbers that drive the decision — money factor,
            residual value, and total cost of ownership — and lays out exactly when each
            path makes sense. It applies nationally; the math doesn&apos;t change by state,
            though local incentives and taxes can tilt it.
          </p>
        </>
      }
      faqs={FAQS}
    >
      <section>
        <h2>What's the real difference between leasing and buying?</h2>
        <p>
          When you buy, you pay for the entire vehicle and own an asset at the end — one
          that keeps losing value but is yours to keep, sell, or drive payment-free once the
          loan is gone. When you lease, you pay only for the portion of the car&apos;s value
          you use up during the term (its depreciation) plus rent (interest), and you hand
          the car back at the end with nothing to show for the payments.
        </p>
        <p>
          That single distinction drives everything else. Leasing trades long-term economy
          for lower short-term payments and the ability to drive a newer car more often.
          Buying trades higher early payments for long-term economy and ownership. Neither
          is a trick; they&apos;re different deals for different priorities.
        </p>
      </section>

      <section>
        <h2>How do you read a lease — money factor and residual?</h2>
        <p>
          Two numbers control a lease payment, and most buyers never ask for either. The{" "}
          <strong>money factor</strong> is the interest rate in disguise. It looks like a
          tiny decimal (say 0.00125), but multiply it by 2,400 and you get the approximate
          APR (about 3%). Always ask for the money factor and convert it — a &quot;great
          lease deal&quot; with a quietly high money factor isn&apos;t great.
        </p>
        <p>
          The <strong>residual value</strong> is the car&apos;s projected worth at lease-end,
          expressed as a percentage of MSRP. A higher residual means less depreciation on
          paper, which means a lower payment. This is why two cars at the same price can
          have very different lease payments: the one that holds its value leases cheaper.
          The residual is set by the leasing company and generally isn&apos;t negotiable, but
          the <strong>capitalized cost</strong> — the selling price the lease is built on —
          absolutely is. Negotiate it exactly like a purchase, using the same approach in{" "}
          <Link href="/buying-guide/how-to-get-best-car-price">
            how to get the best price on any car
          </Link>
          .
        </p>
      </section>

      <section>
        <h2>How should you think about total cost of ownership?</h2>
        <p>
          The monthly payment is the worst way to compare lease vs buy because the two
          aren&apos;t paying for the same thing. The right lens is total cost of ownership
          (TCO) over the period you actually keep cars. For a leaser who replaces the car
          every three years, TCO is essentially an unending series of payments. For a buyer
          who keeps a car for eight to ten years, TCO is the purchase spread over many more
          payment-free years — almost always lower per mile.
        </p>
        <p>
          Factor in the things that don&apos;t show up on the payment: mileage limits and
          per-mile overage charges on a lease, wear-and-tear charges at lease-end, and the
          gap insurance often bundled into leases. On the buy side, factor in maintenance
          costs that rise as the car ages but still rarely exceed the cost of perpetual
          payments. See the{" "}
          <Link href="/buying-guide/dealer-fees-complete-guide">dealer fee guide</Link> for
          the charges that get bundled into both deals.
        </p>
      </section>

      <section>
        <h2>When does leasing make sense, and when does buying?</h2>
        <p>
          <strong>Leasing tends to make sense when:</strong>
        </p>
        <ul>
          <li>You like driving a new car every two to four years.</li>
          <li>You drive predictable, modest annual mileage within the lease limit.</li>
          <li>You value lower payments and warranty coverage over building equity.</li>
          <li>You want to avoid the resale and depreciation risk at trade-in time.</li>
        </ul>
        <p>
          <strong>Buying tends to make sense when:</strong>
        </p>
        <ul>
          <li>You keep cars well past the loan term.</li>
          <li>You drive high or unpredictable mileage.</li>
          <li>You want to eventually be payment-free.</li>
          <li>You want a vehicle to trade in or sell later — see our{" "}
            <Link href="/buying-guide/car-trade-in-value-guide">trade-in value guide</Link>.
          </li>
        </ul>
      </section>

      <section>
        <h2>How to get competing offers without the hassle</h2>
        <p>
          Whether you lease or buy, the selling price is negotiable — and the fastest way to
          a fair selling price is to make dealers compete. AutoLenis does this for you. You
          tell us the vehicle you want, our dealer-discovery system finds local dealers near
          your zip code, and up to 8 of them submit their best offers in a private 48-hour
          auction.
        </p>
        <p>
          Because dealers know they&apos;re competing, they lead with a strong capitalized
          cost instead of starting high. You compare the offers and pick the winner, then
          decide whether leasing or buying fits your situation. It works in every US market.{" "}
          <Link href="/for-buyers">Start your auction</Link> when you&apos;re ready.
        </p>
      </section>
    </PillarArticle>
  );
}
