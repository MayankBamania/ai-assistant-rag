# AI Assistant RAG

An in-course AI assistant sidebar for an e-learning platform. Students ask questions while watching a lecture and receive answers grounded strictly in the trainer's own words, with clickable citations that jump to the exact second in the video.

## Overview

- **Backend:** Node.js + LangChain.js
- **Frontend:** Angular (split-screen video player + chat sidebar)
- **Database:** Supabase (Postgres + pgvector)
- **LLM:** Groq (free tier)
- **Embeddings:** nomic-embed-text (768-dim)

## Documentation

See [architecture.md](./architecture.md) for the full system design, data flow, database schema, and build sequence.

## Project Structure

```
├── backend/      # Node.js + LangChain.js API
├── frontend/     # Angular application
└── architecture.md
```

## Getting Started

_Setup instructions will be added as the project is built out._
