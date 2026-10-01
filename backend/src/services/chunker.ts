import { TranscriptSegment } from '../types';

const WINDOW = 75; // seconds
const STEP = 60;   // seconds (= WINDOW - OVERLAP)

export interface ChunkerOutputChunk {
  text: string;
  timestamp_start: number; // seconds
  timestamp_end: number;   // seconds
}

/**
 * Splits a normalized transcript into time-windowed chunks with 15-second overlap.
 *
 * Algorithm:
 *   - Window = 75s, overlap = 15s, step = 60s
 *   - Chunk N covers segments where start >= N*60 && start < N*60 + 75
 *   - timestamp_start of chunk N = N * 60
 *   - timestamp_end of intermediate chunks = windowStart + 75
 *     (ensures consecutive pair invariant: chunk[N+1].timestamp_start === chunk[N].timestamp_end - 15)
 *   - timestamp_end of the final chunk = Math.ceil(lastSegment.start)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */
export function chunk(segments: TranscriptSegment[]): ChunkerOutputChunk[] {
  // Requirement 3.7: empty input → return []
  if (segments.length === 0) {
    return [];
  }

  const chunks: ChunkerOutputChunk[] = [];
  let windowIndex = 0;

  while (true) {
    const windowStart = windowIndex * STEP; // N * 60
    const windowEnd = windowStart + WINDOW; // windowStart + 75

    // Collect segments whose start falls within [windowStart, windowEnd)
    const windowSegments = segments.filter(
      (s) => s.start >= windowStart && s.start < windowEnd
    );

    // Stop when this window and all future windows have no segments
    // (no segment can have start >= windowStart)
    const remainingSegments = segments.filter((s) => s.start >= windowStart);
    if (remainingSegments.length === 0) {
      break;
    }

    if (windowSegments.length > 0) {
      const lastSegmentInWindow = windowSegments[windowSegments.length - 1];

      // Determine if this is the last chunk:
      // a chunk is the last if no segments exist at or beyond the next window start
      const nextWindowStart = (windowIndex + 1) * STEP;
      const hasMoreSegments = segments.some((s) => s.start >= nextWindowStart);

      const timestampEnd = hasMoreSegments
        ? windowEnd // intermediate chunk: windowStart + 75
        : Math.ceil(lastSegmentInWindow.start); // final chunk: ceil of last segment start

      chunks.push({
        text: windowSegments.map((s) => s.text).join(' '),
        timestamp_start: windowStart,
        timestamp_end: timestampEnd,
      });
    }

    windowIndex++;
  }

  return chunks;
}
