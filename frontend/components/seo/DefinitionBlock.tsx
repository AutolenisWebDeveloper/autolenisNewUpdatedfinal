// "What is X?" blocks — directly AI-extractable definitions.
// Structure matches what AI systems prefer for entity definitions.

interface DefinitionBlockProps {
  term: string;
  definition: string;
  category?: string;
  relatedTerms?: string[];
}

export default function DefinitionBlock({
  term,
  definition,
  category,
  relatedTerms,
}: DefinitionBlockProps) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-2xl p-5 my-5"
      data-definition-block
      itemScope
      itemType="https://schema.org/DefinedTerm"
    >
      <div className="flex items-start gap-3">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-1 rounded-lg shrink-0 mt-0.5">
          {category ?? "Definition"}
        </span>
        <div>
          <h3 className="font-bold text-slate-900 text-base mb-2" itemProp="name">
            What is {term}?
          </h3>
          <p
            className="text-sm text-slate-600 leading-relaxed"
            itemProp="description"
          >
            {definition}
          </p>
          {relatedTerms && relatedTerms.length > 0 && (
            <p className="text-xs text-slate-400 mt-2">
              Related: {relatedTerms.join(" · ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
