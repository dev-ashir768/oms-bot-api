import { randomUUID } from "crypto";
import { createLogger } from "../utils/logger.js";
const log = createLogger("http");
function requestLogger(req, res, next) {
  req.requestId = req.headers["x-request-id"] || randomUUID();
  req.startTime = Date.now();
  res.setHeader("X-Request-Id", req.requestId);
  log.info(`--> ${req.method} ${req.originalUrl}`, {
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get("user-agent")
  });
  res.on("finish", () => {
    const duration = Date.now() - req.startTime;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    log[level](`<-- ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, {
      requestId: req.requestId,
      statusCode: res.statusCode,
      duration
    });
  });
  next();
}
export {
  requestLogger
};

//# sourceMappingURL=request-logger.js.map
