-- Migration 002: Create chunks and semantic_cache tables
-- Requirements: 1.4, 1.5, 1.6, 1.12

-- Chunks table
-- Stores time-windowed transcript segments with embeddings and full-text search vectors.
-- course_id is denormalized to avoid JOINs on hot query paths.
CREATE TABLE chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  lecture_id      uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  course_id       uuid NOT NULL,
  text            text NOT NULL,
  embedding       vector(768) NOT NULL,
  fts_vector      tsvector NOT NULL,
  timestamp_start integer NOT NULL,
  timestamp_end   integer NOT NULL,
  CONSTRAINT chunks_timestamp_start_check CHECK (timestamp_start >= 0),
  CONSTRAINT chunks_timestamp_end_check   CHECK (timestamp_end >= timestamp_start)
);

-- Semantic Cache table
-- Stores previous question/answer pairs keyed by question embedding for fast cache hits.
-- course_id is denormalized to avoid JOINs and to enforce multi-tenant isolation efficiently.
CREATE TABLE semantic_cache (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  lecture_id         uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  course_id          uuid NOT NULL,
  question_text      text NOT NULL,
  question_embedding vector(768) NOT NULL,
  answer_text        text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT current_timestamp
);
