-- Migration 003: Create FTS trigger and all required indexes
-- Requirements: 1.7, 1.8, 1.9, 1.10, 1.11

-- Auto-populate fts_vector via trigger on INSERT or UPDATE
CREATE OR REPLACE FUNCTION chunks_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts_vector := to_tsvector('english', NEW.text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chunks_fts_trigger
  BEFORE INSERT OR UPDATE ON chunks
  FOR EACH ROW EXECUTE FUNCTION chunks_fts_update();

-- HNSW index on chunks.embedding for approximate nearest-neighbor vector search
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);

-- GIN index on chunks.fts_vector for full-text search
CREATE INDEX ON chunks USING GIN (fts_vector);

-- Btree index on chunks.course_id for metadata filtering
CREATE INDEX ON chunks (course_id);

-- HNSW index on semantic_cache.question_embedding for similarity lookups
CREATE INDEX ON semantic_cache USING hnsw (question_embedding vector_cosine_ops);
