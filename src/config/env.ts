import "dotenv/config";

const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
const apiKeys = rawKeys
  .split(",")
  .map((k) => k.trim())
  .filter((k) => k.length > 0);

export const config = {
  port: parseInt(process.env.PORT || "8001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL!,
  geminiApiKey: apiKeys[0] || "",
  geminiApiKeys: apiKeys,
  faissIndexDir: process.env.FAISS_INDEX_DIR || "./data/faiss_index",
  ragTopK: parseInt(process.env.RAG_TOP_K || "2", 10),
  chatHistoryLimit: parseInt(process.env.CHAT_HISTORY_LIMIT || "4", 10),
  historyMessageMaxChars: parseInt(process.env.HISTORY_MESSAGE_MAX_CHARS || "300", 10),
  ragChunkMaxChars: parseInt(process.env.RAG_CHUNK_MAX_CHARS || "500", 10),
  maxOutputTokens: parseInt(process.env.MAX_OUTPUT_TOKENS || "512", 10),
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
  chatModel: process.env.GEMINI_CHAT_MODEL || "gemini-1.5-flash-8b",
  embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION || "768", 10),
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || "20", 10),
  uploadDir: process.env.UPLOAD_DIR || "./data/uploads",
  cacheSimilarityThreshold: parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD || "0.88"),
  trackingApiUrl: process.env.TRACKING_API_URL || "https://getorio.com/api/universal_tracking",
  botName: process.env.BOT_NAME || "OMS Assistant",
  systemPrompt: process.env.SYSTEM_PROMPT || "",
  apiKey: process.env.API_KEY || "",
} as const;

const required = ["databaseUrl", "geminiApiKey"] as const;
for (const key of required) {
  if (!config[key]) {
    throw new Error(`Missing required env var for config.${key}`);
  }
}

if (config.geminiApiKeys.length === 0) {
  throw new Error("At least one Gemini API key required (GEMINI_API_KEY or GEMINI_API_KEYS)");
}
