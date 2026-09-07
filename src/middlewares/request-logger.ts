import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { createLogger } from "../utils/logger.js";

const log = createLogger("http");

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      startTime: number;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  req.requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.startTime = Date.now();

  res.setHeader("X-Request-Id", req.requestId);

  log.info(`--> ${req.method} ${req.originalUrl}`, {
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });

  res.on("finish", () => {
    const duration = Date.now() - req.startTime;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    log[level](`<-- ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, {
      requestId: req.requestId,
      statusCode: res.statusCode,
      duration,
    });
  });

  next();
}
