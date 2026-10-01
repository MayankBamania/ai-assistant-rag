# Supabase Migrations

This directory contains SQL migration files for the AI Assistant RAG project. Each file is numbered sequentially and should be run in order via the Supabase SQL editor.

## How to Run

1. Open your [Supabase project dashboard](https://supabase.com/dashboard).
2. Navigate to **SQL Editor** in the left sidebar.
3. Click **New query**.
4. Copy the contents of the migration file (in order, starting from `001_...`) and paste them into the editor.
5. Click **Run** to execute.
6. Repeat for each subsequent migration file in numerical order.

## Migration Files

| File | Description |
|------|-------------|
| `001_create_courses_and_lectures.sql` | Enables pgvector extension; creates `courses` and `lectures` tables with the `ingestion_status` CHECK constraint and `ON DELETE CASCADE` foreign key. |
| `002_create_chunks_and_semantic_cache.sql` | Creates `chunks` table (with `embedding vector(768)`, `fts_vector tsvector`, `timestamp_start`/`timestamp_end` CHECK constraints, and `ON DELETE CASCADE` FK) and `semantic_cache` table (with `question_embedding vector(768)` and `ON DELETE CASCADE` FK). |
| `003_create_fts_trigger_and_indexes.sql` | Creates `chunks_fts_update()` trigger function and `chunks_fts_trigger` (BEFORE INSERT OR UPDATE) to auto-populate `fts_vector`; adds HNSW index on `chunks.embedding`, GIN index on `chunks.fts_vector`, btree index on `chunks.course_id`, and HNSW index on `semantic_cache.question_embedding`. |
| `004_create_search_functions.sql` | Creates the `match_chunks` Postgres function (pgvector cosine-similarity search, scoped to `course_id + lecture_id`) and the `search_chunks_fts` function (tsvector BM25 full-text search, scoped to `course_id + lecture_id`). Both functions are called by `chunkRepository.ts` via `supabaseClient.rpc()`. |
| `005_create_cache_match_function.sql` | Creates the `match_cache` Postgres function (cosine-similarity lookup on `semantic_cache.question_embedding`, scoped to `course_id + lecture_id`, with a configurable similarity threshold). Called by `cacheRepository.ts` via `supabaseClient.rpc()`. |

## Notes

- Migrations must be applied **in order**. Later migrations may depend on objects created by earlier ones.
- If a migration fails part-way through, check the error message in the SQL editor, resolve the issue, and re-run only the failed statements. Supabase does not auto-rollback DDL.
- The `vector` extension must be enabled before any table that uses the `vector` type is created. Migration `001` handles this.
