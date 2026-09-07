import type { Request, Response, NextFunction } from "express";
import { config } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("auth");

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.apiKey) {
    log.warn("API_KEY not configured — auth middleware is a no-op");
    return next();
  }

  const provided =
    (req.headers["x-api-key"] as string) ||
    (req.headers["X-API-Key"] as string) ||
    (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : undefined);

  if (!provided) {
    log.warn("Auth failed: missing API key", {
      path: req.path,
      ip: req.ip,
      requestId: req.requestId,
    });
    res.status(401).json({
      error: "Unauthorized",
      message: "API key required. Send it in the X-API-Key header.",
    });
    return;
  }

  if (provided !== config.apiKey) {
    log.warn("Auth failed: invalid API key", {
      path: req.path,
      ip: req.ip,
      requestId: req.requestId,
    });
    res.status(403).json({
      error: "Forbidden",
      message: "Invalid API key.",
    });
    return;
  }

  next();
}
