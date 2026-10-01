-- Migration 004: Create vector and full-text search RPC functions
-- These functions are called by chunkRepository.ts via supabaseClient.rpc().
-- Both functions apply course_id + lecture_id filters to enforce multi-tenant
-- isolation (Requirements 6.1, 6.2, 10.1-10.5).

-- ---------------------------------------------------------------------------
-- match_chunks: cosine-similarity vector search (Requirement 6.1)
-- Returns chunk IDs ordered by ascending cosine distance (most similar first).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(768),
  p_course_id uuid,
  p_lecture_id uuid,
  match_count int DEFAULT 10
)
RETURNS TABLE (id uuid, similarity float)
LANGUAGE sql STABLE
AS $$
  SELECT id, 1 - (embedding <=> query_embedding) AS similarity
  FROM chunks
  WHERE course_id = p_course_id AND lecture_id = p_lecture_id
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ---------------------------------------------------------------------------
-- search_chunks_fts: BM25 full-text search (Requirement 6.2)
-- Returns chunk IDs ordered by descending ts_rank (best match first).
-- Only rows whose fts_vector matches the query are returned.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_chunks_fts(
  query_text text,
  p_course_id uuid,
  p_lecture_id uuid,
  match_count int DEFAULT 10
)
RETURNS TABLE (id uuid, rank float)
LANGUAGE sql STABLE
AS $$
  SELECT id, ts_rank(fts_vector, to_tsquery('english', query_text)) AS rank
  FROM chunks
  WHERE course_id = p_course_id
    AND lecture_id = p_lecture_id
    AND fts_vector @@ to_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT match_count;
$$;
