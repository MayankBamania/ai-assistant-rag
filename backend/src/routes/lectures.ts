import { Router } from 'express';
import { createLecture, listLectures, getLectureStatus } from '../controllers/lectureController';

// mergeParams: true is required so that :courseId from the parent router
// (courses.ts or app.ts) is available in req.params inside the controllers.
const router = Router({ mergeParams: true });

// Mounted at /api/courses/:courseId/lectures in app.ts
router.post('/', createLecture);
router.get('/', listLectures);
router.get('/:lectureId/status', getLectureStatus);

export default router;
