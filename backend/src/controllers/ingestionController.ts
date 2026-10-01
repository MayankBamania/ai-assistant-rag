import { Request, Response } from 'express';
import { ingestLecture } from '../services/ingestionService';

/**
 * POST /api/ingest
 *
 * Validates the presence of courseId, lectureId, and youtubeUrl in the request
 * body, then kicks off the ingestion pipeline asynchronously. Returns 202
 * immediately so the caller can poll the lecture status endpoint.
 *
 * Satisfies Requirements 2.1–2.8.
 */
export function handleIngest(req: Request, res: Response): void {
  const { courseId, lectureId, youtubeUrl } = req.body as Record<string, unknown>;

  if (!courseId || typeof courseId !== 'string') {
    res.status(400).json({ error: 'Missing or invalid field: courseId' });
    return;
  }

  if (!lectureId || typeof lectureId !== 'string') {
    res.status(400).json({ error: 'Missing or invalid field: lectureId' });
    return;
  }

  if (!youtubeUrl || typeof youtubeUrl !== 'string') {
    res.status(400).json({ error: 'Missing or invalid field: youtubeUrl' });
    return;
  }

  // Fire-and-forget: ingestLecture handles its own error state by setting
  // lectures.ingestion_status to 'failed' on any failure.
  ingestLecture(courseId, lectureId, youtubeUrl).catch((err: unknown) => {
    console.error('[ingestionController] Background ingestion error:', err);
  });

  res.status(202).json({ lectureId, status: 'processing' });
}
