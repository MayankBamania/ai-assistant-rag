import { NextFunction, Request, Response, Router } from 'express';
import { handleQueryRequest } from '../controllers/queryController';

const router = Router();

/**
 * Middleware that sets the required SSE response headers before passing
 * control to the query controller. No business logic lives here.
 *
 * Headers:
 *   Content-Type: text/event-stream  — signals SSE to the client
 *   Cache-Control: no-cache          — prevents intermediaries from buffering
 *   Connection: keep-alive           — keeps the TCP connection open
 *   X-Accel-Buffering: no            — disables Nginx proxy buffering
 */
function sseHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  next();
}

// Mounted at /api/query in app.ts
router.get('/', sseHeaders, handleQueryRequest);

export default router;
