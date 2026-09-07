import type { Request, Response } from "express";
import { ingestDocuments, getIndexStats } from "../services/faiss.service.js";
import { logIngestedDocument } from "../services/db.service.js";
import { extractTextFromPdf } from "../utils/pdf-parser.js";
import { chunkText } from "../utils/chunker.js";
import { createLogger } from "../utils/logger.js";
import fs from "fs";

const log = createLogger("ingest");

export async function handleIngestText(
  req: Request,
  res: Response
): Promise<void> {
  const { documents } = req.body;
  const start = Date.now();

  log.info(`Text ingest started`, { documentCount: documents.length, requestId: req.requestId });

  try {
    const result = await ingestDocuments(documents);
    await logIngestedDocument("text-input", result.added);

    log.info(`Text ingest complete`, { ...result, duration: Date.now() - start, requestId: req.requestId });
    res.json({ message: "Documents ingested successfully.", ...result });
  } catch (err) {
    log.error(`Text ingest failed`, { documentCount: documents.length, duration: Date.now() - start, error: err });
    res.status(500).json({ error: "Failed to ingest documents." });
  }
}

export async function handleIngestPdf(
  req: Request,
  res: Response
): Promise<void> {
  const start = Date.now();

  if (!req.file) {
    log.warn(`PDF ingest called without file`, { requestId: req.requestId });
    res.status(400).json({ error: "No PDF file uploaded." });
    return;
  }

  const { originalname, path: filePath, size } = req.file;
  const chunkSize = parseInt((req.body.chunkSize as string) || "1000", 10);
  const chunkOverlap = parseInt((req.body.chunkOverlap as string) || "200", 10);

  log.info(`PDF ingest started`, {
    filename: originalname,
    fileSize: `${(size / 1024).toFixed(1)}KB`,
    chunkSize,
    chunkOverlap,
    requestId: req.requestId,
  });

  try {
    const extractStart = Date.now();
    const text = await extractTextFromPdf(filePath);
    log.debug(`PDF text extracted`, { filename: originalname, chars: text.length, duration: Date.now() - extractStart });

    if (!text || text.trim().length === 0) {
      log.warn(`PDF has no extractable text`, { filename: originalname });
      res.status(400).json({ error: "Could not extract text from PDF." });
      return;
    }

    const chunks = chunkText(text, chunkSize, chunkOverlap);
    log.info(`PDF chunked`, { filename: originalname, chunks: chunks.length, avgChunkSize: Math.round(text.length / chunks.length) });

    const result = await ingestDocuments(chunks);
    await logIngestedDocument(originalname, result.added);

    fs.unlinkSync(filePath);
    log.debug(`Temp file cleaned up`, { filePath });

    log.info(`PDF ingest complete`, {
      filename: originalname,
      chunksCreated: chunks.length,
      totalInIndex: result.total,
      duration: Date.now() - start,
      requestId: req.requestId,
    });

    res.json({
      message: "PDF ingested successfully.",
      filename: originalname,
      chunksCreated: chunks.length,
      ...result,
    });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      log.debug(`Temp file cleaned up after error`);
    }
    log.error(`PDF ingest failed`, { filename: originalname, duration: Date.now() - start, error: err });
    res.status(500).json({ error: "Failed to ingest PDF." });
  }
}

export async function handleIndexStats(
  req: Request,
  res: Response
): Promise<void> {
  log.debug(`Index stats requested`, { requestId: req.requestId });
  const stats = getIndexStats();
  res.json(stats);
}
