import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { config } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("gemini");

interface KeyPool {
  key: string;
  index: number;
  embeddingModel: GenerativeModel;
  chatModel: GenerativeModel;
  cooldownUntil: number;
  failCount: number;
}

const pool: KeyPool[] = config.geminiApiKeys.map((key, index) => {
  const genAI = new GoogleGenerativeAI(key);
  return {
    key,
    index,
    embeddingModel: genAI.getGenerativeModel({ model: config.embeddingModel }),
    chatModel: genAI.getGenerativeModel({
      model: config.chatModel,
      generationConfig: { temperature: 0.3, maxOutputTokens: config.maxOutputTokens, topP: 0.8 },
    }),
    cooldownUntil: 0,
    failCount: 0,
  };
});

let currentIndex = 0;

log.info(`Gemini pool configured`, {
  keys: pool.length,
  embedding: config.embeddingModel,
  chat: config.chatModel,
});

function maskKey(key: string): string {
  if (key.length < 12) return "***";
  return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`;
}

function nextAvailable(): KeyPool | null {
  const now = Date.now();
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const candidate = pool[currentIndex];
    if (candidate.cooldownUntil <= now) return candidate;
    currentIndex = (currentIndex + 1) % pool.length;
  }
  return null;
}

function rotate(): void {
  currentIndex = (currentIndex + 1) % pool.length;
}

function shouldRotate(err: any): { rotate: boolean; cooldownMs: number } {
  const status = err?.status;
  const message = String(err?.message || "").toLowerCase();

  if (status === 429 || message.includes("quota") || message.includes("rate limit")) {
    return { rotate: true, cooldownMs: 60 * 1000 };
  }
  if (status === 403 || message.includes("permission") || message.includes("api key")) {
    return { rotate: true, cooldownMs: 10 * 60 * 1000 };
  }
  if (status >= 500) {
    return { rotate: true, cooldownMs: 15 * 1000 };
  }
  return { rotate: false, cooldownMs: 0 };
}

async function withRotation<T>(
  fn: (client: KeyPool) => Promise<T>,
  opName: string
): Promise<T> {
  const start = Date.now();
  let lastErr: any = null;

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
    } catch (err: any) {
      lastErr = err;
      const { rotate: shouldMove, cooldownMs } = shouldRotate(err);
      client.failCount++;

      log.warn(`Gemini call failed`, {
        opName,
        key: maskKey(client.key),
        keyIndex: client.index,
        status: err?.status,
        message: err?.message,
        rotate: shouldMove,
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

export async function generateEmbedding(text: string): Promise<number[]> {
  const start = Date.now();
  try {
    const values = await withRotation(async (client) => {
      const result = await client.embeddingModel.embedContent(text);
      return result.embedding.values;
    }, "generateEmbedding");

    log.debug(`Embedding generated`, { chars: text.length, dimension: values.length, duration: Date.now() - start });
    return values;
  } catch (err: any) {
    log.error(`Embedding failed after rotation`, {
      chars: text.length,
      duration: Date.now() - start,
      status: err?.status,
      message: err?.message,
    });
    throw err;
  }
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const totalStart = Date.now();
  log.info(`Generating embeddings for ${texts.length} chunks`);

  const batchSize = 10;
  const results: number[][] = [];

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

export async function generateResponse(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const start = Date.now();
  log.info(`Generating LLM response`, { promptLength: systemPrompt.length, messageLength: userMessage.length });

  try {
    const response = await withRotation(async (client) => {
      const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}`;
      const result = await client.chatModel.generateContent(fullPrompt);
      return result.response.text();
    }, "generateResponse");

    log.info(`LLM response generated`, { responseLength: response.length, duration: Date.now() - start });
    return response;
  } catch (err: any) {
    log.error(`LLM generation failed after rotation`, {
      model: config.chatModel,
      duration: Date.now() - start,
      status: err?.status,
      message: err?.message,
    });
    throw new Error("Failed to generate AI response");
  }
}

