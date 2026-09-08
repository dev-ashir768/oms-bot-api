import pg from "pg";
import { config } from "../config/env.js";
import { createLogger } from "../utils/logger.js";
const log = createLogger("postgres");
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 3e4,
  connectionTimeoutMillis: 5e3
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
var pool_default = pool;
export {
  pool_default as default
};

//# sourceMappingURL=pool.js.map
