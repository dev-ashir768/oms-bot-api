import type { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { createLogger } from "../utils/logger.js";

const log = createLogger("validation");

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));
        log.warn(`Validation failed on ${req.method} ${req.originalUrl}`, {
          requestId: req.requestId,
          errors: details,
        });
        res.status(400).json({ error: "Validation failed", details });
        return;
      }
      next(err);
    }
  };
}
