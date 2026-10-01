# Requirements Document

## Introduction

A POC AI assistant sidebar for an e-learning platform. Students ask questions while watching a lecture and receive answers grounded strictly in the trainer's transcript, with clickable timestamp citations that jump to the exact second in the video.

The POC covers:
- YouTube-based lecture ingestion (Whisper/upload path is a post-POC TODO)
- Hybrid RAG query with semantic caching
- Streaming chat sidebar with timestamp deeplinks
- Multi-tenant isolation by course

Chat history is session-only; no student authentication is required for the POC.

---

## Glossary

- **System**: The AI assistant RAG backend (Node.js + LangChain.js)
- **Frontend**: The Angular single-page application
- **Ingestion_Service**: The backend component that accepts a YouTube URL and produces stored, indexed transcript chunks
- **Chunker**: The sub-component of the Ingestion_Service that splits a normalized transcript into time-windowed segments
- **Embedding_Service**: The component that converts text to 768-dimensional vectors using nomic-embed-text
- **RAG_Query_Service**: The backend component that handles a student question end-to-end and produces a streamed answer
- **Semantic_Cache**: The Supabase table and lookup logic that stores previous question/answer pairs keyed by question embedding
- **Hybrid_Search**: The combination of pgvector cosine-similarity search and Postgres tsvector BM25 full-text search, merged via Reciprocal Rank Fusion
- **LLM**: Groq llama3-8b-8192 (primary) or mixtral-8x7b (fallback), used only for answer generation
- **SSE**: Server-Sent Events — the streaming transport from backend to Frontend
- **Deeplink**: A URL of the form `{video_url}&t={timestamp_start}s` that causes the video player to seek to a specific second
- **Course**: A top-level grouping of lectures identified by `course_id`
- **Lecture**: A single video lesson identified by `lecture_id`, belonging to one Course
- **Chunk**: A 75-second (with 15-second overlap) segment of a Lecture transcript stored with its embedding and full-text search vector
- **Trainer**: The content author who registers a lecture by submitting a YouTube URL
- **Student**: The end user who watches a lecture and asks questions in the chat sidebar

---

## Requirements

### Requirement 1: Database Schema and Indexes

**User Story:** As a developer, I want a Supabase schema with pgvector and full-text search support, so that chunks can be stored and retrieved efficiently.

#### Acceptance Criteria

1. THE System SHALL create a `courses` table with columns `id` (uuid, primary key, default generated) NOT NULL and `title` (text) NOT NULL.
2. THE System SHALL create a `lectures` table with columns `id` (uuid, primary key, default generated) NOT NULL, `course_id` (uuid, foreign key → courses.id ON DELETE CASCADE) NOT NULL, `title` (text) NOT NULL, `video_type` (text) NOT NULL, `video_url` (text) NOT NULL, and `ingestion_status` (text) NOT NULL.
3. THE System SHALL constrain `lectures.ingestion_status` to only accept the values `'pending'`, `'processing'`, `'ready'`, and `'failed'`.
4. THE System SHALL create a `chunks` table with columns `id` (uuid, primary key, default generated) NOT NULL, `lecture_id` (uuid, foreign key → lectures.id ON DELETE CASCADE) NOT NULL, `course_id` (uuid) NOT NULL, `text` (text) NOT NULL, `embedding` (vector(768)) NOT NULL, `fts_vector` (tsvector) NOT NULL, `timestamp_start` (integer) NOT NULL, and `timestamp_end` (integer) NOT NULL.
5. THE System SHALL constrain `chunks.timestamp_start` to be >= 0 and `chunks.timestamp_end` to be >= `chunks.timestamp_start`.
6. THE System SHALL create a `semantic_cache` table with columns `id` (uuid, primary key, default generated) NOT NULL, `lecture_id` (uuid, foreign key → lectures.id ON DELETE CASCADE) NOT NULL, `course_id` (uuid) NOT NULL, `question_text` (text) NOT NULL, `question_embedding` (vector(768)) NOT NULL, `answer_text` (text) NOT NULL, and `created_at` (timestamptz) NOT NULL DEFAULT current_timestamp.
7. THE System SHALL populate `chunks.fts_vector` automatically via a trigger or generated column using `to_tsvector('english', chunks.text)` whenever a chunk is inserted or updated.
8. THE System SHALL create at least one ivfflat or hnsw index on `chunks.embedding` to support approximate nearest-neighbor vector search.
9. THE System SHALL create a GIN index on `chunks.fts_vector` to support full-text search.
10. THE System SHALL create a btree index on `chunks.course_id` to support metadata filtering.
11. THE System SHALL create at least one ivfflat or hnsw index on `semantic_cache.question_embedding` to support similarity lookups.
12. THE System SHALL define ON DELETE CASCADE foreign key relationships so that deleting a `courses` row cascades to all dependent `lectures`, `chunks`, and `semantic_cache` rows.
13. IF the pgvector extension is not enabled in the Supabase project, THEN THE System SHALL surface a descriptive error message identifying the missing extension during startup and SHALL NOT modify any data.

