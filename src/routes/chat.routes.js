import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { rateLimit } from "../middlewares/rate-limit.js";
import {
  handleChat,
  handleChatStream,
  handleHistory,
  handleSessions,
  handleUpdateSession,
  handleDeleteSession
} from "../controllers/chat.controller.js";
const router = Router();
const chatSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  sessionId: z.string().min(1, "sessionId is required"),
  message: z.string().min(1, "message is required"),
  userName: z.string().optional()
});
const chatRateLimit = rateLimit("chat", {
  windowMs: 60 * 1e3,
  max: 10,
  keyExtractor: (req) => req.body?.userId || req.ip || "unknown"
});
const updateSessionSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  title: z.string().min(1, "title is required").max(200, "title too long")
});
router.post("/", chatRateLimit, validate(chatSchema), handleChat);
router.post("/stream", chatRateLimit, validate(chatSchema), handleChatStream);
router.get("/history/:userId/:sessionId", handleHistory);
router.get("/sessions/:userId", handleSessions);
router.patch("/sessions/:sessionId", validate(updateSessionSchema), handleUpdateSession);
router.delete("/sessions/:sessionId", handleDeleteSession);
var chat_routes_default = router;
export {
  chat_routes_default as default
};

//# sourceMappingURL=chat.routes.js.map
