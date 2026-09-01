// lib/ai/provider-errors.ts
//
// A typed transport error carrying the HTTP status, in its own module so
// `lib/ai/provider.ts` and the adapters under `lib/ai/providers/` can both
// import it without a cycle.
//
// The status is a first-class property, not something to substring-match out of
// the message. `lib/social/groq-script.engine.ts` already made this point: its
// retry layer reads `error.status` precisely so a 400 or 500 whose *body*
// happens to contain "429" is not retried. Preserving that property is part of
// preserving caller behaviour across the transport migration.

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly provider: string;
  readonly detail: string;

  constructor(provider: string, status: number, detail: string) {
    super(`${provider} HTTP ${status}: ${detail.slice(0, 300)}`);
    this.name = "ProviderHttpError";
    this.provider = provider;
    this.status = status;
    this.detail = detail;
  }
}
