# Implementation Plan: AI Assistant RAG

## Overview

Incremental build of a full-stack AI assistant sidebar for an e-learning platform: Supabase schema, Node.js/TypeScript backend (layered routes → controllers → services → repositories), and Angular frontend (Trainer UI + Student split-screen view). Each task builds directly on the previous, ending with all components wired together end-to-end.

---

## Tasks

- [x] 1. Supabase schema and indexes
  - [x] 1.1 Enable pgvector extension and create the `courses` and `lectures` tables
    - Run `CREATE EXTENSION IF NOT EXISTS vector` in Supabase SQL editor
    - Create `courses` table: `id uuid PK DEFAULT gen_random_uuid() NOT NULL`, `title text NOT NULL`
    - Create `lectures` table with all required columns and the `ingestion_status` CHECK constraint (`'pending' | 'processing' | 'ready' | 'failed'`)
    - Add the `ON DELETE CASCADE` foreign key from `lectures.course_id → courses.id`
    - _Requirements: 1.1, 1.2, 1.3, 1.12_

  - [x] 1.2 Create `chunks` and `semantic_cache` tables with constraints
    - Create `chunks` table with all columns including `embedding vector(768)`, `fts_vector tsvector`, `timestamp_start/end integer`, CHECK constraints for `timestamp_start >= 0` and `timestamp_end >= timestamp_start`, and `ON DELETE CASCADE` FK from `chunks.lecture_id → lectures.id`
    - Create `semantic_cache` table with `question_embedding vector(768)`, `answer_text text`, `created_at timestamptz DEFAULT current_timestamp`, and `ON DELETE CASCADE` FK from `semantic_cache.lecture_id → lectures.id`
    - _Requirements: 1.4, 1.5, 1.6, 1.12_

  - [x] 1.3 Create FTS trigger and all required indexes
    - Create `chunks_fts_update()` trigger function and `chunks_fts_trigger` (BEFORE INSERT OR UPDATE) that sets `fts_vector = to_tsvector('english', NEW.text)`
    - Create HNSW index on `chunks.embedding` using `vector_cosine_ops`
    - Create GIN index on `chunks.fts_vector`
    - Create btree index on `chunks.course_id`
    - Create HNSW index on `semantic_cache.question_embedding` using `vector_cosine_ops`
    - _Requirements: 1.7, 1.8, 1.9, 1.10, 1.11_

  - [ ]* 1.4 Write unit tests for schema constraints
    - Test that inserting an invalid `ingestion_status` value raises a constraint violation
    - Test that `timestamp_end < timestamp_start` raises a constraint violation
    - Test that inserting a chunk without `text` populated causes `fts_vector` to be set by the trigger
    - _Requirements: 1.3, 1.5, 1.7_

- [x] 2. Backend scaffolding — layered folder structure
  - [x] 2.1 Initialize Node.js + TypeScript project with required dependencies
    - `npm init`, configure `tsconfig.json` (strict mode, `ES2022`, `moduleResolution: node16`)
    - Install: `typescript`, `ts-node`, `@types/node`, `express`, `@types/express`, `dotenv`
    - Install: `@langchain/groq`, `@langchain/community`, `langchain`, `@supabase/supabase-js`, `youtube-transcript`
    - _Requirements: (scaffolding — underpins all backend requirements)_

  - [x] 2.2 Create the layered folder structure
    - Create `backend/src/routes/` — HTTP layer (one file per resource group)
    - Create `backend/src/controllers/` — orchestration layer (one file per controller)
    - Create `backend/src/services/` — business logic layer
    - Create `backend/src/repositories/` — data access layer (all Supabase queries live here)
    - Create `backend/src/types/` — shared TypeScript interfaces
    - Create `backend/src/db/` — Supabase client singleton
    - Create placeholder `backend/src/app.ts` and `backend/src/index.ts`
    - _Requirements: (scaffolding — underpins all backend requirements)_

  - [x] 2.3 Configure environment variables and Supabase client
    - Create `.env.example` with required keys: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `OLLAMA_BASE_URL` (or `NOMIC_API_KEY`)
    - Create `src/db/supabase.ts` exporting a singleton Supabase client using the service role key
    - Add startup check: if pgvector extension is absent, log a descriptive error and exit without modifying data
    - _Requirements: 1.13_

  - [x] 2.4 Define shared TypeScript interfaces
    - Create `src/types/index.ts` with interfaces: `Course`, `Lecture`, `Chunk`, `SemanticCacheEntry`, `Citation`, `QuerySSEPayload`, `TranscriptSegment`
    - _Requirements: (types used by all subsequent backend tasks)_

