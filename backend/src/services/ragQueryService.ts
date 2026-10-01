import { Response } from 'express';
import { ChatGroq } from '@langchain/groq';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { embeddingService } from './embeddingService';
import * as cacheRepository from '../repositories/cacheRepository';
import * as chunkRepository from '../repositories/chunkRepository';
import * as lectureRepository from '../repositories/lectureRepository';
import { Citation, Chunk, QuerySSEPayload } from '../types';

const CACHE_SIMILARITY_THRESHOLD = 0.92;

/**
 * Sends a single SSE event to the client.
 */
function sendSSE(res: Response, payload: QuerySSEPayload): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Main RAG query handler â€” called by queryController after validation.
 * Streams the response via SSE.
 *
 * Phase 1 (task 7.1): Embed question + semantic cache lookup
 *   - Cache HIT  â†’ stream cached answer as tokens, send empty citations, send done
 *   - Cache MISS â†’ fall through to hybrid search (task 7.2)
 *   - Cache ERROR â†’ log and continue to hybrid search (Requirement 5.6)
 *
 * Phase 2 (task 7.2): Hybrid search + RRF
 * Phase 3 (task 7.4): LLM streaming + citations + cache save
 *
 * Satisfies Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6.
 */
export async function handleQuery(
  res: Response,
  courseId: string,
  lectureId: string,
  question: string
): Promise<void> {
  // Step 1: Embed the question (Requirement 5.1)
  const questionEmbedding = await embeddingService.embed(question);

  // Step 2: Check semantic cache
  // - Cosine threshold 0.92 (Requirement 5.2)
  // - Scoped to course_id + lecture_id (Requirements 5.5, 10.1)
  // - Returns null on miss OR on any query error â€” never throws (Requirement 5.6)
  const cacheHit = await cacheRepository.findSimilarQuestion(
    questionEmbedding,
    courseId,
    lectureId,
    CACHE_SIMILARITY_THRESHOLD
  );

  if (cacheHit) {
    // Cache HIT: stream cached answer as tokens without calling the LLM
    // (Requirement 5.3 â€” respond within 200ms without LLM call)
    // Stream word-by-word to simulate incremental token delivery
    const words = cacheHit.answer_text.split(' ');
    for (const word of words) {
      sendSSE(res, { type: 'token', content: word + ' ' });
    }
    // Send empty citations list (cache entries do not store citation metadata)
    sendSSE(res, { type: 'citations', items: [] });
    sendSSE(res, { type: 'done' });
    res.end();
    return;
  }

  // Cache MISS (Requirement 5.4) â€” execute hybrid search in parallel (Requirements 6.1, 6.2)
  const [vectorIds, ftsIds] = await Promise.all([
    chunkRepository.vectorSearch(questionEmbedding, courseId, lectureId, 10),
    chunkRepository.ftsSearch(question, courseId, lectureId, 10),
  ]);

  // Merge via Reciprocal Rank Fusion (Requirements 6.3, 6.4, 6.5)
  const rankedIds = reciprocalRankFusion(vectorIds, ftsIds);

  // Both branches returned zero results (Requirement 6.6) â€” no LLM call
  if (rankedIds.length === 0) {
    sendSSE(res, { type: 'token', content: 'This topic was not found in the lecture.' });
    sendSSE(res, { type: 'done' });
    res.end();
    return;
  }

  // Task 7.4 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Fetch full chunk rows (text + timestamps) for the ranked IDs
  const chunks = await chunkRepository.getChunksByIds(rankedIds);

  // Fetch lecture metadata to build deeplink URLs (Requirement 8.1)
  const lecture = await lectureRepository.getLectureById(lectureId);

  // Build prompt per design's LLM Prompt Structure (Requirement 7.1)
  // Original strict prompt (kept for reference):
  // const SYSTEM_PROMPT =
  //   'You are a course assistant. Answer the student\'s question using ONLY the ' +
  //   'transcript excerpts provided below. Keep your response to 2-4 sentences ' +
  //   'unless a step-by-step explanation is genuinely required. Never use ' +
  //   'information from your training data. If the excerpts do not contain the ' +
  //   'answer, respond with exactly: "This topic was not covered in this lecture."';

  const SYSTEM_PROMPT =
    'You are a course assistant. Use the transcript excerpts below to answer the student\'s question. ' +
    'If the excerpts cover the answer, use them. If the question is related to the topic of the excerpts ' +
    'but not fully covered, you may supplement with your knowledge. ' +
    'If the question is completely unrelated to the excerpts, respond with exactly: ' +
    '"This topic was not covered in this lecture." ' +
    'Be concise — 1-3 sentences max unless a step-by-step explanation is required.';

  const excerptLines = chunks
    .map(
      (c, i) =>
        `[Excerpt ${i + 1} â€” ${c.timestamp_start}s to ${c.timestamp_end}s]\n${c.text}`
    )
    .join('\n\n');

  const userContent = `Transcript excerpts:\n${excerptLines}\n\nStudent question: ${question}`;

  // Stream the LLM response, with fallback on 429/503 (Requirements 7.2, 7.3)
  await streamLLMResponse(
    res,
    SYSTEM_PROMPT,
    userContent,
    chunks,
    lecture.video_url,
    questionEmbedding,
    courseId,
    lectureId,
    question
  );
}

/**
 * Attempt to stream a response from `modelName`. Returns the full concatenated
 * answer on success, or throws on error. Emits `token` SSE events for each
 * streamed chunk while building up `fullAnswer`.
 *
 * We separate the streaming call so that the retry logic (429/503) can cleanly
 * switch models without duplicating the token-loop.
 */
