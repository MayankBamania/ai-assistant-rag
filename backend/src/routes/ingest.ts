import { Router } from 'express';
import { handleIngest } from '../controllers/ingestionController';

const router = Router();

// Mounted at /api/ingest in app.ts — this file handles POST /
router.post('/', handleIngest);

export default router;
