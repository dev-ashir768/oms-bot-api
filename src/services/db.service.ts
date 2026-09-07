import pool from "../db/pool.js";
import { config } from "../config/env.js";
import { createLogger } from "../utils/logger.js";
import type { ChatMessage, ChatSession } from "../types/index.js";

const log = createLogger("db-service");

export async function ensureUser(userId: string, name?: string): Promise<void> {
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

export async function getUserName(userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT name FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0]?.name || null;
}

export async function ensureSession(
  sessionId: string,
  userId: string
): Promise<void> {
  const start = Date.now();
  await pool.query(
    `INSERT INTO chat_sessions (id, user_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [sessionId, userId]
  );
  log.debug(`ensureSession completed`, { sessionId, userId, duration: Date.now() - start });
}

export async function getRecentHistory(
  sessionId: string
): Promise<ChatMessage[]> {
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

export async function saveMessage(
  sessionId: string,
  sender: "user" | "model",
  content: string
): Promise<void> {
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

export async function getFullHistory(
  userId: string,
  sessionId: string
): Promise<ChatMessage[]> {
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

export async function getUserSessions(userId: string): Promise<ChatSession[]> {
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

export async function logIngestedDocument(
  filename: string,
  chunkCount: number
): Promise<void> {
  await pool.query(
    `INSERT INTO ingested_documents (filename, chunk_count) VALUES ($1, $2)`,
    [filename, chunkCount]
  );
  log.info(`Document ingestion logged`, { filename, chunkCount });
}