- [x] 3. Embedding Service
  - [x] 3.1 Implement the Embedding Service with retry logic
    - Create `src/services/embeddingService.ts` implementing `EmbeddingService` interface: `embed(text: string): Promise<number[]>`
    - Use `OllamaEmbeddings` (or `NomicEmbeddings`) with `nomic-embed-text` model returning 768-dim vectors
    - Implement retry wrapper: up to 3 attempts, exponential backoff — delays 1s → 2s → 4s (cap 8s); throw after 3rd failure
    - Export a single shared instance used by both `ingestionService` and `ragQueryService`
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

  - [ ]* 3.2 Write unit tests for the Embedding Service retry logic
    - Mock the underlying embedding model to fail on the first N calls
    - Test that it retries exactly 3 times with increasing delays before throwing
    - Test that a successful response on retry 2 resolves correctly
    - _Requirements: 4.5_

- [x] 4. Chunker
  - [x] 4.1 Implement the Chunker
    - Create `src/services/chunker.ts` implementing `Chunker` interface: `chunk(segments: TranscriptSegment[]): Chunk[]`
    - Pure function — no I/O, no Supabase calls
    - Window = 75s, overlap = 15s, step = 60s; `timestamp_start` of chunk N = `N * 60`
    - Collect segments where `segment.start >= window_start && segment.start < window_start + 75`
    - `timestamp_end` of the final chunk = `Math.ceil(lastSegment.start)` in whole seconds
    - Return `[]` for empty input; return exactly one chunk for input shorter than 75s
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ]* 4.2 Write unit tests for the Chunker
    - Test: empty input → `[]`
    - Test: single segment at 30s → one chunk, `timestamp_start = 0`, `timestamp_end = 30`
    - Test: transcript exactly 75s → one chunk
    - Test: transcript of 120s → two chunks with correct `timestamp_start` values (0, 60) and 15s overlap
    - Test: `timestamp_start` of chunk N+1 = `timestamp_end` of chunk N minus 15 (requirement 3.5)
    - _Requirements: 3.1–3.8_

- [x] 5. Repositories
  - [x] 5.1 Implement `courseRepository.ts`
    - Create `src/repositories/courseRepository.ts`
    - `insertCourse(title: string): Promise<Course>` — insert into `courses`, return inserted row
    - `getAllCourses(): Promise<Course[]>` — return all rows from `courses`
    - _Requirements: 11.3_

  - [x] 5.2 Implement `lectureRepository.ts`
    - Create `src/repositories/lectureRepository.ts`
    - `insertLecture(data): Promise<Lecture>` — insert into `lectures` with `ingestion_status = 'pending'`, return row
    - `getLecturesByCourse(courseId: string): Promise<Lecture[]>` — return lectures for a course
    - `getLectureStatus(lectureId: string): Promise<string>` — return `ingestion_status` for a lecture
    - `updateIngestionStatus(lectureId: string, status: string): Promise<void>` — update `ingestion_status`
    - _Requirements: 2.2, 11.5, 11.7, 11.8_

  - [x] 5.3 Implement `chunkRepository.ts`
    - Create `src/repositories/chunkRepository.ts`
    - `insertChunk(chunk): Promise<void>` — insert a single chunk row
    - `upsertChunk(chunk): Promise<void>` — overwrite existing chunk embedding and `fts_vector` for re-ingestion
    - `vectorSearch(embedding: number[], courseId: string, lectureId: string, topN: number): Promise<string[]>` — pgvector cosine-similarity search, return chunk IDs in rank order
    - `ftsSearch(query: string, courseId: string, lectureId: string, topN: number): Promise<string[]>` — tsvector BM25 full-text search, return chunk IDs in rank order
    - All queries scoped to `course_id + lecture_id` to enforce multi-tenancy
    - _Requirements: 2.5, 2.6, 4.6, 6.1, 6.2, 6.3, 6.4, 10.1–10.5_

  - [x] 5.4 Implement `cacheRepository.ts`
    - Create `src/repositories/cacheRepository.ts`
    - `findSimilarQuestion(embedding: number[], courseId: string, lectureId: string, threshold: number): Promise<SemanticCacheEntry | null>` — cosine similarity >= threshold scoped to `course_id + lecture_id`; return null on miss or query error
    - `saveToCache(entry): Promise<void>` — insert `question_embedding`, `answer_text`, `course_id`, `lecture_id`, `question_text`
    - _Requirements: 5.1–5.6_

  - [ ]* 5.5 Write unit tests for repositories
    - Mock the Supabase client
    - Test `courseRepository.insertCourse` passes correct payload to Supabase
    - Test `chunkRepository.vectorSearch` applies `course_id` + `lecture_id` filter
    - Test `cacheRepository.findSimilarQuestion` returns null when Supabase throws
    - _Requirements: 5.3, 6.1, 10.4_

