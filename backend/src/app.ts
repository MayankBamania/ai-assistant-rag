import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import ingestRouter from './routes/ingest';
import queryRouter from './routes/query';
import coursesRouter from './routes/courses';
import lecturesRouter from './routes/lectures';

const app = express();

// CORS for Angular development server
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:4200' }));
app.use(express.json());

// Mount routes
app.use('/api/ingest', ingestRouter);
app.use('/api/query', queryRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/courses/:courseId/lectures', lecturesRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
