# Design Document: AI Assistant RAG

## Overview

An in-course AI assistant sidebar for an e-learning platform. Students ask questions while watching a lecture and receive answers grounded strictly in the trainer's transcript, delivered as a streamed response with clickable timestamp citations that jump to the exact second in the video.

### Goals

- Answer student questions using **only** the current lecture's transcript — no hallucination from LLM training data.
- Keep inference costs low via a semantic cache that short-circuits the LLM for repeated or paraphrased questions.
- Provide verifiable citations: every answer links back to the transcript segment it came from.
- Enforce hard multi-tenant isolation: a student on Course A can never receive content from Course B.

### Scope (POC)

| In scope | Out of scope (post-POC) |
|---|---|
| YouTube URL ingestion via `youtube-transcript` | Whisper / file-upload ingestion path |
| Hybrid RAG query (pgvector + BM25 + RRF) | Student authentication and persistent chat history |
| SSE streaming to Angular | Paid LLM / embedding providers |
| Semantic cache | Admin UI for lecture management |

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Angular Frontend                       │
│  ┌──────────────────────┐  ┌──────────────────────────┐ │
│  │   YouTube IFrame     │  │     Chat Sidebar         │ │
│  │   Player (left)      │  │  (SSE streaming, right)  │ │
│  └──────────────────────┘  └──────────┬───────────────┘ │
└─────────────────────────────────────── │ ────────────────┘
                                         │ SSE + REST
┌─────────────────────────────────────── │ ────────────────┐
│                Node.js Backend          │                  │
│  ┌──────────────────────┐  ┌──────────▼───────────────┐ │
│  │  Ingestion Service   │  │   RAG Query Service       │ │
│  │  (trainer-facing)    │  │   (student-facing)        │ │
│  └──────────┬───────────┘  └──────────┬───────────────┘ │
└─────────────│──────────────────────── │ ────────────────┘
              │                         │
              ▼                         ▼
┌─────────────────────────────────────────────────────────┐
│               Supabase (Postgres + pgvector)             │
│   courses · lectures · chunks · semantic_cache           │
└─────────────────────────────────────────────────────────┘
              │                         │
              ▼                         ▼
   nomic-embed-text (768-dim)    Groq LLM (llama3 / mixtral)
```

### Service Boundaries

| Service | Responsibility | Trigger |
|---|---|---|
| Ingestion Service | Fetch YouTube transcript, chunk, embed, store | Trainer HTTP POST |
| RAG Query Service | Answer student questions end-to-end with streaming | Student HTTP GET (SSE) |
| Embedding Service | Shared nomic-embed-text wrapper with retry logic | Called by both services |
| Chunker | Split normalized transcript into time-windowed segments | Called by Ingestion Service |

---

## Components and Interfaces

### Backend — Node.js + LangChain.js

#### Folder Structure

```
backend/
  src/
    routes/           # HTTP layer: parse request, validate inputs, set headers, call controller
    controllers/      # Orchestration layer: coordinate services, handle request/response flow
    services/         # Business logic: chunker, embeddings, RAG pipeline, ingestion orchestration
    repositories/     # Data access layer: all Supabase queries — nothing else touches the DB
    types/            # Shared TypeScript interfaces
    db/               # Supabase client singleton
    app.ts            # Express app: middleware, route mounting
    index.ts          # Server entry point
```

#### Backend Layered Architecture

Each layer has a single responsibility. Nothing outside `repositories/` touches the database.

**Routes** (`src/routes/`)
- Parse and forward HTTP requests to the appropriate controller
- Set SSE response headers for the query endpoint
- No business logic

**Controllers** (`src/controllers/`)
- `ingestionController.ts` — validates URL presence, calls `ingestionService`, returns response
- `queryController.ts` — validates `courseId`/`lectureId` presence and ownership, delegates to `ragQueryService`
- `courseController.ts` — handles course CRUD, calls `courseRepository` directly (thin CRUD, no business logic)
- `lectureController.ts` — handles lecture creation + ingestion trigger, status polling endpoint

**Services** (`src/services/`)
- `embeddingService.ts` — nomic-embed-text wrapper with retry logic; shared singleton
- `chunker.ts` — pure transcript chunking logic, no I/O
- `ingestionService.ts` — orchestrates: fetch transcript → chunk → embed → store (calls repositories)
- `ragQueryService.ts` — orchestrates: cache check → hybrid search → RRF → LLM stream → citations → cache save (calls repositories)

**Repositories** (`src/repositories/`)
- `courseRepository.ts` — `insertCourse`, `getAllCourses`
- `lectureRepository.ts` — `insertLecture`, `getLecturesByCourse`, `getLectureStatus`, `updateIngestionStatus`
- `chunkRepository.ts` — `insertChunk`, `vectorSearch`, `ftsSearch`, `upsertChunk`
- `cacheRepository.ts` — `findSimilarQuestion`, `saveToCache`

**Data flow:**

```
Request → Route → Controller → Service → Repository → Supabase
```

Example for RAG query:
```
GET /api/query
  → routes/query.ts                    (set SSE headers)
  → controllers/queryController.ts     (validate courseId/lectureId ownership)
  → services/ragQueryService.ts        (cache → search → RRF → LLM → citations)
  → repositories/cacheRepository.ts    (cosine similarity query)
  → repositories/chunkRepository.ts    (pgvector + tsvector queries)
