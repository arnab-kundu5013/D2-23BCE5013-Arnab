# OmniSearch Backend

Offline, AI-powered Multimodal RAG platform. Upload PDFs, DOCX, images, and audio files — then ask questions and get cited, grounded answers from a locally running LLM.

## Tech Stack

- **Node.js + TypeScript + Express**
- **SQLite** (via Knex) — file metadata
- **ChromaDB** — vector storage
- **Ollama** — local LLM, embeddings, and image captioning
- **Whisper.cpp** — audio transcription (optional)

## Prerequisites

1. **Node.js** 18+
2. **ChromaDB** — `pip install chromadb` then `chroma run --host localhost --port 8000`
3. **Ollama** — install from [ollama.com](https://ollama.com), then:
   ```bash
   ollama pull nomic-embed-text
   ollama pull llama3.1:8b
   ollama pull llava:7b
   ```

## Setup & Run

```bash
cd omnisearch-backend
npm install
cp .env.example .env
npm run dev
```

Server starts on **http://localhost:3001**

## API Endpoints

### Health
```
GET /api/health
```

### Upload Files
```
POST /api/ingest
Content-Type: multipart/form-data
Key: files → attach PDF, DOCX, PNG, JPG, MP3, WAV
```

### Check Upload Status
```
GET /api/ingest/:fileId/status
```

### Ask a Question
```
POST /api/query
Content-Type: application/json
{ "query": "What is the budget?", "stream": false }
```

### Image Search
```
POST /api/query/image
Content-Type: multipart/form-data
Key: file → attach an image
```

### File Management
```
GET    /api/files              — list all files
GET    /api/files/stats        — system stats
GET    /api/files/:id          — file details
DELETE /api/files/:id          — delete file
GET    /api/files/:id/download — download original
GET    /api/files/:id/chunks   — view indexed chunks
GET    /api/files/links        — cross-modal links
```

## How It Works

```
Upload → Extract text/caption/transcript → Chunk → Embed → Store in ChromaDB
                                                                    ↓
Query → Embed question → Search all collections → Fuse results → LLM generates answer with citations
```

## Project Structure

```
src/
├── config/          — env validation, constants
├── controllers/     — request handlers
├── db/              — SQLite setup + queries
├── middleware/       — error handler, logger, file upload
├── routes/          — Express route definitions
├── services/
│   ├── ingest/      — PDF, DOCX, image, audio extractors + chunker
│   ├── embedding    — Ollama embeddings
│   ├── vector       — ChromaDB client
│   ├── retrieval    — multi-collection search + RRF ranking
│   ├── llm          — Ollama LLM streaming
│   ├── crossmodal   — cross-modal link detection
│   └── processor    — direct file processing
├── utils/           — prompt builder, citation builder
├── app.ts           — Express app setup
└── server.ts        — entry point
```

## License

MIT