---

### Requirement 2: YouTube Transcript Ingestion

**User Story:** As a trainer, I want to submit a YouTube URL so that the lecture transcript is automatically fetched, chunked, and indexed for student queries.

#### Acceptance Criteria

1. WHEN a trainer submits a YouTube URL, THE Ingestion_Service SHALL extract the video ID from standard YouTube URL formats including `https://www.youtube.com/watch?v=VIDEO_ID`, `https://youtu.be/VIDEO_ID`, and `https://www.youtube.com/embed/VIDEO_ID`.
2. WHEN transcript ingestion begins, THE Ingestion_Service SHALL set `lectures.ingestion_status` to `'processing'` before making any external API call.
3. WHEN the video ID is extracted, THE Ingestion_Service SHALL fetch the full caption track using the `youtube-transcript` npm package, preserving per-segment timestamps in milliseconds.
4. WHEN captions are fetched, THE Ingestion_Service SHALL normalize all timestamps by dividing millisecond values by 1000 and rounding down to the nearest whole second.
5. WHEN captions are normalized, THE Ingestion_Service SHALL pass the full normalized transcript to the Chunker and store all resulting chunks with their embeddings in Supabase.
6. WHEN all chunks are stored successfully, THE Ingestion_Service SHALL set `lectures.ingestion_status` to `'ready'`.
7. IF a YouTube URL does not match any of the supported URL formats or the video ID cannot be extracted, THEN THE Ingestion_Service SHALL return a 400 error response with a message identifying the invalid URL format and set `lectures.ingestion_status` to `'failed'`.
8. IF the `youtube-transcript` package returns no captions for the video, THEN THE Ingestion_Service SHALL return a 422 error response with a message stating that no captions are available and set `lectures.ingestion_status` to `'failed'`.

---

### Requirement 3: Transcript Chunking

**User Story:** As a developer, I want the transcript split into time-windowed chunks with overlap, so that concepts spanning a boundary are not missed during retrieval.

#### Acceptance Criteria

1. THE Chunker SHALL split a normalized transcript into windows of 75 seconds each, where each chunk covers the transcript text whose timestamps fall in the range `[timestamp_start, timestamp_end)`.
2. THE Chunker SHALL apply a 15-second overlap between consecutive chunks, so the last 15 seconds of chunk N are repeated at the start of chunk N+1.
3. THE Chunker SHALL advance the window start by 60 seconds per step (75 − 15), so chunk N has `timestamp_start = N * 60` (0-indexed).
4. THE Chunker SHALL assign `timestamp_start` and `timestamp_end` (in whole seconds) to every chunk.
5. FOR ALL consecutive chunk pairs produced from the same transcript, the `timestamp_start` of chunk N+1 SHALL equal `timestamp_end` of chunk N minus 15 seconds.
6. IF a transcript is shorter than 75 seconds and has at least one segment, THEN THE Chunker SHALL produce exactly one chunk whose `timestamp_start` is 0 and whose `timestamp_end` is the timestamp of the final segment rounded up to the nearest whole second.
7. IF a transcript is empty (zero segments), THEN THE Chunker SHALL produce zero chunks and return without error.
8. THE Chunker SHALL set `timestamp_end` of the final chunk to the timestamp of the last transcript segment rounded up to the nearest whole second, even if that results in a chunk shorter than 75 seconds.

