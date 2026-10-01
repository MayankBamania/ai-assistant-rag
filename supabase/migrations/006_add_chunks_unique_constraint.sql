-- Migration 006: Add unique constraint on chunks(lecture_id, timestamp_start)
-- Required for upsert ON CONFLICT (lecture_id, timestamp_start) in chunkRepository.
-- Without this constraint Postgres throws error 42P10 on re-ingestion.

ALTER TABLE chunks
ADD CONSTRAINT chunks_lecture_id_timestamp_start_key
UNIQUE (lecture_id, timestamp_start);
