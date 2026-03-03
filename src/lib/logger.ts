/**
 * Structured logging utility.
 *
 * Console-based for now; the interface is designed so a future external
 * logging backend (e.g. Axiom, Datadog) can be plugged in without
 * changing call sites.
 *
 * Usage:
 *   import { log } from "@/lib/logger";
 *   log.info("File loaded", { fileName, size });
 *   log.error("Export failed", error, { segmentCount });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LEVEL_ORDER) return env as LogLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[getMinLevel()];
}

function formatEntry(level: LogLevel, message: string, context?: LogContext, error?: unknown) {
  const ts = new Date().toISOString();
  const entry: Record<string, unknown> = {
    ts,
    level,
    msg: message,
  };
  if (context && Object.keys(context).length > 0) {
    Object.assign(entry, context);
  }
  if (error instanceof Error) {
    entry.error = error.message;
    entry.stack = error.stack?.split("\n").slice(0, 4).join("\n");
  } else if (error !== undefined) {
    entry.error = String(error);
  }
  return entry;
}

function emit(level: LogLevel, message: string, context?: LogContext, error?: unknown) {
  if (!shouldLog(level)) return;
  const entry = formatEntry(level, message, context, error);

  switch (level) {
    case "error":
      console.error(JSON.stringify(entry));
      break;
    case "warn":
      console.warn(JSON.stringify(entry));
      break;
    case "debug":
      console.debug(JSON.stringify(entry));
      break;
    default:
      console.log(JSON.stringify(entry));
  }
}

export const log = {
  debug(message: string, context?: LogContext) {
    emit("debug", message, context);
  },

  info(message: string, context?: LogContext) {
    emit("info", message, context);
  },

  warn(message: string, context?: LogContext) {
    emit("warn", message, context);
  },

  error(message: string, error?: unknown, context?: LogContext) {
    emit("error", message, context, error);
  },

  /** Time an async operation and log its duration. */
  async time<T>(label: string, fn: () => Promise<T>, context?: LogContext): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = Math.round(performance.now() - start);
      emit("info", `${label} completed`, { ...context, durationMs });
      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      emit("error", `${label} failed`, { ...context, durationMs }, error);
      throw error;
    }
  },
};
