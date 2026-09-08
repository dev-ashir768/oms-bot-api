import type { Request, Response } from "express";
import {
  ensureUser,
  ensureSession,
  getRecentHistory,
  saveMessage,
  getFullHistory,
  getUserSessions,
  getUserName,
  updateSessionTitle,
  deleteSession,
  countSessionMessages,
  getSessionTitle,
} from "../services/db.service.js";
import { searchSimilar } from "../services/faiss.service.js";
import { generateResponse, generateResponseStream, generateEmbedding, translateForSearch } from "../services/gemini.service.js";
import { findCachedResponse, saveToCache, clearResponseCache } from "../services/cache.service.js";
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
    const time = m.created_at
      ? new Date(m.created_at).toLocaleString("en-PK", { timeZone: "Asia/Karachi" })
      : "";
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
    const created = new Date(s.created_at).toLocaleString("en-PK", { timeZone: "Asia/Karachi" });
    const updated = new Date(s.updated_at).toLocaleString("en-PK", { timeZone: "Asia/Karachi" });
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

function buildSystemPrompt(
  ragContext: string,
  historyText: string,
  resolvedName: string | null
): string {
  const defaultPrompt = `You are "${config.botName}", the official intelligent assistant for Orio OMS (Order Management System).

CORE RULES:
- Identity: Always say you are ${config.botName}. Never mention AI/Gemini/LLM/knowledge base/context/documents.
- Source of Truth: Use the Context below as your source of truth. If the exact answer isn't verbatim but related info exists, SYNTHESIZE a helpful, accurate answer.
- GREETING RULE:
  * NEVER say "Walaikum Assalam" or "Walaykumus Salam" UNLESS the user explicitly greeted you with "Salam", "Assalam o Alaikum", "AOa", or an Islamic greeting in their message.
  * If the user asked a question directly without greeting, or greeted with "Hi" / "Hello" / "Hey", do NOT say "Walaikum Assalam". Either get straight to the answer or use a matching friendly greeting (e.g. "Hello!", "Hi ${resolvedName || ""}!").
  * Never give unprompted or out-of-context greetings.
- STRICT Language Rule: Detect the language of the LATEST user question and reply in that EXACT SAME language:
  * If the user's latest question is in English -> You MUST reply 100% in English. Do NOT use Roman Urdu or Urdu phrases.
  * If the user's latest question is in Roman Urdu -> Reply in natural, polite Roman Urdu.
  * If the user's latest question is in Urdu script (اردو) -> Reply in Urdu script.
  * If the user switches languages from a previous message in chat history, ALWAYS follow the language of their LATEST message. Never let previous history language override the current question's language.
- Counts & Lists: When asked about counts, lists, menus, or options (e.g. sidebar menus, features, settings, steps), provide a complete, accurately counted, and clear numbered or bulleted list using all details from Context. Do NOT truncate, omit, or give partial lists.
- ONLY redirect to support (WhatsApp 0318-0268894, Email info@getorio.com, Phone 021-37293292, Website getorio.com) when the query is completely unrelated to what Context describes, or requires account-specific action.
- Never say "I don't have this info", "not in my knowledge", or similar. Either answer helpfully or redirect naturally.
- Tone: polite, professional, warm, and structured.${
    resolvedName ? `\n- User's name is "${resolvedName}" — address them naturally by name occasionally.` : ""
  }`;

  return `${config.systemPrompt || defaultPrompt}${
    ragContext ? `\n\nContext:\n${ragContext}` : ""
  }${historyText ? `\n\nHistory:\n${historyText}` : ""}`;
}

function safeSaveTurn(userId: string, sessionId: string, userMessage: string, modelReply: string): void {
  ensureUser(userId)
    .then(() => ensureSession(sessionId, userId))
    .then(() => saveMessage(sessionId, "user", userMessage))
    .then(() => saveMessage(sessionId, "model", modelReply))
    .catch((err) => {
      log.error(`Background turn save failed (non-blocking)`, { sessionId, error: err });
    });
}

function generateSmartTitle(message: string): string {
  const cleaned = message.trim().replace(/\s+/g, " ").replace(/[\n\r]/g, " ");
  const words = cleaned.split(" ");
  let title = words.slice(0, 7).join(" ");
  if (title.length > 50) title = title.substring(0, 47) + "...";
  else if (words.length > 7) title += "...";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

async function maybeUpdateTitleFromFirstMessage(
  userId: string,
  sessionId: string,
  message: string
): Promise<void> {
  try {
    const [msgCount, currentTitle] = await Promise.all([
      countSessionMessages(sessionId),
      getSessionTitle(sessionId),
    ]);

    if (msgCount === 0 && currentTitle && currentTitle.startsWith("New Chat ")) {
      const smartTitle = generateSmartTitle(message);
      await updateSessionTitle(sessionId, userId, smartTitle);
      log.info(`Session title auto-updated from first message`, { sessionId, userId, oldTitle: currentTitle, newTitle: smartTitle });
    }
  } catch (err) {
    log.warn(`Smart title update failed (non-blocking)`, { sessionId, error: err });
  }
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

  maybeUpdateTitleFromFirstMessage(userId, sessionId, message);

  try {
    // 1. TRACKING — bypass everything
    if (isTrackingQuery(message)) {
      const cn = extractConsignmentNumber(message)!;
      log.info(`Tracking query detected`, { cn, userId, sessionId });

      const reply = await trackConsignment(cn);

      safeSaveTurn(userId, sessionId, message, reply);

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

        safeSaveTurn(userId, sessionId, message, reply);

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

        safeSaveTurn(userId, sessionId, message, reply);

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
        safeSaveTurn(userId, sessionId, message, cached.response);

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
      const searchQuery = await translateForSearch(message);
      const results = await Promise.allSettled([
        getRecentHistory(sessionId),
        searchSimilar(searchQuery),
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

    const truncate = (text: string, max: number): string =>
      text.length > max ? text.substring(0, max) + "..." : text;

    const ragContext = ragResults.length
      ? ragResults.map((r) => truncate(r.text, config.ragChunkMaxChars)).join("\n---\n")
      : "";

    const historyText = history
      .map((m) => `${m.sender === "user" ? "U" : "A"}: ${truncate(m.content, config.historyMessageMaxChars)}`)
      .join("\n");

    const systemPrompt = buildSystemPrompt(ragContext, historyText, resolvedName);

    let reply: string;
    try {
      reply = await generateResponse(systemPrompt, message);
    } catch (err) {
      log.error(`AI generation failed, using fallback`, { error: err });
      reply = FALLBACK_RESPONSE;

      safeSaveTurn(userId, sessionId, message, reply);

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
    safeSaveTurn(userId, sessionId, message, reply);

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

export async function handleUpdateSession(
  req: Request<{ sessionId: string }>,
  res: Response
): Promise<void> {
  const { sessionId } = req.params;
  const { userId, title } = req.body;

  log.info(`Update session request`, { sessionId, userId, title, requestId: req.requestId });

  try {
    const updated = await updateSessionTitle(sessionId, userId, title.trim());
    if (!updated) {
      res.status(404).json({ error: "Session not found or does not belong to this user." });
      return;
    }
    res.json({ success: true, sessionId, userId, title: title.trim() });
  } catch (err) {
    log.error(`Update session failed`, { sessionId, userId, error: err });
    res.status(500).json({ error: "Failed to update session." });
  }
}

export async function handleDeleteSession(
  req: Request<{ sessionId: string }>,
  res: Response
): Promise<void> {
  const { sessionId } = req.params;
  const userId = (req.query.userId as string) || (req.body?.userId as string);

  log.info(`Delete session request`, { sessionId, userId, requestId: req.requestId });

  if (!userId) {
    res.status(400).json({ error: "userId is required (query or body)." });
    return;
  }

  try {
    const deleted = await deleteSession(sessionId, userId);
    if (!deleted) {
      res.status(404).json({ error: "Session not found or does not belong to this user." });
      return;
    }
    res.json({ success: true, sessionId, userId });
  } catch (err) {
    log.error(`Delete session failed`, { sessionId, userId, error: err });
    res.status(500).json({ error: "Failed to delete session." });
  }
}

function sseSend(res: Response, event: string, data: object): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function handleChatStream(req: Request, res: Response): Promise<void> {
  const { userId, sessionId, message, userName } = req.body;
  const start = Date.now();

  log.info(`Chat stream request`, { userId, sessionId, userName, messageLength: message.length, requestId: req.requestId });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let resolvedName: string | null = null;
  try {
    await ensureUser(userId, userName);
    await ensureSession(sessionId, userId);
    resolvedName = userName || (await getUserName(userId));
  } catch (err) {
    log.error(`Stream DB setup failed`, { error: err });
  }

  maybeUpdateTitleFromFirstMessage(userId, sessionId, message);

  sseSend(res, "meta", { userId, sessionId });

  try {
    // 1. TRACKING
    if (isTrackingQuery(message)) {
      const cn = extractConsignmentNumber(message)!;
      const reply = await trackConsignment(cn);

      sseSend(res, "chunk", { text: reply });
      sseSend(res, "done", { source: "tracking_api", consignmentNumber: cn, responseTime: Date.now() - start });

      safeSaveTurn(userId, sessionId, message, reply);
      res.end();
      return;
    }

    // 2. SESSION QUERY
    if (isSessionQuery(message)) {
      try {
        const sessions = await getUserSessions(userId);
        const reply = formatSessionsReply(sessions, resolvedName);

        sseSend(res, "chunk", { text: reply });
        sseSend(res, "done", { source: "sessions_db", responseTime: Date.now() - start });

        safeSaveTurn(userId, sessionId, message, reply);
        res.end();
        return;
      } catch (err) {
        log.warn(`Stream: sessions fetch failed, falling through`, { error: err });
      }
    }

    // 3. HISTORY QUERY
    if (isHistoryQuery(message)) {
      try {
        const messages = await getFullHistory(userId, sessionId);
        const reply = formatHistoryReply(messages, resolvedName);

        sseSend(res, "chunk", { text: reply });
        sseSend(res, "done", { source: "history_db", responseTime: Date.now() - start });

        safeSaveTurn(userId, sessionId, message, reply);
        res.end();
        return;
      } catch (err) {
        log.warn(`Stream: history fetch failed, falling through`, { error: err });
      }
    }

    // 4. CACHE
    let questionEmbedding: number[] | null = null;
    try {
      questionEmbedding = await generateEmbedding(message);
      const cached = await findCachedResponse(message, questionEmbedding);
      if (cached) {
        sseSend(res, "chunk", { text: cached.response });
        sseSend(res, "done", {
          source: "cache",
          similarity: parseFloat(cached.similarity.toFixed(4)),
          responseTime: Date.now() - start,
        });

        safeSaveTurn(userId, sessionId, message, cached.response);
        res.end();
        return;
      }
    } catch (err) {
      log.warn(`Stream: cache lookup failed`, { error: err });
    }

    // 5. RAG + AI STREAM
    let history: Awaited<ReturnType<typeof getRecentHistory>> = [];
    let ragResults: Awaited<ReturnType<typeof searchSimilar>> = [];

    const searchQuery = await translateForSearch(message);
    const results = await Promise.allSettled([getRecentHistory(sessionId), searchSimilar(searchQuery)]);
    if (results[0].status === "fulfilled") history = results[0].value;
    if (results[1].status === "fulfilled") ragResults = results[1].value;

    const truncate = (text: string, max: number): string =>
      text.length > max ? text.substring(0, max) + "..." : text;

    const ragContext = ragResults.length
      ? ragResults.map((r) => truncate(r.text, config.ragChunkMaxChars)).join("\n---\n")
      : "";
    const historyText = history
      .map((m) => `${m.sender === "user" ? "U" : "A"}: ${truncate(m.content, config.historyMessageMaxChars)}`)
      .join("\n");

    const systemPrompt = buildSystemPrompt(ragContext, historyText, resolvedName);

    let fullReply = "";
    try {
      for await (const chunk of generateResponseStream(systemPrompt, message)) {
        fullReply += chunk;
        sseSend(res, "chunk", { text: chunk });
      }
    } catch (err) {
      log.error(`Stream: AI generation failed`, { error: err });
      const fallback = FALLBACK_RESPONSE;
      sseSend(res, "chunk", { text: fallback });
      sseSend(res, "done", { source: "fallback", responseTime: Date.now() - start });

      safeSaveTurn(userId, sessionId, message, fallback);
      res.end();
      return;
    }

    sseSend(res, "done", { source: "ai", responseTime: Date.now() - start });

    safeSaveTurn(userId, sessionId, message, fullReply);

    if (questionEmbedding && fullReply) {
      saveToCache(message, questionEmbedding, fullReply).catch((err) => {
        log.error(`Stream cache save failed`, { error: err });
      });
    }

    log.info(`Stream response complete`, { source: "ai", replyLength: fullReply.length, duration: Date.now() - start });
    res.end();
  } catch (err) {
    log.error(`Stream unexpected error`, { userId, sessionId, error: err });
    sseSend(res, "chunk", { text: FALLBACK_RESPONSE });
    sseSend(res, "done", { source: "fallback", responseTime: Date.now() - start });
    res.end();
  }
}

export async function handleClearCache(
  req: Request,
  res: Response
): Promise<void> {
  const start = Date.now();
  log.info(`Clear response cache requested`, { ip: req.ip, requestId: req.requestId });

  try {
    const deletedCount = await clearResponseCache();
    res.json({
      message: "Response cache cleared successfully.",
      deletedCount,
      duration: Date.now() - start,
    });
  } catch (err) {
    log.error(`Clear cache failed`, { error: err });
    res.status(500).json({ error: "Failed to clear response cache." });
  }
}
