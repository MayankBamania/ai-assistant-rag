import { supabaseClient } from '../db/supabase';
import { SemanticCacheEntry } from '../types';

/**
 * Look up a previously cached answer whose question embedding is within
 * `threshold` cosine similarity of the supplied embedding, scoped strictly
 * to the given course and lecture.
 *
 * Returns the best matching `SemanticCacheEntry` when a hit is found,
 * or `null` on a cache miss or any query error (Requirement 5.6 — errors
 * must not surface to the student; the caller proceeds to hybrid search).
 *
 * The Postgres function `match_cache` (migration 005) applies the
 * `course_id + lecture_id` filter internally, enforcing multi-tenant
 * isolation (Requirements 5.2, 5.5, 10.1).
 *
 * Satisfies Requirements 5.1–5.6.
 */
export async function findSimilarQuestion(
  embedding: number[],
  courseId: string,
  lectureId: string,
  threshold: number
): Promise<SemanticCacheEntry | null> {
  try {
    const { data, error } = await supabaseClient.rpc('match_cache', {
      query_embedding: embedding,
      p_course_id: courseId,
      p_lecture_id: lectureId,
      similarity_threshold: threshold,
      match_count: 1,
    });

    if (error) {
      console.error('Cache lookup error:', error.message);
      return null;
    }

    const results = (data ?? []) as SemanticCacheEntry[];
    return results.length > 0 ? results[0] : null;
  } catch (err) {
    console.error('Cache lookup exception:', err);
    return null;
  }
}

/**
 * Persist a new cache entry after a successful LLM answer, so that future
 * semantically similar questions can be answered without an LLM call.
 *
 * Throws if the Supabase insert fails so that the caller (ragQueryService)
 * can decide whether to surface the error.
 *
 * Satisfies Requirements 5.7, 7.7.
 */
export async function saveToCache(entry: {
  question_embedding: number[];
  answer_text: string;
  course_id: string;
  lecture_id: string;
  question_text: string;
}): Promise<void> {
  const { error } = await supabaseClient.from('semantic_cache').insert(entry);
  if (error) throw error;
}
