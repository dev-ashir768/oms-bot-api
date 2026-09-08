import { createLogger } from "../utils/logger.js";
const log = createLogger("rate-limit");
const stores = /* @__PURE__ */ new Map();
function getStore(name) {
  let store = stores.get(name);
  if (!store) {
    store = /* @__PURE__ */ new Map();
    stores.set(name, store);
  }
  return store;
}
function rateLimit(name, options) {
  const { windowMs, max, keyExtractor } = options;
  const store = getStore(name);
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of store.entries()) {
      const filtered = timestamps.filter((t) => now - t < windowMs);
      if (filtered.length === 0) store.delete(key);
      else store.set(key, filtered);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const key = keyExtractor ? keyExtractor(req) : req.ip || "unknown";
    if (!key) return next();
    const now = Date.now();
    const timestamps = (store.get(key) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= max) {
      const oldest = timestamps[0];
      const retryAfter = Math.ceil((windowMs - (now - oldest)) / 1e3);
      log.warn(`Rate limit exceeded`, { key, count: timestamps.length, max, retryAfter });
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(Math.ceil((oldest + windowMs) / 1e3)));
      res.status(429).json({
        error: "Too many requests",
        message: `You have exceeded the ${max} requests per ${Math.ceil(windowMs / 1e3)}s limit. Please try again in ${retryAfter} seconds.`,
        retryAfter
      });
      return;
    }
    timestamps.push(now);
    store.set(key, timestamps);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(max - timestamps.length));
    next();
  };
}
export {
  rateLimit
};

//# sourceMappingURL=rate-limit.js.map