export async function* generateResponseStream(
  systemPrompt: string,
  userMessage: string
): AsyncGenerator<string, void, unknown> {
  const start = Date.now();
  log.info(`Generating LLM stream`, { promptLength: systemPrompt.length, messageLength: userMessage.length });

  const streamResult = await withRotation(async (client) => {
    const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}`;
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
  } catch (err: any) {
    log.error(`LLM stream failed mid-way`, {
      model: config.chatModel,
      duration: Date.now() - start,
      status: err?.status,
      message: err?.message,
    });
    throw new Error("Failed to generate AI stream response");
  }
}

const translationCache = new Map<string, string>();
const TRANSLATION_CACHE_MAX = 500;

function isLikelyEnglish(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;

  const urduRegex = /[؀-ۿ]/;
  if (urduRegex.test(t)) return false;

  const romanUrduMarkers = /\b(hai|hain|hn|hyn|hein|he|h|kya|ky|kia|kaise|kaisa|kese|ksy|kaisay|kitne|kitna|kitny|kitni|kiutne|ktne|ktny|konsa|konse|konsi|kon|koun|q|kyun|kyo|kis|kisko|kiska|kiski|kiske|mera|meri|mere|aap|ap|tum|apka|apki|apke|apko|kar|karo|karna|kare|karein|kren|kr|kro|krna|nahi|nhi|nh|na|ma|mai|me|mein|men|m|sa|se|sy|ka|ki|ke|ko|k|pe|par|pr|tw|to|phr|phir|jab|jo|kaha|kahan|kha|khan|abhi|abh|bhi|bh|b|ho|hoga|hogi|honge|hoge|batao|bataiye|btayein|btao|bta|btado|dikhao|dekho|dekh|dena|de|do|dijye|hun|hu|hoon|liye|leye|lye|paani|thora|thoda|bohat|bht|zyada|zada|bilkul|acha|accha|thik|theek|thk|sahi|chal|chalo|sunno|suno|kuch|kch|sab|sabhi|har|koi|aur|ya|magar|lekin|lkn|agar|agr|jise|jisay|jisko|iske|iski|iska|isko|unka|unki|unke|unko|uska|uski|uske|usko|mujhe|mjhe|mjy|mujy|hume|humain|humein|sakta|sakte|sakti|skta|skte|skti|raha|rahe|rahi|rahay|hota|hote|hoti|hotay|wgera|waghera|shukriya|shukrya|wala|wali|wale|walay)\b/i;

  if (romanUrduMarkers.test(t)) return false;
  return true;
}

export async function translateForSearch(text: string): Promise<string> {
  if (isLikelyEnglish(text)) return text;

  const cached = translationCache.get(text);
  if (cached) {
    log.debug(`Translation cache hit`, { original: text.slice(0, 40) });
    return cached;
  }

  const start = Date.now();
  const prompt = `Translate the following user question (which may be in Roman Urdu, Urdu, or mixed language) into a clear, descriptive English search query suitable for semantic vector search in an Order Management System (OMS) knowledge base. Preserve important domain entities (e.g. sidebar, menus, dashboard, orders, shipments, load sheets, tracking, settings, picklist, etc.). Reply with ONLY the translated English search query, no explanation, no punctuation, no quotes.

User Question: ${text}

English Search Query:`;

  try {
    const translated = await withRotation(async (client) => {
      const result = await client.chatModel.generateContent(prompt);
      return result.response.text().trim().replace(/^["']|["']$/g, "");
    }, "translateForSearch");

    if (translationCache.size >= TRANSLATION_CACHE_MAX) {
      const firstKey = translationCache.keys().next().value;
      if (firstKey) translationCache.delete(firstKey);
    }
    translationCache.set(text, translated);

    log.info(`Query translated for search`, {
      original: text.slice(0, 60),
      translated: translated.slice(0, 60),
      duration: Date.now() - start,
    });
    return translated;
  } catch (err) {
    log.warn(`Translation failed, using original`, { text: text.slice(0, 40), error: err });
    return text;
  }
}

export function getKeyPoolStatus(): Array<{ index: number; masked: string; cooldownRemaining: number; failCount: number }> {
  const now = Date.now();
  return pool.map((k) => ({
    index: k.index,
    masked: maskKey(k.key),
    cooldownRemaining: Math.max(0, k.cooldownUntil - now),
    failCount: k.failCount,
  }));
}
