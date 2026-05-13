// A structured, AI-extractable content block.
// Used on pages where AI systems should be able to pull an isolated,
// authoritative answer. Format matches what ChatGPT, Perplexity,
// and Google AI Overviews prefer: concise, direct, attributed.

interface CitationBlockProps {
  question: string;
  answer: string;
  sourceLabel?: string;
  lastUpdated?: string;
  id?: string;
}

export default function CitationBlock({
  question,
  answer,
  sourceLabel = "AutoLenis",
  lastUpdated,
  id,
}: CitationBlockProps) {
  return (
    <div
      id={id}
      className="border-l-4 border-[#0B5FD1] pl-5 py-3 my-5 bg-blue-50/40 rounded-r-xl"
      itemScope
      itemType="https://schema.org/Question"
      data-citation-block
    >
      <p
        className="text-xs font-bold text-[#0B5FD1] uppercase tracking-wide mb-1.5"
        itemProp="name"
      >
        {question}
      </p>
      <div itemScope itemType="https://schema.org/Answer" itemProp="acceptedAnswer">
        <p className="text-sm text-slate-700 leading-relaxed" itemProp="text">
          {answer}
        </p>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[10px] text-slate-400">Source: {sourceLabel}</span>
        {lastUpdated && (
          <time className="text-[10px] text-slate-400" dateTime={lastUpdated}>
            Updated{" "}
            {new Date(lastUpdated).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
            })}
          </time>
        )}
      </div>
    </div>
  );
}
