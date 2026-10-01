import { YoutubeTranscript } from 'youtube-transcript';
import * as lectureRepository from '../repositories/lectureRepository';
import * as chunkRepository from '../repositories/chunkRepository';
import { chunk as chunkTranscript } from './chunker';
import { embeddingService } from './embeddingService';
import { TranscriptSegment } from '../types';

// Custom error classes for typed error handling
export class InvalidYouTubeUrlError extends Error {
  readonly statusCode = 400;
  constructor(url: string) {
    super(`Invalid YouTube URL: "${url}". Supported formats: watch?v=, youtu.be/, /embed/`);
    this.name = 'InvalidYouTubeUrlError';
  }
}

export class NoCaptionsError extends Error {
  readonly statusCode = 422;
  constructor(videoId: string) {
    super(`No captions available for video: "${videoId}"`);
    this.name = 'NoCaptionsError';
  }
}

/**
 * Extracts the YouTube video ID from supported URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 *
 * Throws InvalidYouTubeUrlError if no format matches.
 *
 * Satisfies Requirements 2.1, 2.7.
 */
export function extractVideoId(url: string): string {
  // watch?v=
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];

  // youtu.be/
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];

  // /embed/
  const embedMatch = url.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];

  throw new InvalidYouTubeUrlError(url);
}

/**
 * Fetches captions for the given video ID and normalizes timestamps.
 * Throws NoCaptionsError if no captions are returned.
 *
 * Satisfies Requirements 2.3, 2.4, 2.8.
 */
export async function fetchAndNormalizeTranscript(videoId: string): Promise<TranscriptSegment[]> {
  const rawSegments = await YoutubeTranscript.fetchTranscript(videoId);

  if (!rawSegments || rawSegments.length === 0) {
    throw new NoCaptionsError(videoId);
  }

  return rawSegments.map(segment => ({
    text: segment.text,
    start: Math.floor(segment.offset / 1000), // ms â†’ whole seconds (Req 2.4)
  }));
}

/**
 * Orchestrates the full ingestion pipeline for a single lecture:
 *   1. Validate YouTube URL and extract video ID
 *   2. Set ingestion_status = 'processing' before any external API call
 *   3. Fetch and normalize the transcript
 *   4. Chunk the transcript
 *   5. Embed each chunk and upsert into the database
 *   6. Set ingestion_status = 'ready' on success
 *   7. Set ingestion_status = 'failed' on any error, then re-throw
 *
 * Satisfies Requirements 2.2, 2.5, 2.6, 4.6.
 */
export async function ingestLecture(
  courseId: string,
  lectureId: string,
  youtubeUrl: string
): Promise<void> {
  // Step 1: Validate URL â€” throws InvalidYouTubeUrlError (400) on invalid format.
  // This is a synchronous check; no DB state is set before it succeeds.
  let videoId: string;
  try {
    videoId = extractVideoId(youtubeUrl);
  } catch (err) {
    console.log('hii')
    // URL validation failed â€” mark as 'failed' and re-throw (Req 2.7)
    await lectureRepository.updateIngestionStatus(lectureId, 'failed');
    throw err;
  }

  // Step 2: Set status to 'processing' BEFORE any external API call (Req 2.2)
  await lectureRepository.updateIngestionStatus(lectureId, 'processing');

  try {
    // Step 3: Fetch and normalize transcript (throws NoCaptionsError on empty)
    const normalizedSegments = await fetchAndNormalizeTranscript(videoId);

    // Step 4: Chunk the transcript
    const chunks = chunkTranscript(normalizedSegments);
    console.log('chunks',chunks)

    // Step 5: Embed all chunks in a single batch API call, then upsert (Req 2.5, 4.6)
    // Batch embedding is far more efficient than one-by-one:
    // 60 chunks = 1 API call instead of 60, saving ~60x network round trips.
    const embeddings = await embeddingService.embedBatch(chunks.map(c => c.text));
    console.log('hohoho')
    for (let i = 0; i < chunks.length; i++) {
      await chunkRepository.upsertChunk({
        lecture_id: lectureId,
        course_id: courseId,
        text: chunks[i].text,
        embedding: embeddings[i],
        timestamp_start: chunks[i].timestamp_start,
        timestamp_end: chunks[i].timestamp_end,
      });
    }
    console.log('wywywywywy')

    // Step 6: Mark as ready (Req 2.6)
    await lectureRepository.updateIngestionStatus(lectureId, 'ready');
  } catch (err) {
    console.log('hey')
    // Step 7: Any error during ingestion â†’ mark as 'failed', then re-throw
    await lectureRepository.updateIngestionStatus(lectureId, 'failed');
    throw err;
  }
}


