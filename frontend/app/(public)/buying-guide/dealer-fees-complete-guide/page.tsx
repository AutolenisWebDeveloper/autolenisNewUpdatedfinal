import type { Metadata } from "next";
import Link from "next/link";

import { buildPageMetadata } from "@/lib/seo/metadata";
import PillarArticle, { type PillarFaq } from "@/components/buying-guide/PillarArticle";

const SLUG = "dealer-fees-complete-guide";
const TITLE = "Every Dealer Fee Explained — What's Real, What's a Ripoff";
const DESCRIPTION =
  "Doc fees, market adjustments, add-ons, and state rules — every dealer fee " +
  "explained so you know what's required, what's negotiable, and what to reject.";

export const metadata: Metadata = buildPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: `/buying-guide/${SLUG}`,
  keywords: [
    "dealer fees explained",
    "doc fee",
    "market adjustment fee",
    "what dealer fees are negotiable",
    "junk fees car",
  ],
});

export const revalidate = 86400;

const FAQS: PillarFaq[] = [
  {
    question: "What dealer fees are required by law?",
    answer:
      "Only government fees are truly mandatory: title transfer, registration/license, and sales tax. These are set by your state and aren't negotiable. Everything else on the worksheet — doc fees, add-ons, market adjustments — is set by the dealer and is fair game.",
  },
  {
    question: "Is a doc fee negotiable?",
    answer:
      "The doc fee itself is a dealer charge, so it's negotiable in principle, but some states cap how much a dealer can charge. In capped states a fee above the cap is illegal. In uncapped states the fee can be high but legal, which means you negotiate it like any other line item. A state-aware calculator can tell you which situation you're in.",
  },
  {
    question: "What is a market adjustment fee?",
    answer:
      "A market adjustment (also called ADM or additional dealer markup) is an amount added above MSRP during high demand. There is no cost behind it — it's pure profit. It's always negotiable, and many dealers remove it when they know you can buy the same vehicle elsewhere.",
  },
  {
    question: "Should I pay for paint protection, nitrogen tires, or VIN etching?",
    answer:
      "Almost never at dealer prices. These add-ons are sold at extreme markup for products and services available far more cheaply elsewhere — or with negligible benefit. Ask to have them removed. If a dealer claims they're pre-installed and non-removable, that's a reason to compare other dealers.",
  },
  {
    question: "How do I know if a fee is too high for my state?",
    answer:
      "Compare it against your state's typical range and any legal cap. Doc fee caps and norms vary widely — what's normal in one state is excessive in another. Use a state-aware dealer fee tool to check any specific fee against your state's rules before you agree to it.",
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
            The price on the window is rarely the price you pay. Between agreeing on a
            number and signing the contract, a stack of fees appears — some legitimate and
            unavoidable, some negotiable, and some that are pure profit dressed up to look
            official. Knowing which is which is one of the highest-value skills in car
            buying.
          </p>
          <p>
            This guide explains every common dealer fee: what it is, whether it&apos;s
            required, and what to do about it. Fee rules vary by state, so we&apos;ll also
            point you to a state-aware tool that checks any fee against your state&apos;s
            specific caps and norms.
          </p>
        </>
      }
      faqs={FAQS}
    >
      <section>
        <h2>Which dealer fees are actually required?</h2>
        <p>
          Only three categories of charge are genuinely mandatory, and all three are
          government fees rather than dealer profit: <strong>sales tax</strong>,{" "}
          <strong>title transfer</strong>, and <strong>registration/license</strong>. Your
          state sets these amounts, the dealer simply collects and remits them, and no
          amount of negotiating changes them. When you see these on a worksheet, they
          belong there.
        </p>
        <p>
          Everything else is a dealer charge. That doesn&apos;t automatically make it
          illegitimate — some dealer fees reflect real administrative work — but it does
          mean the dealer chose the amount, which means it can be questioned, reduced, or
          removed. The single most useful habit is to mentally sort every line into
          &quot;government fee&quot; or &quot;dealer fee&quot; the moment you see the
          worksheet.
        </p>
      </section>

      <section>
        <h2>What is a doc fee and how much should it be?</h2>
        <p>
          The documentation (or processing) fee is the dealer&apos;s charge for handling
          paperwork. Here&apos;s the catch: some states cap it by law, and others
          don&apos;t. In a capped state, any doc fee above the legal cap is illegal and you
          should refuse to pay the excess. In an uncapped state, dealers can charge
          hundreds of dollars legally — which makes the fee high but not against the rules,
          so you treat it as a negotiable line item.
        </p>
        <p>
          Because the right verdict depends entirely on your state, a flat rule like
          &quot;never pay more than $100&quot; doesn&apos;t work nationally. That&apos;s
          why we built a{" "}
          <Link href="/tools/dealer-fee-calculator">state-aware dealer fee calculator</Link>{" "}
          — enter any fee and it tells you whether it&apos;s required by your state&apos;s
          law, within the normal range, high enough to negotiate hard, or above the legal
          cap.
        </p>
      </section>

      <section>
        <h2>What is a market adjustment and should you ever pay it?</h2>
        <p>
          A market adjustment — also labeled ADM, additional dealer markup, or an addendum
          — is an amount added above MSRP when demand is high. Unlike a doc fee, there is
          no administrative work or cost behind it. It exists purely because the dealer
          believes someone will pay it. It is always negotiable, and frequently removable
          outright when the dealer knows you can buy the same vehicle elsewhere.
        </p>
        <p>
          Treat a market adjustment as a signal, not a fee. A dealer charging a large
          markup is telling you they&apos;re prioritizing margin over moving the unit —
          which usually means another dealer nearby will sell the same car without it. The
          fastest way to make a market adjustment disappear is to put that dealer in
          competition with others, which is the core idea behind{" "}
          <Link href="/buying-guide/how-to-negotiate-car-price">negotiating car price</Link>.
        </p>
      </section>

      <section>
        <h2>Which add-ons should you reject outright?</h2>
        <p>
          A cluster of common add-ons are almost always pure markup. You can decline all of
          them, and a fair dealer will let you:
        </p>
        <ul>
          <li>
            <strong>Paint and fabric protection</strong> — coatings sold at extreme markup;
            equivalent products cost a fraction at any auto parts store.
          </li>
          <li>
            <strong>Nitrogen tire inflation</strong> — regular air is already about 78%
            nitrogen; paying hundreds for the rest is profit with negligible benefit.
          </li>
          <li>
            <strong>VIN etching</strong> — a theft deterrent worth roughly $20 to do
            yourself, often charged at $200–$400.
          </li>
          <li>
            <strong>Dealer-installed accessories</strong> — floor mats, tint, door guards
            marked up several times over retail.
          </li>
        </ul>
        <p>
          Two add-ons are situational rather than automatic rejects:{" "}
          <strong>GAP insurance</strong> and an <strong>extended warranty</strong> can have
          real value, but dealer pricing is heavily marked up and both are negotiable — and
          often cheaper from your own insurer or a third party, or purchased later. Always
          get the out-the-door total in writing so these don&apos;t slip back in after you
          think you&apos;ve agreed on a number.
        </p>
      </section>

      <section>
        <h2>How to get competing offers without the hassle</h2>
        <p>
          Fees thrive on isolation. When you&apos;re negotiating with one dealer, a padded
          doc fee or a surprise market adjustment is hard to push back on because you have
          nothing to compare it to. When dealers compete, padded fees stand out instantly —
          a clean out-the-door number beats a low vehicle price buried under junk fees.
        </p>
        <p>
          AutoLenis makes that comparison automatic. Tell us the vehicle you want, and our
          dealer-discovery system finds local dealers near your zip code. Up to 8 of them
          submit their best <strong>out-the-door</strong> offers in a private 48-hour
          auction — fees included. You see the real total from each dealer, side by side,
          and pick the cleanest deal. It works in every US market.{" "}
          <Link href="/for-buyers">Start your auction</Link> when you&apos;re ready.
        </p>
      </section>
    </PillarArticle>
  );
}
