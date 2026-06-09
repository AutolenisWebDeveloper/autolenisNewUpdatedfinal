// AutoLenis Social Engine — Content Quality Gate.
//
// Scores a generated post across four dimensions (hook strength, specificity,
// CTA clarity, compliance) on a 0–100 scale before it is persisted. The
// orchestrator uses the score to flag priority content, hold compliance risks,
// and trigger a single regeneration pass when content falls below threshold.

export interface QualityScore {
  total: number;
  hookStrength: number;
  specificity: number;
  ctaClarity: number;
  compliance: number;
  isPriority: boolean;
  needsRegeneration: boolean;
  reasons: string[];
}

export function scorePostQuality(post: {
  hook: string;
  script: string;
  caption: string;
  ctaText?: string | null;
  platform: string;
  franchise: string;
  complianceNotes?: string | null;
}): QualityScore {
  const reasons: string[] = [];
  let hookStrength = 0;
  let specificity = 0;
  let ctaClarity = 0;
  let compliance = 0;

  // --- HOOK STRENGTH (0-25) ---
  const hookWords = post.hook.trim().split(/\s+/).length;
  const hookLower = post.hook.toLowerCase();
  const powerWords = [
    "never",
    "always",
    "secret",
    "truth",
    "exposed",
    "warning",
    "stop",
    "danger",
    "mistake",
    "hidden",
  ];
  const hasDirectAccusation =
    hookLower.startsWith("your dealer") ||
    hookLower.startsWith("dealers ") ||
    hookLower.includes("just added") ||
    hookLower.includes("never told");
  const hasDollarAmount = /\$[\d,]+/.test(post.hook);
  const hasCityName =
    /dallas|houston|austin|miami|atlanta|chicago|denver|phoenix|seattle|nashville|charlotte|tampa|los angeles|new york|san antonio/i.test(
      post.hook,
    );
  const hasMakeModel =
    /toyota|ford|chevrolet|honda|ram|gmc|hyundai|kia|jeep|bmw|mercedes|nissan|subaru/i.test(
      post.hook,
    );
  const hasPowerWord = powerWords.some((w) => hookLower.includes(w));

  if (hookWords > 20) {
    hookStrength = 0;
    reasons.push("Hook too long (over 20 words)");
  } else if (
    (hasDollarAmount || hasCityName || hasMakeModel) &&
    (hasPowerWord || hasDirectAccusation)
  ) {
    hookStrength = 25;
  } else if (hasPowerWord || hasDirectAccusation) {
    hookStrength = 18;
  } else if (post.hook.includes("?")) {
    hookStrength = 10;
    reasons.push("Hook is a question — consider a statement with urgency");
  } else {
    hookStrength = 5;
    reasons.push("Hook lacks urgency or specificity");
  }

  // --- SPECIFICITY (0-25) ---
  let specPoints = 0;
  if (hasDollarAmount) specPoints += 5;
  if (hasCityName) specPoints += 5;
  if (hasMakeModel) specPoints += 5;
  if (/\d+%/.test(post.script + post.caption)) specPoints += 5;
  if (
    /\d+ (days?|hours?|minutes?|weeks?|months?)/i.test(
      post.script + post.caption,
    )
  )
    specPoints += 5;
  specificity = Math.min(specPoints, 25);
  if (specificity < 10) {
    reasons.push("Content lacks specific numbers, cities, or vehicles");
  }

  // --- CTA CLARITY (0-25) ---
  const ctaText = (post.ctaText ?? post.caption ?? "").toLowerCase();
  const platformCTAs: Record<string, RegExp[]> = {
    tiktok: [/save this (video|post)/, /share with someone/, /comment .{1,20} if/],
    instagram: [/save this (post|🔖)/, /tag someone/, /link in bio/],
    facebook: [/\?$/, /comment (below|your|if)/, /drop (it|your|a) (in|below)/],
    linkedin: [/\?$/, /what (do you|has|would)/, /have you (ever|seen|experienced)/],
    youtube: [/subscribe/, /comment below/, /watch (until|to the end)/],
  };
  const patterns = platformCTAs[post.platform] ?? [];
  const hasPlatformCTA = patterns.some((p) => p.test(ctaText));
  if (hasPlatformCTA) {
    ctaClarity = 25;
  } else if (ctaText.length > 5) {
    ctaClarity = 15;
    reasons.push(`CTA present but not optimized for ${post.platform}`);
  } else {
    ctaClarity = 0;
    reasons.push("Missing clear CTA");
  }

  // --- COMPLIANCE (0-25) ---
  const fullText = (
    post.hook +
    " " +
    post.script +
    " " +
    post.caption
  ).toLowerCase();
  const hardViolations = [
    "guaranteed",
    "guarantee",
    "100% savings",
    "definitely save",
    "will save you",
  ];
  const hasHardViolation = hardViolations.some((v) => fullText.includes(v));
  if (hasHardViolation) {
    compliance = 0;
    reasons.push("COMPLIANCE: Contains guarantee language");
  } else if (post.complianceNotes && post.complianceNotes.length > 5) {
    compliance = 12;
    reasons.push("Compliance review needed: " + post.complianceNotes);
  } else {
    compliance = 25;
  }

  const total = hookStrength + specificity + ctaClarity + compliance;

  return {
    total,
    hookStrength,
    specificity,
    ctaClarity,
    compliance,
    isPriority: total >= 90,
    needsRegeneration: total < 70,
    reasons,
  };
}
