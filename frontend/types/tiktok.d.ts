// Global type declaration for the TikTok Pixel runtime object (`ttq`).
// Loaded by <TikTokPixel /> in the root layout. Kept optional because the
// pixel script is injected with `afterInteractive`, so `window.ttq` may be
// undefined for the first paint and on the server.
export {};

declare global {
  interface Window {
    ttq?: {
      page: () => void;
      track: (event: string, params?: Record<string, unknown>) => void;
      identify: (params: Record<string, unknown>) => void;
      load: (pixelId: string, options?: Record<string, unknown>) => void;
      instance: (pixelId: string) => unknown;
    };
  }
}