async function tryStream(
  res: Response,
  modelName: string,
  systemPrompt: string,
  userContent: string,
  tokensSentSoFar: number
): Promise<{ fullAnswer: string; tokensSent: number }> {
  const groq = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: modelName,
    streaming: true,
  });

  const stream = await groq.stream([
    new SystemMessage(systemPrompt),
    new HumanMessage(userContent),
  ]);

  let fullAnswer = '';
  let tokensSent = tokensSentSoFar;

  for await (const chunk of stream) {
    const content =
      typeof chunk.content === 'string' ? chunk.content : '';
    if (content) {
      sendSSE(res, { type: 'token', content });
      fullAnswer += content;
      tokensSent++;
    }
  }

  return { fullAnswer, tokensSent };
}

/**
 * Orchestrates LLM streaming with fallback and error handling, then emits
 * citations, saves to cache, and closes the SSE stream.
 *
 * Satisfies Requirements 7.1â€“7.7, 8.1, 8.2, 8.5.
 */
async function streamLLMResponse(
  res: Response,
  systemPrompt: string,
  userContent: string,
  chunks: Chunk[],
  videoUrl: string,
  questionEmbedding: number[],
  courseId: string,
  lectureId: string,
  question: string
): Promise<void> {
  let fullAnswer = '';
  let tokensSent = 0;

  try {
    // Primary model: openai/gpt-oss-120b (Requirement 7.2)
    ({ fullAnswer, tokensSent } = await tryStream(
      res,
      'openai/gpt-oss-120b',
      systemPrompt,
      userContent,
      tokensSent
    ));
  } catch (primaryErr: unknown) {
    const primaryStatus = getErrorStatus(primaryErr);

    if (primaryStatus === 429 || primaryStatus === 503) {
      // Requirement 7.3: retry once with openai/gpt-oss-20b
      try {
        ({ fullAnswer, tokensSent } = await tryStream(
          res,
          'openai/gpt-oss-20b',
          systemPrompt,
          userContent,
          tokensSent
        ));
      } catch (fallbackErr: unknown) {
        const fallbackStatus = getErrorStatus(fallbackErr);
        sendSSE(res, {
          type: 'error',
          status: fallbackStatus ?? 503,
          message: getErrorMessage(fallbackErr),
        });
        res.end();
        return;
      }
    } else if (tokensSent > 0) {
      // Mid-stream error â€” partial response already sent (Requirement 7.6)
      sendSSE(res, { type: 'error', message: 'partial response' });
      res.end();
      return;
    } else {
      // Non-retriable 4xx or other error before any tokens were sent (Requirement 7.5)
      sendSSE(res, {
        type: 'error',
        status: primaryStatus ?? 500,
        message: getErrorMessage(primaryErr),
      });
      res.end();
      return;
    }
  }

  // Build citations from retrieved chunks (Requirements 8.1, 8.2, 8.5)
  // Only send citations if the LLM actually answered from the context.
  // If the LLM said the topic was not covered, citations would be misleading.
  const topicNotCovered = fullAnswer.trim().toLowerCase()
    .includes('not covered in this lecture');

  const citations: Citation[] = topicNotCovered
    ? []
    : chunks.slice(0, 10).map((c) => ({
        timestamp: c.timestamp_start,
        url: `${videoUrl}&t=${c.timestamp_start}s`,
      }));

  sendSSE(res, { type: 'citations', items: citations });
  sendSSE(res, { type: 'done' });

  // Persist to semantic cache (Requirement 7.7)
  try {
    await cacheRepository.saveToCache({
      question_embedding: questionEmbedding,
      answer_text: fullAnswer,
      course_id: courseId,
      lecture_id: lectureId,
      question_text: question,
    });
  } catch (cacheErr) {
    // Cache save failure must not surface to the student â€” just log it.
    console.error('Cache save error:', cacheErr);
  }

  res.end();
}

/** Extract an HTTP status code from an unknown error value, if present. */
function getErrorStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e['status'] === 'number') return e['status'];
    if (typeof e['statusCode'] === 'number') return e['statusCode'];
  }
  return undefined;
}

/** Extract a human-readable message from an unknown error value. */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e['message'] === 'string') return e['message'];
  }
  return 'An unexpected error occurred';
}

/**
 * Merge two ranked result lists using Reciprocal Rank Fusion.
 *
 * Each chunk ID receives a score of 1/(k + rank + 1) from each list it appears
 * in. The scores are summed and the top `topN` IDs returned in descending order.
 *
 * If one branch is empty its contribution is simply zero (Requirement 6.5).
 *
 * @param vector_results  Chunk IDs ranked by cosine similarity (most similar first)
 * @param fts_results     Chunk IDs ranked by BM25 ts_rank (highest rank first)
 * @param k               RRF constant (default 60, per design)
 * @param topN            Maximum results to return (default 10)
 * @returns Merged chunk IDs sorted by descending RRF score
 *
 * Satisfies Requirements 6.3, 6.4, 6.5.
 */
export function reciprocalRankFusion(
  vector_results: string[],
  fts_results: string[],
  k = 60,
  topN = 10
): string[] {
  const scores = new Map<string, number>();

  const accumulate = (ranked: string[]) => {
    ranked.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  };

  accumulate(vector_results);
  accumulate(fts_results);

  return [...scores.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([id]) => id);
}


