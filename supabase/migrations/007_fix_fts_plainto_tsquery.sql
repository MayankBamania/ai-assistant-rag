-- Migration 007: Fix FTS search function to use plainto_tsquery instead of to_tsquery
--
-- PROBLEM:
--   The original search_chunks_fts function used to_tsquery('english', query_text),
--   which requires the input to already be in tsquery syntax (e.g. "python & tutorial").
--   When a user asks a natural language question like "what is python?", the question
--   mark and plain sentence structure cause Postgres to throw:
--     ERROR 42601: syntax error in tsquery: "what is python?"
--
-- FIX:
--   Replace to_tsquery with plainto_tsquery, which accepts plain natural language input,
--   automatically strips punctuation, removes stop words (what, is, the, a, etc.),
--   and joins remaining terms with AND. No table or column changes required —
--   only the function definition is updated.
--
-- EXAMPLE:
--   plainto_tsquery('english', 'what is python?') → 'python'
--   plainto_tsquery('english', 'how do loops work') → 'loop' & 'work'

CREATE OR REPLACE FUNCTION search_chunks_fts(
  query_text text,
  p_course_id uuid,
  p_lecture_id uuid,
  match_count int DEFAULT 10
)
RETURNS TABLE (id uuid, rank float)
LANGUAGE sql STABLE
AS $$
  SELECT id, ts_rank(fts_vector, plainto_tsquery('english', query_text)) AS rank
  FROM chunks
  WHERE course_id = p_course_id
    AND lecture_id = p_lecture_id
    AND fts_vector @@ plainto_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT match_count;
$$;
