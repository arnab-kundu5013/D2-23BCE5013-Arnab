import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { embedText } from '../services/embedding.service';
import { queryCollection } from '../services/vector.service';
import { extractImage } from '../services/ingest/image.extractor';
import { retrieveAll } from '../services/retrieval.service';
import { buildPrompt } from '../utils/prompt.builder';
import { buildCitations } from '../utils/citation.builder';
import { streamLlmResponse, generateLlmResponse } from '../services/llm.service';
import { env } from '../config/env';
import { createError } from '../middleware/error';
import logger from '../middleware/logger';

// ── Request validation ────────────────────────────────────────────────────────

const queryBodySchema = z.object({
    query: z.string().min(1).max(2000),
    topK: z.number().int().min(1).max(50).optional(),
    modalities: z.array(z.enum(['text', 'image', 'audio'])).optional(),
    fileIds: z.array(z.string()).optional(),
    stream: z.boolean().optional(),
});

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sendSSE(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── POST /api/query — Text query with SSE streaming ──────────────────────────

export async function handleTextQuery(req: Request, res: Response, next: NextFunction) {
    try {
        const parsed = queryBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return next(createError(
                `Invalid request: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
                400,
                'VALIDATION_ERROR',
            ));
        }

        const { query, topK, modalities, stream } = parsed.data;
        const effectiveTopK = topK ?? env.TOP_K;
        const effectiveModalities = modalities ?? ['text', 'image', 'audio'];
        const useStream = stream !== false; // default to true

        logger.info(`Text query: "${query.slice(0, 80)}..." topK=${effectiveTopK} stream=${useStream}`);

        // 1. Embed the user query
        const queryEmbedding = await embedText(query);

        // 2. Retrieve and fuse results via RRF
        const retrieval = await retrieveAll(queryEmbedding, effectiveTopK, effectiveModalities);

        if (retrieval.results.length === 0) {
            if (useStream) {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                });
                sendSSE(res, 'context', { results: [], crossModalLinks: [] });
                sendSSE(res, 'token', { text: 'No relevant documents found in the index. Please ingest some files first.' });
                sendSSE(res, 'citations', { citations: [] });
                sendSSE(res, 'done', { usage: { contextChunks: 0 } });
                res.end();
                return;
            }

            return res.json({
                answer: 'No relevant documents found in the index. Please ingest some files first.',
                citations: [],
                context: [],
            });
        }

        // 3. Build the LLM prompt
        const { systemPrompt, userPrompt, includedCount, droppedCount } = buildPrompt(query, retrieval.results);

        if (droppedCount > 0) {
            logger.debug(`Prompt builder dropped ${droppedCount} chunks to fit token budget`);
        }

        // 4. Build citations for the included context
        const citations = buildCitations(retrieval.results, includedCount);

        // 5. Stream or block
        if (useStream) {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no', // disable nginx buffering
            });

            // Send context chunks first
            sendSSE(res, 'context', {
                results: retrieval.results.slice(0, includedCount).map((r) => ({
                    id: r.id,
                    excerpt: r.document.slice(0, 300),
                    score: r.score,
                    modality: r.modality,
                    metadata: r.metadata,
                })),
                crossModalLinks: retrieval.crossModalLinks,
            });

            // Stream LLM tokens
            await new Promise<void>((resolve, reject) => {
                streamLlmResponse(systemPrompt, userPrompt, {
                    onToken: (token) => sendSSE(res, 'token', { text: token }),
                    onDone: (fullResponse) => {
                        sendSSE(res, 'citations', { citations });
                        sendSSE(res, 'done', {
                            usage: {
                                contextChunks: includedCount,
                                droppedChunks: droppedCount,
                                responseLength: fullResponse.length,
                            },
                        });
                        res.end();
                        resolve();
                    },
                    onError: (err) => {
                        sendSSE(res, 'error', { message: err.message });
                        res.end();
                        reject(err);
                    },
                });
            });
        } else {
            // Non-streaming: wait for full response
            const answer = await generateLlmResponse(systemPrompt, userPrompt);

            res.json({
                answer,
                citations,
                context: retrieval.results.slice(0, includedCount).map((r) => ({
                    id: r.id,
                    excerpt: r.document.slice(0, 300),
                    score: r.score,
                    modality: r.modality,
                    metadata: r.metadata,
                })),
                crossModalLinks: retrieval.crossModalLinks,
                usage: { contextChunks: includedCount, droppedChunks: droppedCount },
            });
        }
    } catch (err) {
        next(err);
    }
}

// ── POST /api/query/image — Image cross-modal search ──────────────────────────

export async function handleImageQuery(req: Request, res: Response, next: NextFunction) {
    try {
        const file = req.file as Express.Multer.File | undefined;
        if (!file) {
            return next(createError('No image file uploaded. Send a single image in the "file" field.', 400, 'NO_FILE'));
        }

        const topK = Number(req.body?.topK ?? env.TOP_K);
        logger.info(`Image query received: ${file.originalname}, topK=${topK}`);

        const imageResult = await extractImage(file.path);
        const queryText = imageResult.captionText || `image file: ${file.originalname}`;
        const queryEmbedding = await embedText(queryText);

        const [textResults, imageResults, audioResults] = await Promise.all([
            queryCollection('TEXT', queryEmbedding, topK),
            queryCollection('IMAGE', queryEmbedding, topK),
            queryCollection('AUDIO', queryEmbedding, topK),
        ]);

        res.json({
            queryImage: file.originalname,
            caption: imageResult.captionText,
            topK,
            results: {
                text: textResults.map((r) => ({
                    id: r.id,
                    excerpt: r.document.slice(0, 300),
                    score: 1 - r.distance,
                    metadata: r.metadata,
                })),
                image: imageResults.map((r) => ({
                    id: r.id,
                    caption: r.document.slice(0, 300),
                    score: 1 - r.distance,
                    metadata: r.metadata,
                })),
                audio: audioResults.map((r) => ({
                    id: r.id,
                    transcript: r.document.slice(0, 300),
                    score: 1 - r.distance,
                    metadata: r.metadata,
                })),
            },
        });
    } catch (err) {
        next(err);
    }
}
