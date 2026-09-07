import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import {
  handleChat,
  handleHistory,
  handleSessions,
} from "../controllers/chat.controller.js";

const router = Router();

const chatSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  sessionId: z.string().min(1, "sessionId is required"),
  message: z.string().min(1, "message is required"),
  userName: z.string().optional(),
});

router.post("/", validate(chatSchema), handleChat);
router.get("/history/:userId/:sessionId", handleHistory);
router.get("/sessions/:userId", handleSessions);

export default router;
