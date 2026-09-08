import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { uploadPdf } from "../middlewares/upload.js";
import {
  handleIngestText,
  handleIngestPdf,
  handleIndexStats,
  handleResetIndex,
} from "../controllers/ingest.controller.js";

const router = Router();

const ingestTextSchema = z.object({
  documents: z
    .array(z.string().min(1, "Each document must be a non-empty string"))
    .min(1, "At least one document is required"),
});

router.post("/text", validate(ingestTextSchema), handleIngestText);
router.post("/pdf", uploadPdf, handleIngestPdf);
router.get("/stats", handleIndexStats);
router.delete("/reset", handleResetIndex);

export default router;
