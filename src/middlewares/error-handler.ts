import type { Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.js";

const log = createLogger("error-handler");

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  log.error(`Unhandled error on ${req.method} ${req.originalUrl}`, {
    requestId: req.requestId,
    error: err,
  });

  res.status(500).json({
    error: "Internal server error",
    ...(process.env.NODE_ENV !== "production" && { message: err.message }),
  });
}
