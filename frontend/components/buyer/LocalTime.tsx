"use client";

import { useEffect, useState } from "react";

// Render an instant in the VIEWER's timezone, not the server's.
//
// Every surface in this phase is a React Server Component, and `toLocaleString` with no
// explicit `timeZone` uses the SERVER's — which on Vercel is UTC. A buyer in Pacific time
// would read a 10pm Friday deadline as "Sat, Sep 20, 5:00 AM UTC": the wrong day, on the
// one line where the day is the entire point.
//
// WHY THE FALLBACK IS THE ISO DATE AND NOT A FORMATTED UTC TIME. Before hydration there
// is no viewer zone to format against. Rendering a plausible-looking local time that is
// actually UTC is worse than rendering something obviously machine-shaped: one is wrong
// and looks right, the other is right and looks technical. The `<time dateTime>` element
// also gives assistive technology and any scraper the unambiguous instant either way.
export function LocalTime({ iso }: { iso: string }) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    setFormatted(
      new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    );
  }, [iso]);

  return <time dateTime={iso}>{formatted ?? iso.slice(0, 16).replace("T", " ") + " UTC"}</time>;
}
