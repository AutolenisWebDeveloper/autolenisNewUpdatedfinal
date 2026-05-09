// FaithVerseModule — System 25
// Shows a faith verse fetched from the admin CMS.
// Falls back to FALLBACK_VERSE if the API returns null or errors.
// Born-again invitation appears ONLY on /hope — never here.

interface FaithVerseModuleProps {
  pageKey: string;
  className?: string;
}

const FALLBACK_VERSE = {
  text: "Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.",
  reference: "Colossians 3:23",
};

async function fetchVerse(pageKey: string): Promise<{ reference: string; text: string } | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/faith/verse/${pageKey}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json() as { success: boolean; data?: { reference: string; text: string } };
    return data.success && data.data ? data.data : null;
  } catch {
    return null;
  }
}

export default async function FaithVerseModule({ pageKey, className }: FaithVerseModuleProps) {
  const verse = (await fetchVerse(pageKey)) ?? FALLBACK_VERSE;

  return (
    <aside
      data-testid={`faith-verse-${pageKey}`}
      className={className ?? ""}
    >
      <p className="text-base md:text-xl italic text-white/85 leading-relaxed mb-4 max-w-2xl mx-auto">
        &ldquo;{verse.text}&rdquo;
      </p>
      <p className="text-sm font-semibold text-white/50 tracking-wide">
        — {verse.reference}
      </p>
    </aside>
  );
}
