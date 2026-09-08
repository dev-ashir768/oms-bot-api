import { ZodError } from "zod";
import { createLogger } from "../utils/logger.js";
const log = createLogger("validation");
function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message
        }));
        log.warn(`Validation failed on ${req.method} ${req.originalUrl}`, {
          requestId: req.requestId,
          errors: details
        });
        res.status(400).json({ error: "Validation failed", details });
        return;
      }
      next(err);
    }
  };
}
export {
  validate
};

//# sourceMappingURL=validate.js.map
