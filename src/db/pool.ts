import pg from "pg";
import { config } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("postgres");

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("connect", () => {
  log.debug("New client connected to pool");
});

pool.on("error", (err) => {
  log.error("Unexpected pool error", err);
});

pool.on("remove", () => {
  log.debug("Client removed from pool");
});

export default pool;
