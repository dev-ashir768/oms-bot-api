import { config } from "../config/env.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (config.nodeEnv === "production" ? "info" : "debug");

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m",  // green
  warn: "\x1b[33m",  // yellow
  error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function formatMeta(meta: unknown): string {
  if (meta === undefined || meta === null) return "";
  if (meta instanceof Error) {
    return `\n  ${COLORS.error}${meta.message}${RESET}${meta.stack ? `\n${DIM}${meta.stack.split("\n").slice(1).join("\n")}${RESET}` : ""}`;
  }
  if (typeof meta === "object") {
    try {
      return ` ${DIM}${JSON.stringify(meta)}${RESET}`;
    } catch {
      return ` ${DIM}[unserializable]${RESET}`;
    }
  }
  return ` ${DIM}${String(meta)}${RESET}`;
}

function log(level: LogLevel, context: string, message: string, meta?: unknown): void {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;

  const now = new Date();
  const time = `${DIM}${now.toISOString()}${RESET}`;
  const lvl = `${COLORS[level]}${BOLD}${level.toUpperCase().padEnd(5)}${RESET}`;
  const ctx = context ? `${DIM}[${context}]${RESET} ` : "";
  const metaStr = formatMeta(meta);

  const line = `${time} ${lvl} ${ctx}${message}${metaStr}`;

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createLogger(context: string) {
  return {
    debug: (msg: string, meta?: unknown) => log("debug", context, msg, meta),
    info: (msg: string, meta?: unknown) => log("info", context, msg, meta),
    warn: (msg: string, meta?: unknown) => log("warn", context, msg, meta),
    error: (msg: string, meta?: unknown) => log("error", context, msg, meta),
  };
}

export const logger = createLogger("app");
