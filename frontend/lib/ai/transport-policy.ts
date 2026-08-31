// lib/ai/transport-policy.ts
//
// The transport policy every Zura chat surface had BEFORE the groq-sdk left the
// call path, as one shared constant.
//
// `groq-sdk` applied `maxRetries = 2` and `timeout = 60000` to every request it
// made (`core.js`: `constructor({ baseURL, maxRetries = 2, timeout = 60000 })`),
// so all six surfaces — the four portal chats via `agents.ts`, the public chat,
// and the voice turn handler — inherited a bounded request and two automatic
// retries without ever asking for them.
//
// WHY THIS IS AN OPT-IN CONSTANT AND NOT A DEFAULT ON `CompletionRequest`:
// the social, acquisition and dealer-recruitment callers the provider adapter
// absorbed were on a bare `fetch` before this phase and must NOT gain retries
// they never had — several already wrap their own, which would compound into a
// retry storm against a provider that is already failing. Defaulting it would
// change their behaviour silently, so each chat entry point opts in explicitly.
//
// WHY IT IS ITS OWN MODULE RATHER THAN LIVING IN `provider.ts`:
// `provider.ts` is the module every AI test replaces with `mock.module`, since
// mocking it is how a test avoids a real model call. A wholesale module mock
// supplies only the exports that test names, so a POLICY CONSTANT living there
// reads back as `undefined` inside any suite that mocks the provider — and the
// production code that dereferences it throws. Behaviour is mocked; data should
// not have to be. This is the same separation `model-registry.ts` already makes,
// so that reading the model inventory does not pull in a provider SDK.

export const CHAT_TRANSPORT_POLICY = {
  /** Retries on a transient failure (408/409/429/5xx), with backoff. */
  maxRetries: 2,
  /** Per-attempt timeout in ms. */
  timeoutMs: 60_000,
} as const;
