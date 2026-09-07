import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("gemini");

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const embeddingModel = genAI.getGenerativeModel({
  model: config.embeddingModel,
});
const chatModel = genAI.getGenerativeModel({
  model: config.chatModel,
  generationConfig: {
    temperature: 0.4,
    maxOutputTokens: 1024,
    topP: 0.8,
  },
});

log.info(`Models configured`, { embedding: config.embeddingModel, chat: config.chatModel });

export async function generateEmbedding(text: string): Promise<number[]> {
  const start = Date.now();
  try {
    const result = await embeddingModel.embedContent(text);
    log.debug(`Embedding generated`, { chars: text.length, dimension: result.embedding.values.length, duration: Date.now() - start });
    return result.embedding.values;
  } catch (err: any) {
    log.error(`Embedding failed`, {
      chars: text.length,
      duration: Date.now() - start,
      status: err?.status,
      message: err?.message || err?.statusText,
      errorBody: err?.errorDetails || err?.response?.data,
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
    const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}`;
    const result = await chatModel.generateContent(fullPrompt);
    const response = result.response.text();

    log.info(`LLM response generated`, { responseLength: response.length, duration: Date.now() - start });
    return response;
  } catch (err: any) {
    log.error(`LLM generation failed`, {
      model: config.chatModel,
      duration: Date.now() - start,
      status: err?.status,
      message: err?.message,
    });
    throw new Error("Failed to generate AI response");
  }
}
