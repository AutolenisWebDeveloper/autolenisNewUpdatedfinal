import { Receiver } from "@upstash/qstash";

// Lazy-init so module import during `next build` doesn't throw when the
// signing keys aren't present in the build environment. Verification only
// runs at request time inside a job route.
let _receiver: Receiver | null = null;

export function getReceiver(): Receiver {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!currentSigningKey) {
    throw new Error("QSTASH_CURRENT_SIGNING_KEY is not set");
  }
  if (!nextSigningKey) {
    throw new Error("QSTASH_NEXT_SIGNING_KEY is not set");
  }

  if (!_receiver) {
    _receiver = new Receiver({ currentSigningKey, nextSigningKey });
  }
  return _receiver;
}
