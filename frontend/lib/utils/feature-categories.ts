/** Feature category definitions for vehicle options/features display */

export const FEATURE_CATS: Array<{ label: string; kw: string[] }> = [
  { label: "Safety & Driver Assist",    kw: ["airbag","abs","brake","blind spot","lane","collision","backup camera","rear camera","parking sensor","park assist","pedestrian","traction","stability","360","bsm","fcw","ldw","pre-collision","safety","surround"] },
  { label: "Technology & Connectivity", kw: ["bluetooth","wifi","carplay","android auto","navigation","nav","gps","display","screen","touch","wireless","usb","satellite","sirius","xm","audio","sound","bose","jbl","harman","streaming","remote start","app"] },
  { label: "Comfort & Convenience",     kw: ["heated seat","cooled seat","ventilated","massage","memory seat","power seat","lumbar","sunroof","moonroof","panoramic","keyless","push button","climate","dual zone","tri zone","auto dim","rain sensor","power liftgate","power trunk","ambient"] },
  { label: "Exterior",                  kw: ["wheel","rim","alloy","chrome","roof rack","towing","trailer","hitch","running board","step","paint","tinted","led","headlight","fog light","daytime","spoiler","skid plate"] },
  { label: "Interior",                  kw: ["leather","vinyl","fabric","carpet","wood trim","carbon","alcantara","suede","steering wheel","paddle","third row","captain","bench","fold","storage"] },
  { label: "Performance",               kw: ["awd","4wd","4x4","all wheel","four wheel","sport","turbo","supercharg","intercool","adaptive","magnetic","suspension","caliper"] },
];

/**
 * Groups a flat list of feature strings into named category buckets.
 * Features that don't match any category fall into "Other".
 * Returns only populated buckets in [label, items[]] pairs.
 */
export function bucketFeatures(features: string[]): Array<[string, string[]]> {
  const buckets: Record<string, string[]> = Object.fromEntries([
    ...FEATURE_CATS.map(c => [c.label, [] as string[]]),
    ["Other", [] as string[]],
  ]);

  for (const f of features) {
    const lower = f.toLowerCase();
    let placed = false;
    for (const cat of FEATURE_CATS) {
      if (cat.kw.some(kw => lower.includes(kw))) {
        buckets[cat.label]?.push(f);
        placed = true;
        break;
      }
    }
    if (!placed) buckets["Other"]?.push(f);
  }

  return Object.entries(buckets).filter(([, items]) => items.length > 0);
}
