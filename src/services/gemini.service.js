import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config/env.js";
import { createLogger } from "../utils/logger.js";
const log = createLogger("gemini");
const pool = config.geminiApiKeys.map((key, index) => {
  const genAI = new GoogleGenerativeAI(key);
  return {
    key,
    index,
    embeddingModel: genAI.getGenerativeModel({ model: config.embeddingModel }),
    chatModel: genAI.getGenerativeModel({
      model: config.chatModel,
      generationConfig: { temperature: 0.4, maxOutputTokens: 1024, topP: 0.8 }
    }),
    cooldownUntil: 0,
    failCount: 0
  };
});
let currentIndex = 0;
log.info(`Gemini pool configured`, {
  keys: pool.length,
  embedding: config.embeddingModel,
  chat: config.chatModel
});
function maskKey(key) {
  if (key.length < 12) return "***";
  return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`;
}
function nextAvailable() {
  const now = Date.now();
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const candidate = pool[currentIndex];
    if (candidate.cooldownUntil <= now) return candidate;
    currentIndex = (currentIndex + 1) % pool.length;
  }
  return null;
}
function rotate() {
  currentIndex = (currentIndex + 1) % pool.length;
}
function shouldRotate(err) {
  const status = err?.status;
  const message = String(err?.message || "").toLowerCase();
  if (status === 429 || message.includes("quota") || message.includes("rate limit")) {
    return { rotate: true, cooldownMs: 60 * 1e3 };
  }
  if (status === 403 || message.includes("permission") || message.includes("api key")) {
    return { rotate: true, cooldownMs: 10 * 60 * 1e3 };
  }
  if (status >= 500) {
    return { rotate: true, cooldownMs: 15 * 1e3 };
  }
  return { rotate: false, cooldownMs: 0 };
}
async function withRotation(fn, opName) {
  const start = Date.now();
  let lastErr = null;
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const client = nextAvailable();
    if (!client) {
      log.error(`All Gemini keys in cooldown`, { opName, keys: pool.length });
      break;
    }
    try {
      const result = await fn(client);
      if (client.failCount > 0) {
        log.info(`Key recovered`, { opName, key: maskKey(client.key), previousFails: client.failCount });
        client.failCount = 0;
      }
      return result;
    } catch (err) {
      lastErr = err;
      const { rotate: shouldMove, cooldownMs } = shouldRotate(err);
      client.failCount++;
      log.warn(`Gemini call failed`, {
        opName,
        key: maskKey(client.key),
        keyIndex: client.index,
        status: err?.status,
        message: err?.message,
        rotate: shouldMove
      });
      if (shouldMove) {
        client.cooldownUntil = Date.now() + cooldownMs;
        rotate();
        continue;
      }
      throw err;
    }
  }
  log.error(`All Gemini keys exhausted`, { opName, duration: Date.now() - start });
  throw lastErr || new Error(`All Gemini API keys exhausted for ${opName}`);
}
async function generateEmbedding(text) {
  const start = Date.now();
  try {
    const values = await withRotation(async (client) => {
      const result = await client.embeddingModel.embedContent(text);
      return result.embedding.values;
    }, "generateEmbedding");
    log.debug(`Embedding generated`, { chars: text.length, dimension: values.length, duration: Date.now() - start });
    return values;
  } catch (err) {
    log.error(`Embedding failed after rotation`, {
      chars: text.length,
      duration: Date.now() - start,
      status: err?.status,
      message: err?.message
    });
    throw err;
  }
}
async function generateEmbeddings(texts) {
  const totalStart = Date.now();
  log.info(`Generating embeddings for ${texts.length} chunks`);
  const batchSize = 10;
  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(texts.length / batchSize);
    const batchStart = Date.now();
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await Promise.all(batch.map(generateEmbedding));
    results.push(...embeddings);
    log.debug(`Batch ${batchNum}/${totalBatches} done`, { batchSize: batch.length, duration: Date.now() - batchStart });
    if (i + batchSize < texts.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  log.info(`All embeddings generated`, { total: texts.length, duration: Date.now() - totalStart });
  return results;
}
async function generateResponse(systemPrompt, userMessage) {
  const start = Date.now();
  log.info(`Generating LLM response`, { promptLength: systemPrompt.length, messageLength: userMessage.length });
  try {
    const response = await withRotation(async (client) => {
      const fullPrompt = `${systemPrompt}

User: ${userMessage}`;
      const result = await client.chatModel.generateContent(fullPrompt);
      return result.response.text();
    }, "generateResponse");
    log.info(`LLM response generated`, { responseLength: response.length, duration: Date.now() - start });
    return response;
  } catch (err) {
    log.error(`LLM generation failed after rotation`, {
      model: config.chatModel,
      duration: Date.now() - start,
      status: err?.status,
      message: err?.message
    });
    throw new Error("Failed to generate AI response");
  }
}
async function* generateResponseStream(systemPrompt, userMessage) {
  const start = Date.now();
  log.info(`Generating LLM stream`, { promptLength: systemPrompt.length, messageLength: userMessage.length });
  const streamResult = await withRotation(async (client) => {
    const fullPrompt = `${systemPrompt}

User: ${userMessage}`;
    return await client.chatModel.generateContentStream(fullPrompt);
  }, "generateResponseStream");
  try {
    let totalChars = 0;
    for await (const chunk of streamResult.stream) {
      const text = chunk.text();
      if (text) {
        totalChars += text.length;
        yield text;
      }
    }
    log.info(`LLM stream complete`, { totalChars, duration: Date.now() - start });
  } catch (err) {
    log.error(`LLM stream failed mid-way`, {
      model: config.chatModel,
      duration: Date.now() - start,
      status: err?.status,
      message: err?.message
    });
    throw new Error("Failed to generate AI stream response");
  }
}
function getKeyPoolStatus() {
  const now = Date.now();
  return pool.map((k) => ({
    index: k.index,
    masked: maskKey(k.key),
    cooldownRemaining: Math.max(0, k.cooldownUntil - now),
    failCount: k.failCount
  }));
}
export {
  generateEmbedding,
  generateEmbeddings,
  generateResponse,
  generateResponseStream,
  getKeyPoolStatus
};

//# sourceMappingURL=gemini.service.js.map
