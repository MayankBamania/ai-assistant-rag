import { Router } from 'express';
import { createCourse, listCourses } from '../controllers/courseController';

const router = Router();

// Mounted at /api/courses in app.ts
router.post('/', createCourse);
router.get('/', listCourses);

export default router;
