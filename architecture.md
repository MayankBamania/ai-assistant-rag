# AI Assistant RAG — Architecture

An in-course AI assistant sidebar for an e-learning platform. Students can ask questions while watching a lecture and receive answers grounded strictly in the trainer's own words, with clickable citations that jump to the exact second in the video.

---

## Core Concept

```
Student asks: "What is a closure?"
      │
      ▼
System searches only the transcript of the current lecture
      │
      ▼
LLM answers using the trainer's exact explanation
      │
      ▼
Answer includes a citation: "As explained at 1:23 → [Watch here]"
      │
      ▼
Student clicks → video jumps to 1:23
```

---

## Tech Stack

| Layer         | Technology                                      |
|---------------|-------------------------------------------------|
| Frontend      | Angular                                         |
| Backend       | Node.js + LangChain.js                          |
| Database      | Supabase (Postgres + pgvector)                  |
| Embeddings    | nomic-embed-text (768-dim) — free               |
| Transcription | Groq Whisper large-v3 — free tier (2hr/day)     |
| LLM           | Groq llama3-8b-8192 or mixtral-8x7b — free tier |

---

## System Architecture

### Frontend — Angular

```
Split-screen layout
  ├── Left:  Video player (YouTube embed or HTML5 video)
  └── Right: Chat sidebar
               ├── Message history (frontend state only, not persisted)
               ├── Streaming token-by-token response
               └── Clickable timestamp citations → jumps to exact second in video
```

> Chat messages are kept in Angular component state during the session only.
> Persistence across sessions (with a chat_messages table) is a post-POC addition
> that requires student auth to be in place first.

---

### Backend — Node.js + LangChain.js

```
├── Ingestion Service
│     │
│     ├── YouTube path (POC — primary)
│     │     ├── Accept YouTube video URL from trainer
│     │     ├── Extract video ID from URL
│     │     ├── Fetch captions via youtube-transcript npm package
│     │     ├── Normalize timestamps (milliseconds → seconds)
│     │     └── Feed normalized transcript into shared chunker
│     │
│     │
│     │   // TODO: Whisper path (post-POC — implement when testing uploaded videos)
│     │   // Flow:
│     │   //   1. Receive uploaded video file from trainer
│     │   //   2. Store file in Supabase Storage → get back a public URL
│     │   //   3. Save public URL to lectures.video_url for student playback
│     │   //   4. Send file to Groq Whisper large-v3 API (max 25MB per request)
│     │   //      Note: for larger files, split audio into segments via ffmpeg first
│     │   //   5. Receive timestamped transcript from Whisper
│     │   //   6. Feed into shared chunker (same as YouTube path)
│     │
│     │
│     └── Shared Chunker (used by both YouTube and Whisper paths)
│           ├── Time-based windows: 75 seconds per chunk
│           ├── 15 second overlap between consecutive chunks
│           │     (prevents concepts split across a chunk boundary from being missed)
│           ├── Generate embedding per chunk via nomic-embed-text (768-dim)
│           └── Store chunk + embedding + timestamps in Supabase chunks table
│
│
├── RAG Query Service
│     │
│     ├── Step 1: Embed the incoming student question
│     │     └── Use same embedding model as ingestion (nomic-embed-text)
│     │
│     ├── Step 2: Semantic cache check
│     │     ├── Run cosine similarity against cached question embeddings
│     │     ├── Filter strictly by course_id + lecture_id
│     │     ├── Similarity threshold: 0.92
│     │     │     (catches paraphrases like "what is X" vs "explain X" vs "define X")
│     │     ├── HIT  → return cached answer instantly at $0 LLM cost
│     │     └── MISS → continue to hybrid search
│     │
│     ├── Step 3: Hybrid search (on cache MISS)
│     │     ├── Vector search via pgvector
│     │     │     → finds chunks that are conceptually/semantically similar
│     │     ├── BM25 Full-Text Search via pg tsvector
│     │     │     → finds chunks with exact keyword matches (code, error messages, package names)
│     │     ├── Both searches filtered by course_id + lecture_id
│     │     └── Merge both result sets using Reciprocal Rank Fusion (RRF)
│     │           → no reranker model needed, pure math, zero extra cost
│     │
│     ├── Step 4: LLM call
│     │     ├── Model: Groq llama3-8b-8192 or mixtral-8x7b
│     │     ├── Prompt includes retrieved chunks as context only
│     │     ├── Strict instruction: answer only from the provided context
│     │     ├── If context does not contain the answer → say so explicitly
│     │     │     (prevents hallucination from LLM training data)
│     │     └── Stream tokens back to Angular frontend via SSE
│     │
│     └── Step 5: Post-response
│           ├── Build timestamp deeplinks from retrieved chunk metadata
│           │     format: {video_url}&t={timestamp_start}s
│           │     example: https://youtube.com/watch?v=xyz&t=125s
│           └── Save question + answer to semantic_cache for future hits
│
│
└── Multi-tenancy guard
      └── Every search query enforces WHERE course_id = $1 filter
            (a student on Course A can never retrieve content from Course B)
```

---

### Database — Supabase (Postgres + pgvector)

