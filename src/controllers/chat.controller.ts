import type { Request, Response } from "express";
import {
  ensureUser,
  ensureSession,
  getRecentHistory,
  saveMessage,
  getFullHistory,
  getUserSessions,
  getUserName,
} from "../services/db.service.js";
import { searchSimilar } from "../services/faiss.service.js";
import { generateResponse, generateEmbedding } from "../services/gemini.service.js";
import { findCachedResponse, saveToCache } from "../services/cache.service.js";
import { isTrackingQuery, extractConsignmentNumber, trackConsignment } from "../services/tracking.service.js";
import { createLogger } from "../utils/logger.js";
import { config } from "../config/env.js";
import type { ChatMessage, ChatSession } from "../types/index.js";

const log = createLogger("chat");

const HISTORY_KEYWORDS = [
  "history", "chat history", "meri history", "purane messages", "pehle ki baat",
  "previous chat", "purani chat", "messages dikhao", "baat cheet", "conversation history",
  "pichli baat", "pichle messages", "previous messages", "show history", "meri baat cheet",
];

const SESSION_KEYWORDS = [
  "sessions", "mere sessions", "meri sessions", "previous sessions", "purani sessions",
  "kitni conversations", "conversations dikhao", "session list", "show sessions",
  "mere conversations", "meri conversations", "all sessions", "sab sessions",
];

function isHistoryQuery(message: string): boolean {
  const lower = message.toLowerCase().replace(/[?؟!.]/g, "").trim();
  return HISTORY_KEYWORDS.some((kw) => lower.includes(kw));
}

function isSessionQuery(message: string): boolean {
  const lower = message.toLowerCase().replace(/[?؟!.]/g, "").trim();
  return SESSION_KEYWORDS.some((kw) => lower.includes(kw));
}

function formatHistoryReply(messages: ChatMessage[], name: string | null): string {
  if (messages.length === 0) {
    return name
      ? `${name}, there is no conversation in this session yet. Feel free to ask me anything!`
      : `There is no conversation in this session yet. Feel free to ask me anything!`;
  }

  const header = name
    ? `${name}, here is your conversation from this session (${messages.length} messages):\n\n`
    : `Here is your conversation from this session (${messages.length} messages):\n\n`;

  const formatted = messages.map((m) => {
    const label = m.sender === "user" ? "🧑 You" : `🤖 ${config.botName}`;
    const time = m.created_at ? new Date(m.created_at).toLocaleString("en-PK") : "";
    const content = m.content.length > 200 ? m.content.substring(0, 200) + "..." : m.content;
    return `${label}${time ? ` (${time})` : ""}:\n${content}`;
  });

  return header + formatted.join("\n\n---\n\n");
}

function formatSessionsReply(sessions: ChatSession[], name: string | null): string {
  if (sessions.length === 0) {
    return name
      ? `${name}, you don't have any sessions yet. This is your first one!`
      : `You don't have any sessions yet. This is your first one!`;
  }

  const header = name
    ? `${name}, you have a total of ${sessions.length} session(s):\n\n`
    : `You have a total of ${sessions.length} session(s):\n\n`;

  const formatted = sessions.map((s, i) => {
    const created = new Date(s.created_at).toLocaleString("en-PK");
    const updated = new Date(s.updated_at).toLocaleString("en-PK");
    return `${i + 1}. **${s.title || s.id}**\n   - Started: ${created}\n   - Last active: ${updated}`;
  });

  return header + formatted.join("\n\n");
}

const FALLBACK_RESPONSE = `We're sorry, something went wrong on our end. Please try again in a moment.

If you need immediate assistance, feel free to reach out to our support team:
- WhatsApp: 0318-0268894
- Email: info@getorio.com
- Phone: 021-37293292
- Website: getorio.com`;

function safeSaveMessage(userId: string, sessionId: string, sender: "user" | "model", content: string): void {
  ensureUser(userId)
    .then(() => ensureSession(sessionId, userId))
    .then(() => saveMessage(sessionId, sender, content))
    .catch((err) => {
      log.error(`Background message save failed (non-blocking)`, { sessionId, sender, error: err });
    });
}

