import { createLogger } from "../utils/logger.js";
const log = createLogger("error-handler");
function errorHandler(err, req, res, _next) {
  log.error(`Unhandled error on ${req.method} ${req.originalUrl}`, {
    requestId: req.requestId,
    error: err
  });
  res.status(500).json({
    error: "Internal server error",
    ...process.env.NODE_ENV !== "production" && { message: err.message }
  });
}
export {
  errorHandler
};

//# sourceMappingURL=error-handler.js.map
