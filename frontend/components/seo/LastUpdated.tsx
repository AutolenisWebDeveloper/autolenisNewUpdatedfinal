// Visible "last reviewed" indicator for time-sensitive pages.
// Reinforces topical freshness signals for search engines and provides
// user trust that the content is current.

export default function LastUpdated({ date }: { date: string }) {
  return (
    <p className="text-xs text-slate-400 mt-1" suppressHydrationWarning>
      <time dateTime={date}>
        Last reviewed:{" "}
        {new Date(date).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })}
      </time>
    </p>
  );
}
