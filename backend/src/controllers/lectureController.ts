import { Request, Response } from 'express';
import * as lectureRepository from '../repositories/lectureRepository';
import { ingestLecture } from '../services/ingestionService';

/**
 * POST /api/courses/:courseId/lectures
 *
 * Validates title (1–100 chars) and youtubeUrl (non-empty string), creates a
 * lecture record with `ingestion_status = 'pending'`, then asynchronously kicks
 * off the ingestion pipeline. Returns the lecture record with status 201.
 *
 * Satisfies Requirements 11.7.
 */
export async function createLecture(req: Request, res: Response): Promise<void> {
  const courseId = req.params.courseId;
  const { title, youtubeUrl } = req.body as Record<string, unknown>;

  if (!title || typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 100) {
    res.status(400).json({ error: 'title must be a non-empty string between 1 and 100 characters' });
    return;
  }

  if (!youtubeUrl || typeof youtubeUrl !== 'string' || youtubeUrl.trim().length === 0) {
    res.status(400).json({ error: 'youtubeUrl must be a non-empty string' });
    return;
  }

  try {
    const lecture = await lectureRepository.insertLecture({
      course_id: courseId,
      title: title.trim(),
      video_type: 'youtube',
      video_url: youtubeUrl.trim(),
    });

    // Fire-and-forget: ingestLecture manages its own status transitions,
    // setting ingestion_status to 'processing', then 'ready' or 'failed'.
    ingestLecture(courseId, lecture.id, youtubeUrl.trim()).catch((err: unknown) => {
      console.error('[lectureController] Background ingestion error:', err);
    });

    res.status(201).json(lecture);
  } catch (err: unknown) {
    console.error('[lectureController] createLecture error:', err);
    res.status(500).json({ error: 'Failed to create lecture' });
  }
}

/**
 * GET /api/courses/:courseId/lectures
 *
 * Returns all lectures for the given course as `{ lectures: Lecture[] }`.
 *
 * Satisfies Requirement 11.5.
 */
export async function listLectures(req: Request, res: Response): Promise<void> {
  const courseId = req.params.courseId;

  try {
    const lectures = await lectureRepository.getLecturesByCourse(courseId);
    res.status(200).json({ lectures });
  } catch (err: unknown) {
    console.error('[lectureController] listLectures error:', err);
    res.status(500).json({ error: 'Failed to retrieve lectures' });
  }
}

/**
 * GET /api/courses/:courseId/lectures/:lectureId/status
 *
 * Returns the current ingestion status of the lecture as
 * `{ lectureId, ingestionStatus }`.
 *
 * Satisfies Requirement 11.8.
 */
export async function getLectureStatus(req: Request, res: Response): Promise<void> {
  const lectureId = req.params.lectureId;

  try {
    const ingestionStatus = await lectureRepository.getLectureStatus(lectureId);
    res.status(200).json({ lectureId, ingestionStatus });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
    } else {
      console.error('[lectureController] getLectureStatus error:', err);
      res.status(500).json({ error: 'Failed to retrieve lecture status' });
    }
  }
}
