import pool from "../db/pool.js";
import { createLogger } from "../utils/logger.js";
import { config } from "../config/env.js";
const log = createLogger("cache");
function normalize(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}
function embeddingToBuffer(embedding) {
  const buf = Buffer.alloc(embedding.length * 4);
  embedding.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf;
}
function bufferToEmbedding(buf) {
  const arr = [];
  for (let i = 0; i < buf.length; i += 4) {
    arr.push(buf.readFloatLE(i));
  }
  return arr;
}
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
async function findCachedResponse(question, questionEmbedding) {
  const start = Date.now();
  const normalized = normalize(question);
  const exact = await pool.query(
    `SELECT id, response FROM response_cache WHERE question_normalized = $1 LIMIT 1`,
    [normalized]
  );
  if (exact.rows.length > 0) {
    await pool.query(
      `UPDATE response_cache SET hit_count = hit_count + 1, updated_at = NOW() WHERE id = $1`,
      [exact.rows[0].id]
    );
    log.info(`Cache HIT (exact match)`, { duration: Date.now() - start });
    return { response: exact.rows[0].response, similarity: 1, id: exact.rows[0].id };
  }
  const all = await pool.query(
    `SELECT id, question_embedding, response FROM response_cache`
  );
  let bestMatch = null;
  for (const row of all.rows) {
    const cachedEmbedding = bufferToEmbedding(row.question_embedding);
    const similarity = cosineSimilarity(questionEmbedding, cachedEmbedding);
    if (similarity >= config.cacheSimilarityThreshold) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { response: row.response, similarity, id: row.id };
      }
    }
  }
  if (bestMatch) {
    await pool.query(
      `UPDATE response_cache SET hit_count = hit_count + 1, updated_at = NOW() WHERE id = $1`,
      [bestMatch.id]
    );
    log.info(`Cache HIT (semantic)`, { similarity: bestMatch.similarity.toFixed(4), duration: Date.now() - start });
    return bestMatch;
  }
  log.debug(`Cache MISS`, { duration: Date.now() - start });
  return null;
}
async function saveToCache(question, questionEmbedding, response) {
  const normalized = normalize(question);
  const embeddingBuf = embeddingToBuffer(questionEmbedding);
  await pool.query(
    `INSERT INTO response_cache (question_normalized, question_embedding, response) VALUES ($1, $2, $3)`,
    [normalized, embeddingBuf, response]
  );
  log.debug(`Response cached`, { question: question.slice(0, 60) });
}
export {
  findCachedResponse,
  saveToCache
};

//# sourceMappingURL=cache.service.js.map