---

### Requirement 4: Embedding Generation and Storage

**User Story:** As a developer, I want each chunk embedded and stored with its full-text search vector, so that both semantic and keyword retrieval are available.

#### Acceptance Criteria

1. WHEN a chunk is created, THE Embedding_Service SHALL generate a 768-dimensional embedding for the chunk text using the nomic-embed-text model.
2. THE System SHALL store the embedding in `chunks.embedding` as a `vector(768)` value.
3. THE System SHALL populate `chunks.fts_vector` using Postgres `to_tsvector('english', chunk.text)` on the chunk text.
4. THE System SHALL store embeddings such that re-embedding the same chunk text with the nomic-embed-text model produces a cosine similarity of at least 0.999 to the stored embedding.
5. IF the embedding API returns an error, THEN THE Ingestion_Service SHALL retry the request up to 3 times using exponential backoff with an initial delay of 1 second, doubling on each attempt up to a maximum delay of 8 seconds, before marking the lecture as `'failed'`.
6. WHEN a chunk is re-ingested for a lecture that already has a stored embedding, THE Embedding_Service SHALL regenerate and overwrite the existing embedding and `fts_vector` for that chunk.

---

### Requirement 5: RAG Query — Semantic Cache

**User Story:** As a student, I want repeated questions to be answered instantly from cache, so that common queries are fast and free of LLM cost.

#### Acceptance Criteria

1. WHEN a student submits a question, THE RAG_Query_Service SHALL embed the question using nomic-embed-text before any cache or search step.
2. WHEN the question embedding is ready, THE RAG_Query_Service SHALL query `semantic_cache` with a cosine similarity threshold of 0.92, filtered by the current `course_id` and `lecture_id`.
3. WHEN the similarity of the top cached embedding meets or exceeds 0.92, THE RAG_Query_Service SHALL return the cached `answer_text` within 200 milliseconds without calling the LLM.
4. WHEN the similarity of the top cached embedding is below 0.92, THE RAG_Query_Service SHALL proceed to hybrid search.
5. FOR ALL cache lookups, THE Semantic_Cache SHALL apply a `WHERE course_id = $1 AND lecture_id = $2` filter so that no cached answer from a different lecture can be returned.
6. IF the semantic cache query returns an error, THEN THE RAG_Query_Service SHALL log the error and proceed directly to hybrid search without returning an error to the student.
7. WHEN a new question results in a cache miss and the LLM generates an answer, THE RAG_Query_Service SHALL store the question embedding and answer text in `semantic_cache` before returning the final response.

---

### Requirement 6: RAG Query — Hybrid Search

**User Story:** As a student, I want the system to find the most relevant transcript chunks using both semantic and keyword signals, so that answers are accurate for both conceptual questions and exact-term lookups.

#### Acceptance Criteria

1. WHEN a cache miss occurs, THE RAG_Query_Service SHALL execute a pgvector cosine-similarity search on `chunks.embedding` returning the top 10 semantically similar chunks, filtered by `course_id` and `lecture_id`.
2. WHEN a cache miss occurs, THE RAG_Query_Service SHALL execute a Postgres tsvector BM25 full-text search on `chunks.fts_vector` returning the top 10 keyword-matching chunks, filtered by `course_id` and `lecture_id`.
3. THE RAG_Query_Service SHALL merge the vector search result set and the full-text search result set using Reciprocal Rank Fusion with constant k = 60.
4. THE RAG_Query_Service SHALL produce a single ranked list of at most 10 chunks from the RRF merge, ordered by descending RRF score.
5. IF one search branch (vector or full-text) returns zero results, THEN THE RAG_Query_Service SHALL compute the RRF score using only the non-empty result set without error.
6. IF both search branches return zero results, THEN THE RAG_Query_Service SHALL immediately return a static response stating the topic was not found in the lecture, without making any LLM call.

