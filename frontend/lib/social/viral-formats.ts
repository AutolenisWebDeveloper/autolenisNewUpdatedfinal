// AutoLenis Social Engine — Viral Format Library (Option B).
//
// 13 proven viral post structures across 5 platforms. The Groq script engine
// selects a format for the (platform, hookType) being generated and injects its
// structure into the user prompt so every post follows a battle-tested template.

export interface ViralFormat {
  id: string;
  name: string;
  hookEmotion: string;
  platform: string;
  format?: string;
  avgCompletionRate?: number;
  saveRate?: string;
  commentSignal?: string;
  note?: string;
  structure: string;
  ctaStyle?: string;
}

export const VIRAL_FORMATS: Record<string, ViralFormat[]> = {
  tiktok: [
    {
      id: "tiktok_reveal",
      name: "The Dealer Secret Reveal",
      platform: "tiktok",
      hookEmotion: "fear",
      avgCompletionRate: 0.72,
      ctaStyle: "save_this",
      structure: `
Hook (0-3s): "[Shocking statement about a dealer fee or tactic]"
Beat 1 (3-8s): "Here is exactly what it says on the contract..."
Beat 2 (8-15s): "This fee is called [name] and here is the truth..."
Beat 3 (15-25s): "Here is the exact phrase to say to remove it:"
  "[Specific negotiation script]"
CTA (25-30s): "Save this before your next dealership visit 🔖"
On-screen text: Show the fee name in large bold text throughout
      `,
    },
    {
      id: "tiktok_comparison",
      name: "The Price Comparison",
      platform: "tiktok",
      hookEmotion: "surprise",
      avgCompletionRate: 0.78,
      ctaStyle: "comment_experience",
      structure: `
Hook (0-3s): "I got quotes from [N] dealers for the exact same car"
Beat 1 (3-10s): "Dealer 1 quoted me $[price range]"
Beat 2 (10-17s): "Dealer 2 quoted me $[different price]"
Reveal (17-25s): "The difference was $[gap]. Here is exactly why."
CTA (25-30s): "Comment your worst dealer experience below"
On-screen text: Show dollar amounts as large text overlay
      `,
    },
    {
      id: "tiktok_warning",
      name: "The Buyer Warning",
      platform: "tiktok",
      hookEmotion: "fear",
      avgCompletionRate: 0.69,
      ctaStyle: "share_with_someone",
      structure: `
Hook (0-3s): "Never sign a car contract until you check line [X]"
Beat 1 (3-8s): "Most people miss this because dealers rush you"
Beat 2 (8-18s): "Here is exactly what to look for and what it means"
Beat 3 (18-25s): "If you see this, say: [exact script]"
CTA (25-30s): "Share this with someone buying a car this month"
On-screen text: Circle/arrow pointing to the specific item
      `,
    },
    {
      id: "tiktok_story",
      name: "The Buyer Story",
      platform: "tiktok",
      hookEmotion: "social_proof",
      avgCompletionRate: 0.61,
      ctaStyle: "link_in_bio",
      structure: `
Hook (0-3s): "A buyer in [city] just got [N] dealers to compete"
Beat 1 (3-10s): "They submitted one request on AutoLenis"
Beat 2 (10-20s): "48 hours later — here is what happened: [outcome]"
CTA (20-30s): "This is exactly how AutoLenis works. Link in bio."
On-screen text: Show the city and outcome prominently
      `,
    },
    {
      id: "tiktok_myth_bust",
      name: "The Myth Buster",
      platform: "tiktok",
      hookEmotion: "controversy",
      avgCompletionRate: 0.81,
      ctaStyle: "comment_word",
      structure: `
Hook (0-3s): "Car dealers are NOT required to [common misconception]"
Beat 1 (3-10s): "Here is what most people believe..."
Beat 2 (10-20s): "But the law actually says [real rule]"
Beat 3 (20-28s): "Use this knowledge to negotiate [specific benefit]"
CTA (28-30s): "Comment MYTH if this surprised you"
On-screen text: "MYTH" in red → "TRUTH" in green visual contrast
      `,
    },
  ],

  instagram: [
    {
      id: "instagram_carousel_list",
      name: "The Save-Worthy List",
      platform: "instagram",
      format: "carousel",
      hookEmotion: "curiosity",
      saveRate: "very_high",
      note: "Carousels get saved 4x more than single images",
      structure: `
Slide 1: "[Number] things your dealer hopes you never Google"
  - Bold number, high contrast background, curiosity gap headline
Slides 2 through N: One insight per slide
  - Short headline (maximum 8 words)
  - 1-2 sentence plain-language explanation
  - Each slide must be MORE surprising than the last
Final slide: "Save this post — share with someone car shopping 🔖"
  - AutoLenis logo + autolenis.com
      `,
    },
    {
      id: "instagram_reel_hook",
      name: "The Visual Hook Reel",
      platform: "instagram",
      format: "reel",
      hookEmotion: "fear",
      note: "First frame text determines CTR — it IS the thumbnail",
      structure: `
First frame: Bold text overlay with the hook claim
             (this becomes the thumbnail — make it impossible to ignore)
0-3s: State the problem with urgency and clarity
3-10s: Agitate — make the viewer feel the consequence
10-20s: Solution reveal — how AutoLenis eliminates this problem
20-25s: One social proof sentence
CTA: "Link in bio for free competing dealer offers"
      `,
    },
    {
      id: "instagram_story_poll",
      name: "The Engagement Poll",
      platform: "instagram",
      format: "story",
      hookEmotion: "social_proof",
      note: "Polls dramatically increase story completion rate",
      structure: `
Frame 1: Polarizing question about car buying experience
         Add interactive Poll sticker: Yes/No or This/That
Frame 2: 1-2 sentence follow-up context or surprising fact
Frame 3: AutoLenis solution CTA with link sticker
      `,
    },
  ],

  facebook: [
    {
      id: "facebook_question",
      name: "The Conversation Starter",
      platform: "facebook",
      hookEmotion: "controversy",
      format: "text_with_image",
      commentSignal: "high",
      note: "IMPORTANT: Put autolenis.com link in FIRST COMMENT not caption. Facebook suppresses reach for posts with external links in caption.",
      structure: `
Opening: One surprising or polarizing statement about dealers
Context: 2-3 sentences adding credibility and detail
Question: A direct question asking for personal experience
          This drives comments which drives algorithmic reach
          Example: "What is the most surprising fee you have seen
          at a dealership? Drop it below 👇"
Note: Post the autolenis.com link as the first comment after publishing
      `,
    },
    {
      id: "facebook_local",
      name: "The Local Market Report",
      platform: "facebook",
      hookEmotion: "savings",
      format: "text_with_image",
      note: "Geo-targeted local content increases engagement 3x",
      structure: `
Opening: "[City] car buyers — this is worth reading this week"
Data point 1: Specific local market fact (buyer leverage, inventory, prices)
Data point 2: Second local fact that supports the narrative
Insight: What this means for buyers right now in plain language
CTA: "Comment your ZIP code and I will share specific dealer data"
      `,
    },
  ],

  linkedin: [
    {
      id: "linkedin_story",
      name: "The Professional Story",
      platform: "linkedin",
      hookEmotion: "social_proof",
      format: "text",
      note: "LinkedIn rewards dwell time — write 150+ words minimum",
      structure: `
Hook: Personal story opener — "Last week, a buyer in [city]..."
Paragraph 1: Set the scene — what the buyer faced
Paragraph 2: What they did differently using AutoLenis
Paragraph 3: The specific outcome (number of offers, savings)
Insight: One professional lesson or data point this illustrates
CTA: Question inviting professional engagement
Hashtags: 3-5 professional hashtags only (not consumer hashtags)
      `,
    },
    {
      id: "linkedin_data",
      name: "The Market Intelligence Post",
      platform: "linkedin",
      hookEmotion: "social_proof",
      format: "document",
      note: "LinkedIn document posts get 3x more dwell time than text posts",
      structure: `
Page 1: Bold headline with the key statistic or insight
Pages 2-4: Supporting data points with brief context
Page 5: AutoLenis Market Index summary
Final page: CTA — "Get the full weekly report at autolenis.com/buying-guide"
      `,
    },
  ],

  youtube: [
    {
      id: "youtube_short_hook",
      name: "The Shorts Pattern Interrupt",
      platform: "youtube",
      hookEmotion: "curiosity",
      format: "short",
      note: "First frame = thumbnail on YouTube Shorts. High-contrast text overlay determines CTR.",
      structure: `
Frame 1 (becomes thumbnail): Bold text claim on high-contrast background
0-3s: Pattern interrupt — unexpected visual or statement
      (Something the viewer did NOT expect to see)
3-15s: Deliver the exact value promised in the hook
15-25s: Surprising additional insight or reveal
CTA: "Subscribe for weekly dealer secrets"
      `,
    },
  ],
};

export function getViralFormat(
  platform: string,
  hookType: string,
): ViralFormat | null {
  const formats = VIRAL_FORMATS[platform];
  if (!formats || formats.length === 0) return null;

  // First: exact hook emotion match
  const exact = formats.find((f) => f.hookEmotion === hookType);
  if (exact) return exact;

  // Second: first format for platform
  return formats[0] ?? null;
}