```

---

#### Ingestion Service

```
POST /api/ingest
Body: { courseId: string, lectureId: string, youtubeUrl: string }
Response: { lectureId: string, status: "processing" }
```

**Internal flow:**
1. Validate YouTube URL format → extract video ID
2. Set `lectures.ingestion_status = 'processing'`
3. Fetch captions via `youtube-transcript` package
4. Normalize timestamps (ms → whole seconds via `Math.floor`)
5. Pass normalized transcript to Chunker
6. For each chunk: call Embedding Service → insert into `chunks`
7. Set `lectures.ingestion_status = 'ready'`

**Error paths:**
- Invalid URL format → 400, status = `'failed'`
- No captions returned → 422, status = `'failed'`
- Embedding API failure after retries → status = `'failed'`

#### RAG Query Service

```
GET /api/query?courseId=X&lectureId=Y&question=Z
Response: SSE stream
  data: {"type": "token", "content": "..."}
  data: {"type": "citations", "items": [{"timestamp": 83, "url": "..."}]}
  data: {"type": "done"}
  data: {"type": "error", "status": 429, "message": "..."}
```

**Internal flow:**
1. Validate `courseId` and `lectureId` presence and ownership → 400 on failure
2. Embed question via Embedding Service
3. Query `semantic_cache` with cosine threshold 0.92, scoped to `course_id + lecture_id`
   - **HIT**: stream cached answer as tokens, send citations, send `done` — return
4. Execute Hybrid Search (pgvector top-10 + tsvector top-10)
5. Merge via RRF (k=60), take top-10 merged chunks
6. If both branches returned zero results → stream static "not found" message, send `done` — return (no LLM call)
7. Build prompt (system message + chunk texts + student question)
8. Stream Groq llama3-8b-8192 response via SSE
   - On 429/503 → retry once with mixtral-8x7b
   - On other 4xx → send `error` event, terminate stream
   - On mid-stream error → send `error` event indicating partial response, terminate stream
9. Build deeplinks from retrieved chunk metadata
10. Send `citations` event (max 10 citations)
11. Save question embedding + full answer to `semantic_cache`
12. Send `done` event

#### Embedding Service

```typescript
interface EmbeddingService {
  embed(text: string): Promise<number[]>; // 768-dim vector
}
```

- Uses `nomic-embed-text` via Ollama local endpoint or the Nomic API
- Retry policy: up to 3 attempts, exponential backoff starting at 1s, doubling each attempt, capped at 8s (delays: 1s → 2s → 4s, never exceeding 8s)
- Single shared instance used by both Ingestion Service and RAG Query Service to guarantee embedding model consistency

#### Chunker

```typescript
interface TranscriptSegment {
  text: string;
  start: number; // seconds (normalized)
}

interface Chunk {
  text: string;
  timestamp_start: number; // seconds
  timestamp_end: number;   // seconds
}

interface Chunker {
  chunk(segments: TranscriptSegment[]): Chunk[];
}
```

**Algorithm:**
- Window: 75 seconds, overlap: 15 seconds, step: 60 seconds
- `timestamp_start` of chunk N = `N * 60` (0-indexed)
- Collect all segments where `segment.start >= window_start && segment.start < window_start + 75`
- `timestamp_end` of last chunk = `ceil(last_segment.start)` in whole seconds
- Empty input → return `[]`
- Input shorter than 75s → return exactly one chunk from 0 to `ceil(last_segment.start)`

### Frontend — Angular

#### Module Structure

```
AppModule
  ├── LecturePageComponent        # Top-level split-screen host
  │     ├── VideoPlayerComponent  # YouTube IFrame API wrapper (left panel)
  │     └── ChatSidebarComponent  # SSE chat UI (right panel)
  │           ├── MessageListComponent
  │           ├── MessageBubbleComponent
  │           └── CitationListComponent
  └── SharedModule
        └── TimestampPipe          # Formats seconds to MM:SS or H:MM:SS