- [x] 6. Ingestion Service
  - [x] 6.1 Implement YouTube URL validation and transcript fetching in `ingestionService.ts`
    - Create `src/services/ingestionService.ts`
    - Implement URL parser supporting three formats: `watch?v=`, `youtu.be/`, `/embed/`; throw 400 on invalid URL
    - Fetch captions via `youtube-transcript` package; throw 422 if no captions returned
    - Normalize timestamps: `Math.floor(ms / 1000)` for each segment
    - Calls `lectureRepository.updateIngestionStatus` — no direct Supabase access
    - _Requirements: 2.1, 2.3, 2.4, 2.7, 2.8_

  - [x] 6.2 Implement ingestion orchestration in `ingestionService.ts`
    - Set `ingestion_status = 'processing'` via `lectureRepository.updateIngestionStatus` before any external API call
    - Call `chunker.chunk()` on normalized transcript
    - For each chunk: call `embeddingService.embed()`, then `chunkRepository.upsertChunk()` (handles re-ingestion)
    - On all chunks stored: set status to `'ready'` via `lectureRepository.updateIngestionStatus`
    - On embedding failure after retries: set status to `'failed'`
    - _Requirements: 2.2, 2.5, 2.6, 4.6_

  - [x] 6.3 Create `ingestionController.ts` and `POST /api/ingest` route
    - Create `src/controllers/ingestionController.ts`: validate `courseId`, `lectureId`, `youtubeUrl` presence; call `ingestionService`; return `{ lectureId, status: "processing" }` immediately (kick off ingestion asynchronously)
    - Create `src/routes/ingest.ts`: mount `POST /api/ingest` → `ingestionController`; no business logic in the route
    - _Requirements: 2.1–2.8_

  - [ ]* 6.4 Write integration tests for the Ingestion Service
    - Mock `youtube-transcript` and `embeddingService`
    - Test: invalid URL → 400, `lectureRepository.updateIngestionStatus` called with `'failed'`
    - Test: no captions → 422, status set to `'failed'`
    - Test: successful ingestion → `chunkRepository.upsertChunk` called per chunk, status set to `'ready'`
    - _Requirements: 2.7, 2.8, 2.6_

