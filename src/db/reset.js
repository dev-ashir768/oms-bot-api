import pool from "./pool.js";
import { logger } from "../utils/logger.js";
const reset = `
TRUNCATE TABLE chat_messages, response_cache, ingested_documents CASCADE;
TRUNCATE TABLE chat_sessions CASCADE;
TRUNCATE TABLE users CASCADE;
`;
async function resetDatabase() {
  try {
    logger.info("Resetting database...");
    await pool.query(reset);
    logger.info("Database reset successfully. All data cleared, schema intact.");
  } catch (err) {
    logger.error("Database reset failed", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
resetDatabase();

//# sourceMappingURL=reset.js.map