```

#### VideoPlayerComponent

- Loads YouTube IFrame Player API dynamically
- Exposes `seekTo(seconds: number): void` — called by CitationListComponent on click
- Emits `playerReady` event; citations are disabled until this event fires
- Accepts `videoId: string` as input

#### ChatSidebarComponent

- Maintains `messages: Message[]` in component state (not persisted)
- Input validation: 1–1000 characters; submit disabled outside this range
- On submit: appends user message to `messages`, shows loading indicator, opens SSE connection
- Handles SSE events:
  - `token` → appends content to the current assistant message bubble (same bubble, no new element per token)
  - `citations` → stores citation list to attach after stream ends
  - `done` → hides loading indicator, attaches citations below the completed message
  - `error` → hides loading indicator, appends error message, retains prior messages

#### SSE Client

- Uses native `EventSource` or `fetch` with `ReadableStream` (required if query params carry the question)
- Reconnect is **not** automatic on disconnect during an active query (stream is request-scoped)

### LangChain.js Integration

LangChain.js is used for:
- `ChatGroq` — Groq LLM provider with streaming support
- `OllamaEmbeddings` or `NomicEmbeddings` — nomic-embed-text wrapper
- Prompt template construction (`ChatPromptTemplate`)

LangChain is **not** used for retrieval orchestration — hybrid search and RRF are implemented directly against Supabase to maintain precise control over the `course_id + lecture_id` filter.

---

## Data Models

### Database Schema (Supabase / Postgres)

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Courses
CREATE TABLE courses (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  title text NOT NULL
);

-- Lectures
CREATE TABLE lectures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  course_id        uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title            text NOT NULL,
  video_type       text NOT NULL,  -- 'youtube' | 'upload'
  video_url        text NOT NULL,
  ingestion_status text NOT NULL   -- 'pending' | 'processing' | 'ready' | 'failed'
);

ALTER TABLE lectures
  ADD CONSTRAINT lectures_ingestion_status_check
  CHECK (ingestion_status IN ('pending', 'processing', 'ready', 'failed'));

-- Chunks
CREATE TABLE chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  lecture_id      uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  course_id       uuid NOT NULL,  -- denormalized for fast filtering, avoids JOINs
  text            text NOT NULL,
  embedding       vector(768) NOT NULL,
  fts_vector      tsvector NOT NULL,
  timestamp_start integer NOT NULL,
  timestamp_end   integer NOT NULL,
  CONSTRAINT chunks_timestamp_start_check CHECK (timestamp_start >= 0),
  CONSTRAINT chunks_timestamp_end_check   CHECK (timestamp_end >= timestamp_start)
);

-- Auto-populate fts_vector via trigger
CREATE OR REPLACE FUNCTION chunks_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts_vector := to_tsvector('english', NEW.text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chunks_fts_trigger
  BEFORE INSERT OR UPDATE ON chunks
  FOR EACH ROW EXECUTE FUNCTION chunks_fts_update();

-- Semantic Cache
CREATE TABLE semantic_cache (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  lecture_id         uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  course_id          uuid NOT NULL,  -- denormalized for fast filtering
  question_text      text NOT NULL,  -- human-readable, for debugging
  question_embedding vector(768) NOT NULL,
  answer_text        text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT current_timestamp
);

-- Indexes
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON chunks USING GIN (fts_vector);
CREATE INDEX ON chunks (course_id);

CREATE INDEX ON semantic_cache USING hnsw (question_embedding vector_cosine_ops);
```

### Application-Level TypeScript Types

```typescript
interface Course {
  id: string;
  title: string;
}

interface Lecture {
  id: string;
  course_id: string;
  title: string;
  video_type: 'youtube' | 'upload';
  video_url: string;
  ingestion_status: 'pending' | 'processing' | 'ready' | 'failed';
}

interface Chunk {
  id: string;
  lecture_id: string;
  course_id: string;
  text: string;
  embedding: number[];       // 768-dim
  timestamp_start: number;   // seconds
  timestamp_end: number;     // seconds
}

interface SemanticCacheEntry {
  id: string;
  lecture_id: string;
  course_id: string;
  question_text: string;
  question_embedding: number[];  // 768-dim
  answer_text: string;
  created_at: string;            // ISO 8601
}

interface Citation {
  timestamp: number;  // seconds
  url: string;        // deeplink: {video_url}&t={timestamp}s
}

interface QuerySSEPayload {
  type: 'token' | 'citations' | 'done' | 'error';
  content?: string;           // type === 'token'
  items?: Citation[];         // type === 'citations'
  status?: number;            // type === 'error'
  message?: string;           // type === 'error'
}
```