---

### Requirement 7: RAG Query — LLM Call and Streaming

**User Story:** As a student, I want to receive a streamed answer grounded in the lecture transcript, so that I can read the response as it is generated without waiting for the full completion.

#### Acceptance Criteria

1. WHEN the ranked chunk list is ready, THE RAG_Query_Service SHALL build a prompt consisting of a system message and a user message. The system message SHALL instruct the LLM to: (a) answer only from the provided transcript excerpts, (b) keep responses concise at 2-4 sentences unless a step-by-step explanation is required, (c) never use information from its training data, and (d) respond with "This topic was not covered in this lecture." if the excerpts do not contain the answer. The user message SHALL include the retrieved chunk texts followed by the student question.
2. WHEN the prompt is built, THE RAG_Query_Service SHALL call the Groq llama3-8b-8192 model and stream the token response via SSE to the Frontend.
3. IF the Groq llama3-8b-8192 model returns a 429 or 503 error, THEN THE RAG_Query_Service SHALL retry the call once with the mixtral-8x7b model before sending an error event to the Frontend.
4. WHEN the retrieved chunks contain no text relevant to the question (as indicated by the LLM), THE RAG_Query_Service SHALL stream the LLM's explicit "not found in lecture" response rather than a hallucinated answer.
5. IF the Groq API returns a non-retriable error (4xx other than 429), THEN THE RAG_Query_Service SHALL send an SSE error event to the Frontend containing the HTTP status code and a human-readable message, and terminate the stream.
6. IF the Groq API returns an error mid-stream after tokens have already been sent, THEN THE RAG_Query_Service SHALL send an SSE error event indicating a partial response and terminate the stream.
7. WHEN the LLM stream completes successfully, THE RAG_Query_Service SHALL save the question embedding and the full concatenated answer text to `semantic_cache`.

---

### Requirement 8: Timestamp Deeplinks and Citations

**User Story:** As a student, I want each answer to include clickable citations that jump to the exact second in the video where the trainer explains the concept, so that I can verify and study the source material.

#### Acceptance Criteria

1. WHEN an answer is assembled from retrieved chunks, THE RAG_Query_Service SHALL build a Deeplink for each source chunk using the format `{video_url}&t={timestamp_start}s`.
2. WHEN an answer is assembled from retrieved chunks, THE RAG_Query_Service SHALL include the full Deeplink list as a discrete payload delivered after the final streamed answer token, associating each citation with its `timestamp_start` value in seconds, and including no more than 10 citations per answer.
3. WHEN the Frontend receives a citation, THE Frontend SHALL render it as a clickable element displaying the timestamp in MM:SS format for durations under one hour, and in H:MM:SS format for durations of one hour or greater.
4. WHEN a student clicks a citation, THE Frontend SHALL seek the video player to the cited `timestamp_start` second.
5. IF a chunk has a `timestamp_start` of 0, THEN THE RAG_Query_Service SHALL still generate a valid Deeplink using `t=0s`.
6. IF a student clicks a citation and the video player is not yet initialized, THEN THE Frontend SHALL display an error message indicating the video is not ready and SHALL NOT attempt to seek.

---

### Requirement 9: Angular Frontend — Split-Screen Layout

**User Story:** As a student, I want a split-screen interface with the video on the left and a chat sidebar on the right, so that I can watch and ask questions simultaneously.

#### Acceptance Criteria

