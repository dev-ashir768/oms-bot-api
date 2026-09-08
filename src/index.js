import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config/env.js";
import { loadIndex } from "./services/faiss.service.js";
import { getKeyPoolStatus } from "./services/gemini.service.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { requestLogger } from "./middlewares/request-logger.js";
import { apiKeyAuth } from "./middlewares/auth.js";
import { createLogger } from "./utils/logger.js";
import chatRoutes from "./routes/chat.routes.js";
import ingestRoutes from "./routes/ingest.routes.js";
import pool from "./db/pool.js";
const log = createLogger("server");
const app = express();
app.use(helmet());
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: "*" }));
app.use(requestLogger);
app.use(express.json({ limit: "10mb" }));
app.use("/api", apiKeyAuth);
app.use("/api/chat", chatRoutes);
app.use("/api/rag/ingest", ingestRoutes);
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  } catch {
    res.status(503).json({ status: "degraded", database: "disconnected", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
});
app.get("/health/gemini", (_req, res) => {
  res.json({ keys: getKeyPoolStatus(), timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
app.use(errorHandler);
async function start() {
  log.info("Starting server...");
  try {
    await pool.query("SELECT 1");
    log.info("PostgreSQL connected");
  } catch (err) {
    log.error("PostgreSQL connection failed", err);
    process.exit(1);
  }
  loadIndex();
  app.listen(config.port, () => {
    log.info(`Server running on port ${config.port}`, { env: config.nodeEnv, pid: process.pid });
  });
}
process.on("uncaughtException", (err) => {
  log.error("Uncaught exception", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", reason);
  process.exit(1);
});
process.on("SIGTERM", async () => {
  log.info("SIGTERM received, shutting down gracefully...");
  await pool.end();
  log.info("Database pool closed");
  process.exit(0);
});
start();
var src_default = app;
export {
  src_default as default
};

//# sourceMappingURL=index.js.map
