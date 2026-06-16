import { logger } from "@/lib/logger";
import { getQstash, QSTASH_BASE_URL } from "./client";

interface DispatchOptions {
  path: string;
  body: Record<string, unknown>;
  delaySeconds?: number;
  retries?: number;
}

// Fire-and-forget job dispatch. Failures are logged but never thrown so a
// dispatch problem can't break the platform action that triggered it.
export async function dispatch({
  path,
  body,
  delaySeconds = 0,
  retries = 3,
}: DispatchOptions): Promise<void> {
  try {
    await getQstash().publishJSON({
      url: `${QSTASH_BASE_URL}${path}`,
      body,
      delay: delaySeconds,
      retries,
    });
  } catch (err) {
    logger.error(`QStash dispatch failed for ${path}:`, err);
  }
}
