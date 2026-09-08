import pool from "../db/pool.js";
import { config } from "../config/env.js";
import { createLogger } from "../utils/logger.js";
const log = createLogger("db-service");
async function ensureUser(userId, name) {
  const start = Date.now();
  if (name) {
    await pool.query(
      `INSERT INTO users (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name), updated_at = NOW()`,
      [userId, name]
    );
  } else {
    await pool.query(
      `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [userId]
    );
  }
  log.debug(`ensureUser completed`, { userId, name, duration: Date.now() - start });
}
async function getUserName(userId) {
  const { rows } = await pool.query(
    `SELECT name FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0]?.name || null;
}
async function ensureSession(sessionId, userId) {
  const start = Date.now();
  const { rowCount } = await pool.query(
    `SELECT 1 FROM chat_sessions WHERE id = $1`,
    [sessionId]
  );
  if (rowCount && rowCount > 0) {
    log.debug(`ensureSession skipped (exists)`, { sessionId, userId });
    return;
  }
  const now = /* @__PURE__ */ new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const hh = now.getHours();
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const title = `New Chat ${dd}-${mm}-${yyyy} ${hh}:${min}:${ss}`;
  await pool.query(
    `INSERT INTO chat_sessions (id, user_id, title) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [sessionId, userId, title]
  );
  log.debug(`ensureSession completed`, { sessionId, userId, title, duration: Date.now() - start });
}
async function getRecentHistory(sessionId) {
  const start = Date.now();
  const { rows } = await pool.query(
    `SELECT sender, content FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, config.chatHistoryLimit]
  );
  const result = rows.reverse();
  log.debug(`Fetched ${result.length} history messages`, { sessionId, duration: Date.now() - start });
  return result;
}
async function saveMessage(sessionId, sender, content) {
  const start = Date.now();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO chat_messages (session_id, sender, content) VALUES ($1, $2, $3)`,
      [sessionId, sender, content]
    );
    await client.query(
      `UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`,
      [sessionId]
    );
    await client.query("COMMIT");
    log.debug(`Message saved`, { sessionId, sender, contentLength: content.length, duration: Date.now() - start });
  } catch (err) {
    await client.query("ROLLBACK");
    log.error(`Failed to save message, rolled back`, { sessionId, sender, error: err });
    throw err;
  } finally {
    client.release();
  }
}
async function getFullHistory(userId, sessionId) {
  const start = Date.now();
  const { rows } = await pool.query(
    `SELECT cm.sender, cm.content, cm.created_at
     FROM chat_messages cm
     JOIN chat_sessions cs ON cs.id = cm.session_id
     WHERE cm.session_id = $1 AND cs.user_id = $2
     ORDER BY cm.created_at ASC`,
    [sessionId, userId]
  );
  log.info(`Full history fetched: ${rows.length} messages`, { userId, sessionId, duration: Date.now() - start });
  return rows;
}
async function getUserSessions(userId) {
  const start = Date.now();
  const { rows } = await pool.query(
    `SELECT id, title, created_at, updated_at
     FROM chat_sessions
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId]
  );
  log.info(`Fetched ${rows.length} sessions`, { userId, duration: Date.now() - start });
  return rows;
}
async function updateSessionTitle(sessionId, userId, title) {
  const { rowCount } = await pool.query(
    `UPDATE chat_sessions SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [title, sessionId, userId]
  );
  log.info(`Session title updated`, { sessionId, userId, title, updated: rowCount });
  return (rowCount ?? 0) > 0;
}
async function deleteSession(sessionId, userId) {
  const { rowCount } = await pool.query(
    `DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  log.info(`Session deleted`, { sessionId, userId, deleted: rowCount });
  return (rowCount ?? 0) > 0;
}
async function countSessionMessages(sessionId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM chat_messages WHERE session_id = $1`,
    [sessionId]
  );
  return rows[0]?.cnt || 0;
}
async function getSessionTitle(sessionId) {
  const { rows } = await pool.query(
    `SELECT title FROM chat_sessions WHERE id = $1`,
    [sessionId]
  );
  return rows[0]?.title || null;
}
async function logIngestedDocument(filename, chunkCount) {
  await pool.query(
    `INSERT INTO ingested_documents (filename, chunk_count) VALUES ($1, $2)`,
    [filename, chunkCount]
  );
  log.info(`Document ingestion logged`, { filename, chunkCount });
}
export {
  countSessionMessages,
  deleteSession,
  ensureSession,
  ensureUser,
  getFullHistory,
  getRecentHistory,
  getSessionTitle,
  getUserName,
  getUserSessions,
  logIngestedDocument,
  saveMessage,
  updateSessionTitle
};

//# sourceMappingURL=db.service.js.map
