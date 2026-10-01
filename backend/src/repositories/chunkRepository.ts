import { supabaseClient } from '../db/supabase';
import { Chunk } from '../types';

/**
 * Row shape sent to Supabase on insert/upsert.
 * `fts_vector` is intentionally omitted — it is auto-populated by the
 * `chunks_fts_trigger` database trigger (Requirement 1.7).
 */
type ChunkInsert = Omit<Chunk, 'id'>;

/**
 * Insert a single chunk row into the `chunks` table.
 *
 * The `fts_vector` column is populated automatically by the database trigger,
 * so it must not be included in the insert payload.
 *
 * Satisfies Requirements 2.5, 4.1-4.4, 10.1.
 */
export async function insertChunk(chunk: ChunkInsert): Promise<void> {
  const { error } = await supabaseClient.from('chunks').insert({
    lecture_id: chunk.lecture_id,
    course_id: chunk.course_id,
    text: chunk.text,
    embedding: JSON.stringify(chunk.embedding),
    timestamp_start: chunk.timestamp_start,
    timestamp_end: chunk.timestamp_end,
  });

  if (error) throw error;
}

/**
 * Upsert a chunk row, overwriting the embedding and fts_vector for an
 * existing chunk identified by (lecture_id, timestamp_start).
 *
 * Used during re-ingestion to regenerate embeddings without creating
 * duplicate rows. The fts_vector is re-populated by the trigger on update.
 *
 * Satisfies Requirement 4.6.
 */
export async function upsertChunk(chunk: ChunkInsert): Promise<void> {
  const { error } = await supabaseClient
    .from('chunks')
    .upsert(
      {
        lecture_id: chunk.lecture_id,
        course_id: chunk.course_id,
        text: chunk.text,
        embedding: JSON.stringify(chunk.embedding),
        timestamp_start: chunk.timestamp_start,
        timestamp_end: chunk.timestamp_end,
      },
      { onConflict: 'lecture_id,timestamp_start' }
    );

  if (error) {
    console.log('error',error)
    throw error};
}

/**
 * Perform a pgvector cosine-similarity search against `chunks.embedding`,
 * scoped to the given course and lecture, returning chunk IDs in rank order
 * (most similar first).
 *
 * Calls the Postgres function `match_chunks` defined in migration 004.
 * Filters are applied inside the SQL function to enforce multi-tenant
 * isolation (Requirements 6.1, 10.1–10.5).
 *
 * @param embedding  768-dim query embedding
 * @param courseId   Scope filter — must match `chunks.course_id`
 * @param lectureId  Scope filter — must match `chunks.lecture_id`
 * @param topN       Maximum number of results to return
 * @returns Array of chunk IDs ordered by descending cosine similarity
 */
export async function vectorSearch(
  embedding: number[],
  courseId: string,
  lectureId: string,
  topN: number
): Promise<string[]> {
  const { data, error } = await supabaseClient.rpc('match_chunks', {
    query_embedding: embedding,
    p_course_id: courseId,
    p_lecture_id: lectureId,
    match_count: topN,
  });

  if (error) throw error;
  return ((data ?? []) as { id: string; similarity: number }[]).map(
    (row) => row.id
  );
}

/**
 * Perform a tsvector BM25 full-text search against `chunks.fts_vector`,
 * scoped to the given course and lecture, returning chunk IDs in rank order
 * (highest ts_rank first).
 *
 * Calls the Postgres function `search_chunks_fts` defined in migration 004.
 * Filters are applied inside the SQL function to enforce multi-tenant
 * isolation (Requirements 6.2, 10.1–10.5).
 *
 * @param query     Plain-text search query (converted to tsquery inside the DB)
 * @param courseId  Scope filter — must match `chunks.course_id`
 * @param lectureId Scope filter — must match `chunks.lecture_id`
 * @param topN      Maximum number of results to return
 * @returns Array of chunk IDs ordered by descending ts_rank
 */
export async function ftsSearch(
  query: string,
  courseId: string,
  lectureId: string,
  topN: number
): Promise<string[]> {
  const { data, error } = await supabaseClient.rpc('search_chunks_fts', {
    query_text: query,
    p_course_id: courseId,
    p_lecture_id: lectureId,
    match_count: topN,
  });

  if (error) throw error;
  return ((data ?? []) as { id: string; rank: number }[]).map((row) => row.id);
}

/**
 * Fetch full chunk rows for a given list of chunk IDs, preserving the
 * supplied order (needed by ragQueryService to build citations in RRF rank
 * order).
 *
 * Returns an array of `Chunk` objects in the same order as `ids`.  Any ID
 * not found in the database is silently omitted.
 *
 * Satisfies Requirements 7.1, 8.1, 8.2.
 */
export async function getChunksByIds(ids: string[]): Promise<Chunk[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabaseClient
    .from('chunks')
    .select('*')
    .in('id', ids);

  if (error) throw error;

  const rows = (data ?? []) as Chunk[];

  // Re-sort to preserve the RRF rank order supplied by the caller.
  const indexMap = new Map(ids.map((id, i) => [id, i]));
  return rows.sort(
    (a, b) => (indexMap.get(a.id) ?? Infinity) - (indexMap.get(b.id) ?? Infinity)
  );
}
