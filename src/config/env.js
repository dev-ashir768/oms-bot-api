import "dotenv/config";
const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
const apiKeys = rawKeys.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
const config = {
  port: parseInt(process.env.PORT || "8001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL,
  geminiApiKey: apiKeys[0] || "",
  geminiApiKeys: apiKeys,
  faissIndexDir: process.env.FAISS_INDEX_DIR || "./data/faiss_index",
  ragTopK: parseInt(process.env.RAG_TOP_K || "3", 10),
  chatHistoryLimit: parseInt(process.env.CHAT_HISTORY_LIMIT || "10", 10),
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
  chatModel: process.env.GEMINI_CHAT_MODEL || "gemini-3.6-flash",
  embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION || "768", 10),
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || "20", 10),
  uploadDir: process.env.UPLOAD_DIR || "./data/uploads",
  cacheSimilarityThreshold: parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD || "0.92"),
  trackingApiUrl: process.env.TRACKING_API_URL || "https://getorio.com/api/universal_tracking",
  botName: process.env.BOT_NAME || "OMS Assistant",
  systemPrompt: process.env.SYSTEM_PROMPT || "",
  apiKey: process.env.API_KEY || ""
};
const required = ["databaseUrl", "geminiApiKey"];
for (const key of required) {
  if (!config[key]) {
    throw new Error(`Missing required env var for config.${key}`);
  }
}
if (config.geminiApiKeys.length === 0) {
  throw new Error("At least one Gemini API key required (GEMINI_API_KEY or GEMINI_API_KEYS)");
}
export {
  config
};

//# sourceMappingURL=env.js.map
