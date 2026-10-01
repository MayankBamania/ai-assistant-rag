import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// Maximum texts per batch call — Gemini batch API limit
const BATCH_SIZE = 100;

class EmbeddingServiceImpl implements EmbeddingService {
  private readonly model: GoogleGenerativeAIEmbeddings;
  private readonly maxAttempts = 3;
  private readonly baseDelayMs = 1000;
  private readonly maxDelayMs = 8000;

  constructor() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ERROR: GOOGLE_API_KEY environment variable is not set. ' +
        'Get a free key at https://aistudio.google.com/app/apikey'
      );
    }

    this.model = new GoogleGenerativeAIEmbeddings({
      apiKey,
      model: 'gemini-embedding-001',
      outputDimensionality: 768, // truncate to 768-dim to match DB vector column
    });
  }

  // Single text — used for query embedding at search time
  async embed(text: string): Promise<number[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        return await this.model.embedQuery(text);
      } catch (err) {
        lastError = err;
        if (attempt < this.maxAttempts - 1) {
          const delay = Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  // Batch of texts — used during ingestion to embed all chunks in one API call.
  // Uses embedDocuments() which calls batchEmbedContents() under the hood,
  // sending all texts in a single HTTP request instead of one per chunk.
  // Splits into pages of BATCH_SIZE to stay within API limits.
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const page = texts.slice(i, i + BATCH_SIZE);
      let lastError: unknown;

      for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
        try {
          const embeddings = await this.model.embedDocuments(page);
          results.push(...embeddings);
          break;
        } catch (err) {
          lastError = err;
          if (attempt < this.maxAttempts - 1) {
            const delay = Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (results.length <= i) {
        // All retries exhausted for this page
        throw lastError;
      }
    }

    return results;
  }
}

// Single shared instance — used by both ingestionService and ragQueryService
export const embeddingService: EmbeddingService = new EmbeddingServiceImpl();