export async function handleChat(req: Request, res: Response): Promise<void> {
  const { userId, sessionId, message, userName } = req.body;
  const start = Date.now();

  log.info(`Chat request received`, { userId, sessionId, userName, messageLength: message.length, requestId: req.requestId });

  let resolvedName: string | null = null;
  try {
    await ensureUser(userId, userName);
    await ensureSession(sessionId, userId);
    resolvedName = userName || await getUserName(userId);
  } catch (err) {
    log.error(`DB user/session setup failed, continuing anyway`, { error: err });
  }

  try {
    // 1. TRACKING — bypass everything
    if (isTrackingQuery(message)) {
      const cn = extractConsignmentNumber(message)!;
      log.info(`Tracking query detected`, { cn, userId, sessionId });

      const reply = await trackConsignment(cn);

      safeSaveMessage(userId, sessionId, "user", message);
      safeSaveMessage(userId, sessionId, "model", reply);

      log.info(`Tracking response sent`, { cn, source: "tracking_api", duration: Date.now() - start });

      res.json({
        reply,
        sessionId,
        userId,
        source: "tracking_api",
        consignmentNumber: cn,
        responseTime: Date.now() - start,
      });
      return;
    }

    // 2. HISTORY/SESSION — user asking about their data
    if (isSessionQuery(message)) {
      log.info(`Session query detected`, { userId, sessionId });

      try {
        const sessions = await getUserSessions(userId);
        const reply = formatSessionsReply(sessions, resolvedName);

        safeSaveMessage(userId, sessionId, "user", message);
        safeSaveMessage(userId, sessionId, "model", reply);

        log.info(`Sessions response sent`, { source: "sessions_db", sessionCount: sessions.length, duration: Date.now() - start });

        res.json({ reply, sessionId, userId, source: "sessions_db", responseTime: Date.now() - start });
        return;
      } catch (err) {
        log.warn(`Sessions fetch failed, falling through to AI`, { error: err });
      }
    }

    if (isHistoryQuery(message)) {
      log.info(`History query detected`, { userId, sessionId });

      try {
        const messages = await getFullHistory(userId, sessionId);
        const reply = formatHistoryReply(messages, resolvedName);

        safeSaveMessage(userId, sessionId, "user", message);
        safeSaveMessage(userId, sessionId, "model", reply);

        log.info(`History response sent`, { source: "history_db", messageCount: messages.length, duration: Date.now() - start });

        res.json({ reply, sessionId, userId, source: "history_db", responseTime: Date.now() - start });
        return;
      } catch (err) {
        log.warn(`History fetch failed, falling through to AI`, { error: err });
      }
    }

    // 3. CACHE — try cache lookup
    let questionEmbedding: number[] | null = null;
    try {
      questionEmbedding = await generateEmbedding(message);

      const cached = await findCachedResponse(message, questionEmbedding);
      if (cached) {
        safeSaveMessage(userId, sessionId, "user", message);
        safeSaveMessage(userId, sessionId, "model", cached.response);

        log.info(`Serving cached response`, {
          similarity: cached.similarity.toFixed(4),
          source: "cache",
          duration: Date.now() - start,
        });

        res.json({
          reply: cached.response,
          sessionId,
          userId,
          source: "cache",
          similarity: parseFloat(cached.similarity.toFixed(4)),
          responseTime: Date.now() - start,
        });
        return;
      }
    } catch (err) {
      log.warn(`Cache/embedding lookup failed, falling through to AI`, { error: err });
    }

    // 4. RAG + AI — full pipeline
    let history: Awaited<ReturnType<typeof getRecentHistory>> = [];
    let ragResults: Awaited<ReturnType<typeof searchSimilar>> = [];

    try {
      const results = await Promise.allSettled([
        getRecentHistory(sessionId),
        searchSimilar(message),
      ]);

      if (results[0].status === "fulfilled") history = results[0].value;
      if (results[1].status === "fulfilled") ragResults = results[1].value;
    } catch (err) {
      log.warn(`Context gathering partially failed`, { error: err });
    }

    log.debug(`Context gathered`, {
      historyMessages: history.length,
      ragChunks: ragResults.length,
      topRagScore: ragResults[0]?.score,
    });

    const ragContext = ragResults.length
      ? ragResults.map((r) => r.text).join("\n\n---\n\n")
      : "";

    const historyText = history
      .map((m) => `${m.sender === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const defaultPrompt = `You are "${config.botName}", a specialized assistant that ONLY answers questions based on the provided knowledge base context.

## STRICT RULES:

### Identity
1. You are "${config.botName}". When asked about your name or identity, always say: "I am ${config.botName}".
2. NEVER say you are Gemini, Google AI, or any other AI model. NEVER reveal your underlying technology.
3. NEVER mention "knowledge base", "context", "documents", "database", "retrieved context", "training data", or any internal system details. You must behave like a fully trained, real company assistant who naturally knows things — not a bot reading from documents.

### Knowledge Base Only
4. ONLY answer questions using the "Retrieved Context" below. Do NOT use your general knowledge.
5. If the context does not contain the answer, NEVER mention "knowledge base", "context", "documents", or "database". Instead, naturally and politely redirect the user to our support team as if you are a real human representative. Make it feel seamless — like you are handing them off to a colleague who can help better.
   - Website: https://getorio.com
   - Email: info@getorio.com
   - Phone: 021-37293292
   - WhatsApp: 0318-0268894
   Example responses:
   - "Is sawaal ke liye hamari support team aap ki behtareen madad kar sakti hai. Aap unse rabta kar saktay hain: WhatsApp: 0318-0268894, Email: info@getorio.com ya call karein: 021-37293292"
   - "For this, our support team will be able to assist you right away. You can reach them at info@getorio.com or WhatsApp 0318-0268894"
   NEVER say things like "mere paas ye information nahi hai" or "my knowledge base doesn't have this". Just smoothly guide them to support.
6. Always base your answers strictly on the retrieved context — do not make up or assume information.

### Tone & Style
7. Always be polite, professional, and friendly. Use a warm and helpful tone.
8. Use courteous language — say "please", "thank you", "I'd be happy to help", etc.
9. If the user greets you, greet them back warmly and introduce yourself as ${config.botName}.${resolvedName ? `
10. The user's name is "${resolvedName}". Address them by their name naturally in conversation — e.g. "Ji ${resolvedName}, ...", "${resolvedName} sahab/bhai, ...", "Sure ${resolvedName}, ...". Use their name occasionally, not in every single sentence. Be natural about it.` : ""}

### Language
10. ALWAYS reply in the SAME language the user is writing in. If they write in Urdu, reply in Urdu. If English, reply in English. If Roman Urdu, reply in Roman Urdu. Match their language exactly.
11. If the user switches language mid-conversation, switch with them.

### Formatting
12. Keep answers concise, clear, and relevant.
13. Use bullet points or numbered lists where appropriate for readability.
14. Break long answers into short paragraphs.

### Speed
15. Keep responses SHORT and to the point. Maximum 2-3 short paragraphs.
16. Do NOT over-explain. Answer directly, then stop.
17. Avoid unnecessary filler words and repetition.`;

    const systemPrompt = `${config.systemPrompt || defaultPrompt}

### Retrieved Context:
${ragContext}

### Conversation History:
${historyText}`;

    let reply: string;
    try {
      reply = await generateResponse(systemPrompt, message);
    } catch (err) {
      log.error(`AI generation failed, using fallback`, { error: err });
      reply = FALLBACK_RESPONSE;

      safeSaveMessage(userId, sessionId, "user", message);
      safeSaveMessage(userId, sessionId, "model", reply);

      res.json({
        reply,
        sessionId,
        userId,
        source: "fallback",
        responseTime: Date.now() - start,
      });
      return;
    }

    // Save messages + cache (fire-and-forget, never block response)
    safeSaveMessage(userId, sessionId, "user", message);
    safeSaveMessage(userId, sessionId, "model", reply);

    if (questionEmbedding) {
      saveToCache(message, questionEmbedding, reply).catch((err) => {
        log.error(`Cache save failed (non-blocking)`, { error: err });
      });
    }

    log.info(`Chat response sent`, {
      source: "ai",
      replyLength: reply.length,
      duration: Date.now() - start,
    });

    res.json({
      reply,
      sessionId,
      userId,
      source: "ai",
      responseTime: Date.now() - start,
    });
  } catch (err) {
    log.error(`Unexpected chat error, sending fallback`, { userId, sessionId, duration: Date.now() - start, error: err });

    res.json({
      reply: FALLBACK_RESPONSE,
      sessionId,
      userId,
      source: "fallback",
      responseTime: Date.now() - start,
    });
  }
}

export async function handleHistory(
  req: Request<{ userId: string; sessionId: string }>,
  res: Response
): Promise<void> {
  const { userId, sessionId } = req.params;
  log.info(`History request`, { userId, sessionId, requestId: req.requestId });

  try {
    const messages = await getFullHistory(userId, sessionId);
    log.info(`History returned`, { userId, sessionId, messageCount: messages.length });
    res.json({ messages, sessionId, userId });
  } catch (err) {
    log.error(`History request failed`, { userId, sessionId, error: err });
    res.status(500).json({ error: "Failed to fetch chat history." });
  }
}

export async function handleSessions(
  req: Request<{ userId: string }>,
  res: Response
): Promise<void> {
  const { userId } = req.params;
  log.info(`Sessions request`, { userId, requestId: req.requestId });

  try {
    const sessions = await getUserSessions(userId);
    log.info(`Sessions returned`, { userId, sessionCount: sessions.length });
    res.json({ sessions, userId });
  } catch (err) {
    log.error(`Sessions request failed`, { userId, error: err });
    res.status(500).json({ error: "Failed to fetch sessions." });
  }
}
