# Future Improvements

This document captures known gaps in the current RAG pipeline and planned solutions for future implementation.

---

## 1. Summary Queries

### Problem
When a user asks "generate a summary of this video" or "what is this video about", the system currently falls through to the standard RAG pipeline. Vector search finds the top 10 semantically closest chunks to the word "summary" — which are somewhat random chunks, not a curated selection of the full lecture. The result is a partial summary rather than a complete one.

### Proposed Solution
**Pre-generate the summary at ingestion time** and store it in the `semantic_cache` table.

**Implementation steps:**

1. At the end of `ingestLecture()` in `ingestionService.ts`, after all chunks are stored and status is set to `ready`:
   - Fetch **all** chunks for the lecture from the `chunks` table (ordered by `timestamp_start`)
   - Concatenate all chunk texts into a single context string
   - Call the LLM with a prompt like: "Summarize the following lecture transcript in 5-7 sentences covering all major topics discussed."
   - Embed a canonical question like `"summarize this lecture"` using `embeddingService.embed()`
   - Save the result to `semantic_cache` with `question_text = "summarize this lecture"`, `answer_text = <generated summary>`, and the embedding

2. At query time, when a user asks "generate a summary", "what is this video about", "give me an overview" etc., their question embedding will be close enough (cosine ≥ 0.92) to the stored canonical embedding to trigger a cache hit — returning the pre-generated summary instantly without an LLM call.

**Files to modify:**
- `backend/src/services/ingestionService.ts` — add summary generation step after ingestion
- `backend/src/repositories/cacheRepository.ts` — already has `saveToCache()`, no changes needed
- `backend/src/repositories/chunkRepository.ts` — add a `getAllChunksByLecture(lectureId)` method that returns all chunks ordered by timestamp

**Key consideration:** The summary must be generated from ALL chunks, not just top 10. Fetch all chunks with `ORDER BY timestamp_start ASC` to preserve lecture order.

---

## 2. Temporal / Timestamp-Based Queries

### Problem
When a user asks "what is discussed in the first 1 minute of this video?" or "what happens at the 5 minute mark?", the current pipeline treats it as a semantic query. Vector search finds chunks by content similarity to the phrase "first 1 minute" — which has no semantic overlap with transcript content — so it returns arbitrary chunks from any timestamp. The answer is unreliable.

### Proposed Solution
**Detect temporal intent in the question** and switch from vector search to a timestamp-range filter query.

**Implementation steps:**

1. In `ragQueryService.ts`, before running the hybrid search, add an intent detection step:
   - Use a regex to detect temporal patterns in the question:
     ```ts
     // Examples to match:
     // "first 2 minutes", "last 5 minutes", "first minute"
     // "at 3 minutes", "around 2:30", "between 1 and 3 minutes"
     const temporalMatch = question.match(
       /(?:first|last|opening|initial)\s+(\d+)\s*min/i
     ) || question.match(/at\s+(\d+)\s*min/i);
     ```
   - Extract the time range (e.g. `endSeconds = 60` for "first 1 minute")

2. If temporal intent is detected, skip vector search and FTS entirely. Instead, query the `chunks` table directly:
   ```ts
   // For "first N minutes": fetch chunks that start within the time range
   SELECT * FROM chunks
   WHERE lecture_id = $lectureId
     AND course_id = $courseId
     AND timestamp_start < $endSeconds
   ORDER BY timestamp_start ASC
   ```

3. Pass those timestamp-filtered chunks to the LLM with the original question as usual.

4. If no temporal intent is detected, fall through to the existing hybrid vector + FTS search pipeline.

**Files to modify:**
- `backend/src/services/ragQueryService.ts` — add intent detection before hybrid search
- `backend/src/repositories/chunkRepository.ts` — add `getChunksByTimeRange(lectureId, courseId, startSeconds, endSeconds)` method

**Patterns to handle:**
| User query | Extracted range |
|---|---|
| "first 1 minute" | 0s – 60s |
| "first 5 minutes" | 0s – 300s |
| "last 2 minutes" | `(videoDuration - 120)s` – end |
| "at 3 minutes" | 160s – 200s (±20s window) |
| "between 2 and 5 minutes" | 120s – 300s |

**Key consideration:** For "last N minutes", you need the total video duration. This is not currently stored in the DB. Either store it during ingestion (from the transcript's last chunk's `timestamp_end`) or use a ±window approach for "at X minutes" queries.

---

## 3. Current Known Gaps Summary

| Query type | Current behaviour | Planned fix |
|---|---|---|
| "summarize this video" | Partial summary from random top-10 chunks | Pre-generate at ingestion, cache it |
| "what happened in first 1 minute" | Unreliable — returns random chunks | Timestamp-range filter query |
| "what is the capital of France" | Correctly says "not covered" | Working — no fix needed |
| Standard content questions | Works correctly via hybrid RAG | No change needed |
