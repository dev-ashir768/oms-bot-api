import faiss from "faiss-node";
import fs from "fs";
import path from "path";
import { config } from "../config/env.js";
import { generateEmbedding, generateEmbeddings } from "./gemini.service.js";
import { createLogger } from "../utils/logger.js";
import type { SearchResult, IngestResult } from "../types/index.js";

const log = createLogger("faiss");
const { IndexFlatL2 } = faiss;

const INDEX_FILE = path.join(config.faissIndexDir, "index.faiss");
const DOCS_FILE = path.join(config.faissIndexDir, "documents.json");

let index: InstanceType<typeof IndexFlatL2> | null = null;
let documents: string[] = [];

function ensureDir(): void {
  fs.mkdirSync(config.faissIndexDir, { recursive: true });
}

export function loadIndex(): void {
  const start = Date.now();
  ensureDir();

  if (fs.existsSync(INDEX_FILE) && fs.existsSync(DOCS_FILE)) {
    index = IndexFlatL2.read(INDEX_FILE);
    documents = JSON.parse(fs.readFileSync(DOCS_FILE, "utf-8"));
    log.info(`Index loaded from disk`, { documents: documents.length, indexFile: INDEX_FILE, duration: Date.now() - start });
  } else {
    index = new IndexFlatL2(config.embeddingDimension);
    documents = [];
    log.info(`New empty index created`, { dimension: config.embeddingDimension });
  }
}

function saveIndex(): void {
  const start = Date.now();
  ensureDir();
  index!.write(INDEX_FILE);
  fs.writeFileSync(DOCS_FILE, JSON.stringify(documents));
  log.debug(`Index saved to disk`, { documents: documents.length, duration: Date.now() - start });
}

export async function ingestDocuments(chunks: string[]): Promise<IngestResult> {
  const start = Date.now();
  if (!index) loadIndex();

  log.info(`Ingesting ${chunks.length} chunks`);

  const embeddings = await generateEmbeddings(chunks);

  for (let i = 0; i < chunks.length; i++) {
    index!.add(embeddings[i]);
    documents.push(chunks[i]);
  }

  saveIndex();

  const result = { added: chunks.length, total: documents.length };
  log.info(`Ingestion complete`, { ...result, duration: Date.now() - start });
  return result;
}

export async function searchSimilar(
  query: string,
  k: number = config.ragTopK
): Promise<SearchResult[]> {
  const start = Date.now();

  if (!index || index.ntotal() === 0) {
    log.warn(`Search skipped: index is empty`);
    return [];
  }

  const queryEmbedding = await generateEmbedding(query);
  const effectiveK = Math.min(k, index.ntotal());
  const result = index.search(queryEmbedding, effectiveK);

  const results = result.labels
    .map((idx: number, i: number) => ({
      text: documents[idx],
      score: result.distances[i],
    }))
    .filter((r: SearchResult) => r.text !== undefined);

  log.info(`Search completed`, {
    query: query.slice(0, 80),
    k: effectiveK,
    resultsFound: results.length,
    topScore: results[0]?.score,
    duration: Date.now() - start,
  });

  return results;
}

export function getIndexStats(): { totalDocuments: number } {
  const total = index ? index.ntotal() : 0;
  log.debug(`Index stats requested`, { totalDocuments: total });
  return { totalDocuments: total };
}
