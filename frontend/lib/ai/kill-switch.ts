// lib/ai/kill-switch.ts
// AI kill switch — checked before every AI call (System 16 requirement)
// Groq API is the ONLY approved AI provider. No OpenAI/Anthropic/Gemini/Cohere.

export function isAiEnabled(): boolean {
  const killSwitch = process.env.AI_KILL_SWITCH;
  // Kill switch is ON when explicitly set to "true" — default is enabled
  return killSwitch !== "true";
}

export function assertAiEnabled(): void {
  if (!isAiEnabled()) {
    throw new Error("AI_KILL_SWITCH is active — all AI operations are disabled");
  }
}
