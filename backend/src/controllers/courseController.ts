import { Request, Response } from 'express';
import { insertCourse, getAllCourses } from '../repositories/courseRepository';

/**
 * POST /api/courses
 *
 * Validates that `title` is a non-empty string between 1 and 100 characters,
 * then creates a new course record and returns it with status 201.
 *
 * Satisfies Requirement 11.3.
 */
export async function createCourse(req: Request, res: Response): Promise<void> {
  const { title } = req.body as Record<string, unknown>;

  if (!title || typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 100) {
    res.status(400).json({ error: 'title must be a non-empty string between 1 and 100 characters' });
    return;
  }

  try {
    const course = await insertCourse(title.trim());
    res.status(201).json(course);
  } catch (err: unknown) {
    console.error('[courseController] createCourse error:', err);
    res.status(500).json({ error: 'Failed to create course' });
  }
}

/**
 * GET /api/courses
 *
 * Returns all courses as `{ courses: Course[] }`.
 *
 * Satisfies Requirement 11.1.
 */
export async function listCourses(_req: Request, res: Response): Promise<void> {
  try {
    const courses = await getAllCourses();
    res.status(200).json({ courses });
  } catch (err: unknown) {
    console.error('[courseController] listCourses error:', err);
    res.status(500).json({ error: 'Failed to retrieve courses' });
  }
}
