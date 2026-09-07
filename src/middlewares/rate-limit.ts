import type { Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.js";

const log = createLogger("rate-limit");

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyExtractor?: (req: Request) => string;
}

const stores = new Map<string, Map<string, number[]>>();

function getStore(name: string): Map<string, number[]> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

export function rateLimit(name: string, options: RateLimitOptions) {
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

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyExtractor ? keyExtractor(req) : req.ip || "unknown";
    if (!key) return next();

    const now = Date.now();
    const timestamps = (store.get(key) || []).filter((t) => now - t < windowMs);

    if (timestamps.length >= max) {
      const oldest = timestamps[0];
      const retryAfter = Math.ceil((windowMs - (now - oldest)) / 1000);

      log.warn(`Rate limit exceeded`, { key, count: timestamps.length, max, retryAfter });

      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(Math.ceil((oldest + windowMs) / 1000)));

      res.status(429).json({
        error: "Too many requests",
        message: `You have exceeded the ${max} requests per ${Math.ceil(windowMs / 1000)}s limit. Please try again in ${retryAfter} seconds.`,
        retryAfter,
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
