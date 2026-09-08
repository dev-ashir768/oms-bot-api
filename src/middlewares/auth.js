import { config } from "../config/env.js";
import { createLogger } from "../utils/logger.js";
const log = createLogger("auth");
function apiKeyAuth(req, res, next) {
  if (!config.apiKey) {
    log.warn("API_KEY not configured \u2014 auth middleware is a no-op");
    return next();
  }
  const provided = req.headers["x-api-key"] || req.headers["X-API-Key"] || (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : void 0);
  if (!provided) {
    log.warn("Auth failed: missing API key", {
      path: req.path,
      ip: req.ip,
      requestId: req.requestId
    });
    res.status(401).json({
      error: "Unauthorized",
      message: "API key required. Send it in the X-API-Key header."
    });
    return;
  }
  if (provided !== config.apiKey) {
    log.warn("Auth failed: invalid API key", {
      path: req.path,
      ip: req.ip,
      requestId: req.requestId
    });
    res.status(403).json({
      error: "Forbidden",
      message: "Invalid API key."
    });
    return;
  }
  next();
}
export {
  apiKeyAuth
};

//# sourceMappingURL=auth.js.map