```sql
-- Courses
courses
  ├── id          uuid, primary key
  └── title       text

-- Lectures (one course has many lectures, each lecture = one video)
lectures
  ├── id                uuid, primary key
  ├── course_id         uuid → courses.id
  ├── title             text
  ├── video_type        text  -- 'youtube' | 'upload'
  ├── video_url         text  -- YouTube URL or Supabase Storage URL
  └── ingestion_status  text  -- 'pending' | 'processing' | 'ready' | 'failed'

-- Chunks (transcript segments with embeddings)
chunks
  ├── id               uuid, primary key
  ├── lecture_id       uuid → lectures.id
  ├── course_id        uuid → courses.id  (denormalized for fast filtering, avoids JOINs)
  ├── text             text
  ├── embedding        vector(768)         -- for pgvector similarity search
  ├── fts_vector       tsvector            -- for BM25 full-text search
  ├── timestamp_start  integer             -- seconds
  └── timestamp_end    integer             -- seconds

-- Semantic cache
semantic_cache
  ├── id                  uuid, primary key
  ├── lecture_id          uuid → lectures.id
  ├── course_id           uuid → courses.id  (denormalized for fast filtering)
  ├── question_text       text               (human-readable, for debugging)
  ├── question_embedding  vector(768)        (for cosine similarity lookup)
  ├── answer_text         text
  └── created_at          timestamptz
```

**Key indexes:**
- `chunks.embedding` → ivfflat or hnsw index for ANN vector search
- `chunks.fts_vector` → GIN index for full-text search
- `chunks.course_id` → btree index for metadata filtering
- `semantic_cache.question_embedding` → ivfflat index for similarity lookup

---

## Data Flow

### Ingestion Flow

```
Trainer adds a YouTube URL
  → Backend extracts video ID
  → youtube-transcript fetches captions with timestamps
  → Chunker splits into 75s windows with 15s overlap
  → Each chunk is embedded (nomic-embed-text)
  → Chunks stored in Supabase with timestamp_start, timestamp_end
  → lecture.ingestion_status updated to 'ready'
```

### Query Flow

```
Student asks a question while watching Lecture 4
  → Backend embeds the question
  → Check semantic_cache WHERE course_id = X AND lecture_id = 4
      → HIT:  return cached answer immediately
      → MISS: run hybrid search on chunks table
                → pgvector search (top-k by cosine similarity)
                → tsvector BM25 search (top-k by text rank)
                → merge with RRF
              → build prompt with top chunks as context
              → call Groq LLM, stream tokens via SSE to Angular
              → attach timestamp deeplinks to response
              → save Q+A to semantic_cache
```

---

## AI Models

### POC (Free Tier)

| Purpose       | Model                  | Limit                  |
|---------------|------------------------|------------------------|
| Embeddings    | nomic-embed-text 768   | Free, no limit         |
| Transcription | Groq Whisper large-v3  | 2 hours audio per day  |
| LLM           | Groq llama3-8b-8192    | Free tier, rate limited|

### Production (Paid)

| Purpose       | Model                          |
|---------------|--------------------------------|
| Embeddings    | OpenAI text-embedding-3-small  |
| Transcription | AssemblyAI or AWS Transcribe   |
| LLM           | Groq paid / GPT-4o / Claude    |

> The architecture does not change between POC and production.
> Only the provider behind each interface is swapped.

---

## Build Sequence

```
1. Supabase setup
     → Enable pgvector extension
     → Create tables: courses, lectures, chunks, semantic_cache
     → Create indexes (ivfflat, GIN, btree)

2. Ingestion service — YouTube path
     → URL parsing and video ID extraction
     → youtube-transcript integration
     → Timestamp normalization
     → Chunker (75s windows, 15s overlap)
     → Embedding generation (nomic-embed-text)
     → Supabase insert

3. RAG query service
     → Question embedding
     → Semantic cache check
     → Hybrid search (pgvector + tsvector + RRF)
     → Groq LLM call with strict context-only prompt
     → SSE streaming to frontend
     → Deeplink citation builder
     → Cache save on MISS

4. Angular frontend
     → Video player (YouTube embed)
     → Chat sidebar with streaming render
     → Clickable timestamp citations

5. End-to-end test
     → Ingest a real YouTube course video
     → Ask questions via the chat sidebar
     → Verify answers are grounded in transcript
     → Verify citations jump to correct timestamp
     → Verify cache hit on repeated question

6. Whisper path (post-POC)
     → See TODO in Ingestion Service above
```

---

## Chunking Strategy

Time-based chunking is used instead of token-based chunking because the source material is a video transcript where every word has a timestamp attached.

```
Token chunking  → splits by word count, loses timestamp links
Time chunking   → splits by seconds, preserves timestamp links for citations
```

**Parameters:**
- Window: 75 seconds
- Overlap: 15 seconds (last 15s of chunk N repeated at start of chunk N+1)
- Step: 60 seconds (75 - 15)

The overlap prevents concepts that span a chunk boundary from being missed during retrieval.

---

## Hybrid Search — How RRF Works

Vector search and BM25 each return a ranked list of chunks. RRF merges them:

```
RRF score = 1/(k + rank_vector) + 1/(k + rank_bm25)
  where k = 60 (standard constant)
```

Chunks that rank well in both searches float to the top. No reranker model is needed — it is pure arithmetic, zero extra inference cost.

---

## Semantic Cache — How Similarity Threshold Works

```
Threshold 0.99 → near-exact match only, cache rarely hits
Threshold 0.92 → catches paraphrases, good balance  ✓
Threshold 0.85 → too loose, risks wrong cached answers
```

Same question asked 500 times by 500 students = 1 LLM call + 499 cache hits.
