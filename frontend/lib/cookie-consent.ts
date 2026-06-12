// Cookie consent state management — pure TypeScript (no React) so it can be
// used from both client components and analytics scripts. Persists the user's
// choice in localStorage and broadcasts a "consentUpdated" event so gated
// analytics components (TikTok Pixel, Microsoft Clarity) can react in realtime.

const STORAGE_KEY = "autolenis_cookie_consent";

export type ConsentState = {
  essential: true; // always true — cannot be disabled
  analytics: boolean; // TikTok Pixel, Clarity
  marketing: boolean; // future: Meta Pixel, Google Ads
  decided: boolean; // has user made a choice?
  decidedAt?: string; // ISO timestamp
};

export const DEFAULT_CONSENT: ConsentState = {
  essential: true,
  analytics: false,
  marketing: false,
  decided: false,
};

export function getConsent(): ConsentState {
  if (typeof window === "undefined") return DEFAULT_CONSENT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONSENT;
    return { ...DEFAULT_CONSENT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONSENT;
  }
}

export function setConsent(consent: Partial<ConsentState>): void {
  if (typeof window === "undefined") return;
  const current = getConsent();
  const updated: ConsentState = {
    ...current,
    ...consent,
    essential: true, // always force true
    decided: true,
    decidedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  // Dispatch event so other components can react
  window.dispatchEvent(new CustomEvent("consentUpdated", { detail: updated }));
}

export function acceptAll(): void {
  setConsent({ analytics: true, marketing: true });
}

export function rejectNonEssential(): void {
  setConsent({ analytics: false, marketing: false });
}

export function hasDecided(): boolean {
  return getConsent().decided;
}