- [x] 7. RAG Query Service
  - [x] 7.1 Implement semantic cache lookup in `ragQueryService.ts`
    - Create `src/services/ragQueryService.ts`
    - Embed the question via `embeddingService.embed()`
    - Call `cacheRepository.findSimilarQuestion` (cosine threshold 0.92, scoped to `course_id + lecture_id`)
    - On hit: stream cached answer as tokens and return early (skip LLM)
    - On cache error: log and continue to hybrid search without returning an error to the student
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 7.2 Implement hybrid search and RRF in `ragQueryService.ts`
    - Call `chunkRepository.vectorSearch` (top-10) and `chunkRepository.ftsSearch` (top-10)
    - Implement `reciprocalRankFusion(vectorResults, ftsResults, k=60, topN=10)` per the design
    - If both branches return zero results: stream static "not found" message, send `done` event — no LLM call
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 7.3 Write unit tests for RRF and hybrid search
    - Test: `reciprocalRankFusion` with overlapping results promotes shared IDs
    - Test: one empty branch → RRF uses only the non-empty set
    - Test: both empty → static response, no LLM call
    - _Requirements: 6.3, 6.4, 6.5, 6.6_

  - [x] 7.4 Implement LLM streaming, citations, and cache save in `ragQueryService.ts`
    - Build system + user message prompt per the design's `LLM Prompt Structure`
    - Stream `llama3-8b-8192` via `ChatGroq`; emit `{ type: "token", content: "..." }` events per chunk
    - On 429/503: retry once with `mixtral-8x7b` before sending error event
    - On non-retriable 4xx: send `{ type: "error", status, message }` event and terminate stream
    - On mid-stream error: send `{ type: "error", message: "partial response" }` and terminate stream
    - After stream completes: build `Citation[]` from retrieved chunks using `{video_url}&t={timestamp_start}s`
    - Emit `{ type: "citations", items: Citation[] }` (max 10); emit `{ type: "done" }`
    - Call `cacheRepository.saveToCache` with `{ question_embedding, answer_text, course_id, lecture_id, question_text }`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.5_

  - [x] 7.5 Create `queryController.ts` and `GET /api/query` route
    - Create `src/controllers/queryController.ts`: validate `courseId` and `lectureId` presence; verify `lectureId` belongs to `courseId` via `lectureRepository`; return 400 on any validation failure; delegate to `ragQueryService`
    - Create `src/routes/query.ts`: mount `GET /api/query` → `queryController`; set SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`) before forwarding; no business logic
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 7.6 Write integration tests for the RAG Query Service
    - Mock Supabase repositories and Groq
    - Test cache hit → no LLM call, answer streamed from cache
    - Test cache miss → hybrid search → LLM call → citations emitted → cache saved
    - Test 429 → fallback to mixtral → success
    - Test missing `courseId` → 400 response
    - _Requirements: 5.3, 7.2, 7.3, 10.2, 10.3_

- [x] 8. Trainer API
  - [x] 8.1 Implement `courseController.ts` and course routes
    - Create `src/controllers/courseController.ts`: `createCourse` calls `courseRepository.insertCourse`; `listCourses` calls `courseRepository.getAllCourses`; return appropriate responses (thin CRUD, no business logic)
    - Create `src/routes/courses.ts`: mount `POST /api/courses` and `GET /api/courses` → `courseController`
    - _Requirements: 11.3_

  - [x] 8.2 Implement `lectureController.ts` and lecture routes
    - Create `src/controllers/lectureController.ts`:
      - `createLecture` — calls `lectureRepository.insertLecture` with `ingestion_status = 'pending'`, then kicks off `ingestionService` asynchronously; returns lecture record
      - `listLectures` — calls `lectureRepository.getLecturesByCourse`
      - `getLectureStatus` — calls `lectureRepository.getLectureStatus`, returns `{ lectureId, ingestionStatus }`
    - Create `src/routes/lectures.ts`: mount under `/api/courses/:courseId/lectures`
      - `POST /` → `lectureController.createLecture`
      - `GET /` → `lectureController.listLectures`
      - `GET /:lectureId/status` → `lectureController.getLectureStatus`
    - _Requirements: 11.5, 11.7, 11.8_

  - [x] 8.3 Wire all routes into Express app entry point
    - Populate `src/app.ts`: configure Express app, add CORS middleware for Angular dev origin, mount `/api/ingest`, `/api/query`, `/api/courses`, and lecture sub-routes
    - Populate `src/index.ts`: import `app`, call `server.listen` with port from `process.env.PORT`
    - _Requirements: (integration — enables all API requirements)_

  - [ ]* 8.4 Write integration tests for Trainer API
    - Test: `POST /api/courses` → 201 with new course
    - Test: `POST /api/courses/:courseId/lectures` → lecture created and ingestion triggered asynchronously
    - Test: `GET .../status` → returns correct `ingestionStatus`
    - _Requirements: 11.3, 11.7, 11.8_

- [x] 9. Backend checkpoint
  - Ensure all backend unit and integration tests pass; ask the user if questions arise.

- [x] 10. Angular project scaffolding
  - [x] 10.1 Initialize Angular project with routing and SharedModule
    - `ng new ai-assistant-rag-frontend --routing --style=scss`
    - Create `SharedModule` with `TimestampPipe` declared and exported
    - `TimestampPipe`: seconds < 3600 → `M:SS`; seconds >= 3600 → `H:MM:SS`
    - Configure `AppRoutingModule`: lazy-load `TrainerModule` at `/trainer`; route `/lecture/:lectureId` to `LecturePageComponent`
    - _Requirements: 8.3, 9.3, 11.1_

  - [ ]* 10.2 Write unit tests for TimestampPipe
    - Test: 83s → `"1:23"`
    - Test: 0s → `"0:00"`
    - Test: 3600s → `"1:00:00"`
    - Test: 5025s → `"1:23:45"`
    - _Requirements: 8.3_

- [x] 11. Angular Trainer UI
  - [x] 11.1 Create TrainerModule with lazy loading and TrainerDashboardComponent
    - Generate `TrainerModule` with its own routing (`/trainer` → `TrainerDashboardComponent`, `/trainer/courses/:courseId` → `CourseDetailComponent`)
    - `TrainerDashboardComponent`: on init call `GET /api/courses`, render course list, each row links to `/trainer/courses/:courseId`
    - Inline "Create Course" form: title 1–100 chars, submit disabled outside range, error message if invalid
    - On submit: call `POST /api/courses`, append new course, show success toast
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 11.2 Create CourseDetailComponent and LectureRowComponent with status polling
    - `CourseDetailComponent`: on init call `GET /api/courses/:courseId/lectures`, render `LectureRowComponent` per lecture
    - `LectureRowComponent`: show title, URL, status badge (pending=grey, processing=blue+spinner, ready=green+link, failed=red+Retry)
    - On "ready": render link to `/lecture/:lectureId`; on "failed": render Retry button that calls `POST /api/ingest` and resets to processing
    - "Add Lecture" form: title 1–100 chars + YouTube URL; on submit call `POST /api/courses/:courseId/lectures`, append row in processing state
    - Status polling: every 5 seconds call `GET .../status` for each `processing` lecture; stop polling when `ready` or `failed`
    - On API error: display backend error message, retain form values
    - _Requirements: 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11_

  - [ ]* 11.3 Write unit tests for TrainerDashboardComponent and CourseDetailComponent
    - Test: course list renders after `GET /api/courses` resolves
    - Test: invalid title (0 chars, 101 chars) disables submit and shows error
    - Test: polling stops when status reaches `'ready'`
    - Test: Retry button triggers `POST /api/ingest`
    - _Requirements: 11.3, 11.4, 11.8, 11.10_

- [x] 12. Angular Student UI
  - [x] 12.1 Create LecturePageComponent with split-screen layout
    - Generate `LecturePageComponent` at `/lecture/:lectureId`
    - CSS: left panel 60% width, right panel remaining width, both 100vh
    - On init: load lecture data via `GET /api/courses/:courseId/lectures/:lectureId` to obtain `videoId`
    - Render `VideoPlayerComponent` (left) and `ChatSidebarComponent` (right)
    - _Requirements: 9.1_

  - [x] 12.2 Create VideoPlayerComponent with YouTube IFrame API integration
    - Dynamically load YouTube IFrame Player API script (`https://www.youtube.com/iframe_api`)
    - Accept `videoId: string` input; render player when `onYouTubeIframeAPIReady` fires
    - Emit `playerReady` output event once player is ready
    - Expose `seekTo(seconds: number): void` method calling `player.seekTo(seconds, true)`
    - _Requirements: 9.2, 8.4_

  - [x] 12.3 Create ChatSidebarComponent with SSE streaming and input validation
    - Maintain `messages: Message[]` in component state (not persisted)
    - Input: 1–1000 chars; disable submit and show error message outside this range
    - On submit: append user message, show loading indicator within 200ms, open SSE connection to `GET /api/query`
    - `token` event: append `content` to the current assistant bubble (no new bubble per token)
    - `citations` event: store citation list
    - `done` event: hide loading indicator, append citations below completed message
    - `error` event: hide loading indicator, append error message, retain prior messages
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x] 12.4 Create CitationListComponent and wire citations to video seek
    - Render each `Citation` as a clickable button showing `TimestampPipe`-formatted timestamp
    - On click: call `VideoPlayerComponent.seekTo(citation.timestamp)`
    - If `playerReady` has not fired: display "Video is not ready" error, do not call `seekTo`
    - _Requirements: 8.3, 8.4, 8.6_

  - [ ]* 12.5 Write unit tests for ChatSidebarComponent and CitationListComponent
    - Test: input with 0 chars disables submit
    - Test: input with 1001 chars disables submit
    - Test: `token` events append to same bubble
    - Test: `done` event attaches citations below message
    - Test: `error` event shows error and retains prior messages
    - Test: citation click before `playerReady` shows error without calling `seekTo`
    - _Requirements: 9.4, 9.5, 9.6, 9.7, 9.8, 8.6_