### Hybrid Search — RRF Implementation

```typescript
// Inputs: vector_results and fts_results are arrays of chunk IDs in rank order
function reciprocalRankFusion(
  vector_results: string[],
  fts_results: string[],
  k = 60,
  topN = 10
): string[] {
  const scores = new Map<string, number>();

  const accumulate = (ranked: string[]) => {
    ranked.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  };

  accumulate(vector_results);
  accumulate(fts_results);

  return [...scores.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([id]) => id);
}
```

### LLM Prompt Structure

```
System message:
  You are a course assistant. Answer the student's question using ONLY the
  transcript excerpts provided below. Keep your response to 2-4 sentences
  unless a step-by-step explanation is genuinely required. Never use
  information from your training data. If the excerpts do not contain the
  answer, respond with exactly: "This topic was not covered in this lecture."

User message:
  Transcript excerpts:
  [Excerpt 1 — {timestamp_start}s to {timestamp_end}s]
  {chunk.text}

  [Excerpt 2 — ...]
  {chunk.text}

  ...

  Student question: {question}
```

### Timestamp Deeplink Format

```
Deeplink = {lecture.video_url}&t={chunk.timestamp_start}s

Example:
  video_url  = https://www.youtube.com/watch?v=dQw4w9WgXcQ
  deeplink   = https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=83s
```

### Citation Display Format (Angular `TimestampPipe`)

```
timestamp < 3600 seconds  →  MM:SS   (e.g. 1:23)
timestamp >= 3600 seconds →  H:MM:SS (e.g. 1:23:45)
```

---

## Trainer Management UI

### Routes

| Route | Component | Purpose |
|---|---|---|
| `/trainer` | `TrainerDashboardComponent` | Lists all courses, create course button |
| `/trainer/courses/:courseId` | `CourseDetailComponent` | Lists lectures for a course, add lecture form |
| `/lecture/:lectureId` | `LecturePageComponent` | Student split-screen view (existing) |

### Backend API Additions

POST /api/courses � Body: { title } � Returns: { id, title }
GET /api/courses � Returns: { courses: Course[] }
POST /api/courses/:courseId/lectures � Body: { title, youtubeUrl } � Returns lecture record
GET /api/courses/:courseId/lectures � Returns: { lectures: Lecture[] }
GET /api/courses/:courseId/lectures/:lectureId/status � Returns: { lectureId, ingestionStatus }

NOTE: POST /api/ingest is called internally by the backend after lecture creation. The frontend only calls the lecture creation endpoint.

### Angular Module Structure (updated)

TrainerModule (lazy-loaded at /trainer)
  - TrainerDashboardComponent: course list + create course form
  - CourseDetailComponent: lecture list + add lecture form
    - LectureRowComponent: single lecture row with status badge and retry button

### TrainerDashboardComponent

- On init: calls GET /api/courses, renders course list
- Create Course button opens inline form, title 1-100 chars
- On submit: calls POST /api/courses, appends new course, shows success toast
- Each course row links to /trainer/courses/:courseId

### CourseDetailComponent

- On init: calls GET /api/courses/:courseId/lectures, renders lecture rows
- Each lecture row shows: title, YouTube URL, ingestion status badge
  - processing: blue spinner badge
  - ready: green badge + Open link to /lecture/:lectureId
  - failed: red badge + Retry button
- Add Lecture button opens inline form: title (1-100 chars) + YouTube URL
- On submit: calls POST /api/courses/:courseId/lectures, appends row with processing status, starts polling
- Status polling: every 5 seconds calls GET .../status for processing lectures; stops at ready or failed
- Retry button: calls POST /api/ingest with existing lectureId and youtubeUrl, resets to processing, resumes polling

### Ingestion Status Badge States

pending    - grey  - Pending
processing - blue  - Processing... + spinner
ready      - green - Ready + Open link
failed     - red   - Failed + Retry button

### Navigation Flow

/trainer -> click course -> /trainer/courses/:courseId -> lecture ready -> /lecture/:lectureId
