import { Request, Response } from 'express';
import { getLecturesByCourse } from '../repositories/lectureRepository';
import { handleQuery } from '../services/ragQueryService';

/**
 * GET /api/query?courseId=X&lectureId=Y&question=Z
 *
 * Validates the presence of courseId, lectureId, and question query params,
 * then verifies that the lectureId belongs to the specified courseId.
 * Returns 400 on any validation failure (Requirements 10.2, 10.3, 10.4).
 *
 * On success, delegates to ragQueryService which streams the SSE response.
 *
 * Satisfies Requirements 10.1, 10.2, 10.3, 10.4, 10.5.
 */
export async function handleQueryRequest(req: Request, res: Response): Promise<void> {
  const { courseId, lectureId, question } = req.query as Record<string, unknown>;

  // Validate courseId presence (Requirement 10.2)
  if (!courseId || typeof courseId !== 'string') {
    res.status(400).json({ error: 'Missing required query parameter: courseId' });
    return;
  }

  // Validate lectureId presence (Requirement 10.3)
  if (!lectureId || typeof lectureId !== 'string') {
    res.status(400).json({ error: 'Missing required query parameter: lectureId' });
    return;
  }

  // Validate question presence
  if (!question || typeof question !== 'string') {
    res.status(400).json({ error: 'Missing required query parameter: question' });
    return;
  }

  // Verify the lectureId belongs to the specified courseId (Requirement 10.4)
  let lectureIds: string[];
  try {
    const lectures = await getLecturesByCourse(courseId);
    lectureIds = lectures.map((l) => l.id);
  } catch (err) {
    console.error('[queryController] Failed to fetch lectures for course:', err);
    res.status(500).json({ error: 'Failed to validate lecture ownership' });
    return;
  }

  if (!lectureIds.includes(lectureId)) {
    res.status(400).json({ error: 'lectureId does not belong to the specified courseId' });
    return;
  }

  // All validation passed — delegate to the RAG query service (Requirements 10.1, 10.5)
  try {
    await handleQuery(res, courseId, lectureId, question);
  } catch (err) {
    console.error('[queryController] handleQuery error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.end();
    }
  }
}
