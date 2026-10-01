-- Migration 005: Create semantic cache similarity lookup function
-- Requirements: 5.1-5.6

CREATE OR REPLACE FUNCTION match_cache(
  query_embedding vector(768),
  p_course_id uuid,
  p_lecture_id uuid,
  similarity_threshold float DEFAULT 0.92,
  match_count int DEFAULT 1
)
RETURNS TABLE (
  id uuid,
  lecture_id uuid,
  course_id uuid,
  question_text text,
  question_embedding vector(768),
  answer_text text,
  created_at timestamptz,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT id, lecture_id, course_id, question_text, question_embedding, answer_text, created_at,
         1 - (question_embedding <=> query_embedding) AS similarity
  FROM semantic_cache
  WHERE course_id = p_course_id
    AND lecture_id = p_lecture_id
    AND 1 - (question_embedding <=> query_embedding) >= similarity_threshold
  ORDER BY question_embedding <=> query_embedding
  LIMIT match_count;
$$;
