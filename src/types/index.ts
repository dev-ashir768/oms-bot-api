export interface ChatRequest {
  userId: string;
  sessionId: string;
  message: string;
  userName?: string;
}

export interface ChatResponse {
  reply: string;
  sessionId: string;
  userId: string;
}

export interface IngestTextRequest {
  documents: string[];
}

export interface IngestPdfRequest {
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface ChatMessage {
  sender: "user" | "model";
  content: string;
  created_at?: Date;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

export interface SearchResult {
  text: string;
  score: number;
}

export interface IngestResult {
  added: number;
  total: number;
}
