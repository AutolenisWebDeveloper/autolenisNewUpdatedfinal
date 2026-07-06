// lib/logger.ts — minimal structured logger.
//
// Dependency-free and edge-runtime safe (wraps console). Drop-in for console:
//   logger.error("[esign] failed", err)   // same call shape as console.error
//
// In production it emits one JSON line per call (level, time, msg, args) so logs
// are queryable in the platform's log sink; in dev it stays human-readable.
// `debug` is suppressed unless LOG_LEVEL=debug (or non-production default).

type LogLevel = "debug" | "info" | "warn" | "error";

const WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const isProd = process.env.NODE_ENV === "production";

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "").toLowerCase() as LogLevel;
  if (configured in WEIGHT) return WEIGHT[configured];
  return isProd ? WEIGHT.info : WEIGHT.debug;
}

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) return { name: arg.name, message: arg.message, stack: arg.stack };
  return arg;
}

// Forward error-level entries to Sentry when it is active (no-op without a
// DSN). Lazy require keeps this module dependency-light for unit tests and
// avoids a hard edge-runtime import cost on non-error paths.
function forwardToSentry(message: string, args: unknown[]): void {
  try {
    const Sentry = require("@sentry/nextjs") as typeof import("@sentry/nextjs");
    const err = args.find((a): a is Error => a instanceof Error);
    if (err) {
      Sentry.captureException(err, { extra: { message, args: args.filter((a) => a !== err) } });
    } else {
      Sentry.captureMessage(message, { level: "error", extra: { args } });
    }
  } catch {
    // Sentry unavailable (edge bundle stripped it, or SDK not initialized) —
    // console logging below still happens.
  }
}

function emit(level: LogLevel, message: string, args: unknown[]): void {
  if (WEIGHT[level] < threshold()) return;

  if (level === "error" && isProd) forwardToSentry(message, args);

  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (isProd) {
    const entry: Record<string, unknown> = { level, time: new Date().toISOString(), msg: message };
    if (args.length) entry.args = args.map(serializeArg);
    sink(JSON.stringify(entry));
    return;
  }

  // Dev: keep the familiar console output.
  sink(`[${level}] ${message}`, ...args);
}

export const logger = {
  debug: (message: string, ...args: unknown[]) => emit("debug", message, args),
  info: (message: string, ...args: unknown[]) => emit("info", message, args),
  warn: (message: string, ...args: unknown[]) => emit("warn", message, args),
  error: (message: string, ...args: unknown[]) => emit("error", message, args),
};

export type Logger = typeof logger;