- [x] 13. End-to-end integration and wiring
  - [x] 13.1 Wire Angular environment files to backend API base URL
    - Set `environment.ts` and `environment.prod.ts` with `apiBaseUrl` pointing to Node.js backend
    - Update all Angular services to use `environment.apiBaseUrl` for all HTTP and SSE calls
    - _Requirements: (integration)_

  - [x] 13.2 Wire frontend SSE client to backend query endpoint
    - Implement `ChatService` using native `EventSource` or `fetch` with `ReadableStream`
    - Reconnect is NOT automatic (stream is request-scoped)
    - _Requirements: 9.6, 9.7, 9.8_

  - [x] 13.3 Final checkpoint — ensure all tests pass
    - Ensure all backend and Angular unit/integration tests pass; ask the user if questions arise.

---

## Notes

- Sub-tasks marked with `*` are optional and can be skipped for a faster MVP build.
- Each task references specific requirements from `requirements.md` for full traceability.
- Checkpoint tasks ensure incremental validation before the next phase begins.
- The design has no Correctness Properties section, so property-based tests are not included; unit and integration tests are used instead.
- Nothing outside `src/repositories/` should import or call the Supabase client directly.
- Re-ingestion (task 6.2) uses `chunkRepository.upsertChunk` to overwrite existing chunk embeddings per requirement 4.6.
- `POST /api/courses/:courseId/lectures` (task 8.2) calls the ingestion service internally — the Angular Trainer UI does not call `POST /api/ingest` directly for new lectures (it only calls it for retry).

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4", "2.1"] },
    { "id": 4, "tasks": ["2.2"] },
    { "id": 5, "tasks": ["2.3", "2.4"] },
    { "id": 6, "tasks": ["3.1"] },
    { "id": 7, "tasks": ["3.2", "4.1"] },
    { "id": 8, "tasks": ["4.2", "5.1"] },
    { "id": 9, "tasks": ["5.2", "5.3"] },
    { "id": 10, "tasks": ["5.4"] },
    { "id": 11, "tasks": ["5.5", "6.1"] },
    { "id": 12, "tasks": ["6.2"] },
    { "id": 13, "tasks": ["6.3", "7.1"] },
    { "id": 14, "tasks": ["7.2"] },
    { "id": 15, "tasks": ["7.3", "7.4"] },
    { "id": 16, "tasks": ["7.5"] },
    { "id": 17, "tasks": ["7.6", "8.1"] },
    { "id": 18, "tasks": ["8.2"] },
    { "id": 19, "tasks": ["8.3"] },
    { "id": 20, "tasks": ["8.4", "10.1"] },
    { "id": 21, "tasks": ["10.2", "11.1"] },
    { "id": 22, "tasks": ["11.2"] },
    { "id": 23, "tasks": ["11.3", "12.1"] },
    { "id": 24, "tasks": ["12.2", "12.3"] },
    { "id": 25, "tasks": ["12.4"] },
    { "id": 26, "tasks": ["12.5", "13.1"] },
    { "id": 27, "tasks": ["13.2"] },
    { "id": 28, "tasks": ["13.3"] }
  ]
}
```