1. THE Frontend SHALL render a split-screen layout with the YouTube video player occupying between 55% and 70% of the viewport width on the left panel and the chat sidebar occupying the remaining viewport width on the right panel, with both panels filling 100% of the viewport height.
2. THE Frontend SHALL embed the YouTube video using the YouTube IFrame Player API, where the video player SHALL accept a YouTube video ID as its input and render a playable video within the left panel.
3. THE Frontend SHALL maintain chat message history in Angular component state for the duration of the browser session only; messages SHALL NOT be persisted to a database in the POC.
4. WHEN a student submits a question containing between 1 and 1000 characters, THE Frontend SHALL append the user message to the chat history and display a loading indicator within 200 milliseconds.
5. IF a student attempts to submit a question with 0 characters or more than 1000 characters, THEN THE Frontend SHALL disable the submit action and display an error message indicating the input length constraint.
6. WHEN SSE tokens are received, THE Frontend SHALL render each token incrementally so the answer text grows character-by-character within the same message bubble without creating a new bubble per token.
7. WHEN the SSE stream ends, THE Frontend SHALL append up to 10 citation links below the completed answer message, where each citation link displays the formatted timestamp and is clickable.
8. IF the SSE stream produces an error before completion, THEN THE Frontend SHALL stop the loading indicator, display an error message indicating the response could not be completed, and retain all previously displayed chat messages.

---

### Requirement 10: Multi-Tenancy Isolation

**User Story:** As a platform operator, I want every query strictly scoped to the current course and lecture, so that a student on Course A can never retrieve content from Course B.

#### Acceptance Criteria

1. THE System SHALL apply a `course_id` and `lecture_id` filter to every Supabase query that reads from `chunks` or `semantic_cache`, so that results contain only records matching the request's `course_id` and `lecture_id`.
2. IF a request is received without a valid `course_id`, THEN THE RAG_Query_Service SHALL return a 400 error response and not execute any database query.
3. IF a request is received without a valid `lecture_id`, THEN THE RAG_Query_Service SHALL return a 400 error response and not execute any database query.
4. IF a request is received with a `lecture_id` that does not belong to the specified `course_id`, THEN THE RAG_Query_Service SHALL return a 400 error response and not execute any database query.
5. THE System SHALL ensure that every response from the RAG query endpoint contains only records whose `course_id` matches the `course_id` supplied in the request.

---

### Requirement 11: Trainer Course and Lecture Management UI

**User Story:** As a trainer, I want a simple management interface to create courses and add lectures with YouTube URLs, so that I can set up content for students without needing direct database or API access.

#### Acceptance Criteria

1. THE Frontend SHALL provide a /trainer route that renders a course management page listing all existing courses with their titles.
2. WHEN a trainer visits the /trainer route, THE Frontend SHALL display a "Create Course" button that opens a form accepting a course title between 1 and 100 characters.
3. WHEN a trainer submits a valid course title, THE Frontend SHALL call POST /api/courses, display the new course in the list immediately, and show a success message.
4. IF a trainer submits a course title with 0 characters or more than 100 characters, THEN THE Frontend SHALL disable the submit action and display an error message indicating the title length constraint.
5. WHEN a trainer clicks on a course, THE Frontend SHALL navigate to /trainer/courses/:courseId and display a list of all lectures belonging to that course, showing each lecture's title, video URL, and ingestion_status.
6. WHEN a trainer is on the course detail page, THE Frontend SHALL display an "Add Lecture" button that opens a form accepting a lecture title (1-100 characters) and a YouTube URL.
7. WHEN a trainer submits a valid lecture form, THE Frontend SHALL call POST /api/courses/:courseId/lectures to create the lecture record, then immediately call POST /api/ingest to trigger ingestion, and display the new lecture with ingestion_status 'processing'.
8. WHEN a lecture's ingestion_status is 'processing', THE Frontend SHALL poll GET /api/courses/:courseId/lectures/:lectureId/status every 5 seconds and update the displayed status until it reaches 'ready' or 'failed'.
9. WHEN a lecture's ingestion_status reaches 'ready', THE Frontend SHALL display a clickable link that navigates to the student split-screen view (/lecture/:lectureId) for that lecture.
10. WHEN a lecture's ingestion_status is 'failed', THE Frontend SHALL display a "Retry" button that re-triggers ingestion for that lecture by calling POST /api/ingest again.
11. IF the POST /api/courses or POST /api/ingest call returns an error, THEN THE Frontend SHALL display the error message returned by the backend and retain the form values for correction.