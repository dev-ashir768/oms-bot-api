import { config } from "../config/env.js";
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = process.env.LOG_LEVEL || (config.nodeEnv === "production" ? "info" : "debug");
const COLORS = {
  debug: "\x1B[36m",
  // cyan
  info: "\x1B[32m",
  // green
  warn: "\x1B[33m",
  // yellow
  error: "\x1B[31m"
  // red
};
const RESET = "\x1B[0m";
const DIM = "\x1B[2m";
const BOLD = "\x1B[1m";
function formatMeta(meta) {
  if (meta === void 0 || meta === null) return "";
  if (meta instanceof Error) {
    return `
  ${COLORS.error}${meta.message}${RESET}${meta.stack ? `
${DIM}${meta.stack.split("\n").slice(1).join("\n")}${RESET}` : ""}`;
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
function log(level, context, message, meta) {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;
  const now = /* @__PURE__ */ new Date();
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
function createLogger(context) {
  return {
    debug: (msg, meta) => log("debug", context, msg, meta),
    info: (msg, meta) => log("info", context, msg, meta),
    warn: (msg, meta) => log("warn", context, msg, meta),
    error: (msg, meta) => log("error", context, msg, meta)
  };
}
const logger = createLogger("app");
export {
  createLogger,
  logger
};

//# sourceMappingURL=logger.js.map
