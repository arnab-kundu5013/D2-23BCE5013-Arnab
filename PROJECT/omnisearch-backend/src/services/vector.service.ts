import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { COLLECTIONS } from '../config/constants';
import logger from '../middleware/logger';

// ChromaDB v2 API base — with default tenant and database
const CHROMA_BASE = `${env.CHROMA_HOST}/api/v2/tenants/default_tenant/databases/default_database/collections`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type CollectionName = 'TEXT' | 'IMAGE' | 'AUDIO';

export interface TextChunkMeta {
    fileId: string;
    fileName: string;
    chunkIndex: number;
    pageNumber: number;
    charStart: number;
    charEnd: number;
    modality: 'text';
}

export interface ImageChunkMeta {
    fileId: string;
    fileName: string;
    imagePath: string;
    width: number;
    height: number;
    captionText: string;
    ocrText: string;
    modality: 'image';
}

export interface AudioChunkMeta {
    fileId: string;
    fileName: string;
    startSec: number;
    endSec: number;
    speakerLabel: string;
    modality: 'audio';
}

export type ChunkMeta = TextChunkMeta | ImageChunkMeta | AudioChunkMeta;

export interface UpsertPayload {
    ids: string[];
    embeddings: number[][];
    documents: string[];
    metadatas: Record<string, string | number>[];
}

export interface QueryResult {
    id: string;
    document: string;
    metadata: Record<string, string | number>;
    distance: number;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

// Cache: collection name → UUID that chromaDB assigned
const collectionIdCache = new Map<string, string>();

/**
 * Ensure a ChromaDB collection exists and grab its server-assigned UUID.
 * The v2 API returns 200 if it already exists.
 */
async function ensureCollection(name: CollectionName): Promise<string> {
    const collName = COLLECTIONS[name];
    const cached = collectionIdCache.get(collName);
    if (cached) return cached;

    // Try to create — will succeed or return existing
    try {
        const resp = await axios.post(
            CHROMA_BASE,
            {
                name: collName,
                metadata: { 'hnsw:space': 'cosine' },
            },
            { timeout: 10_000 },
        );
        const id = resp.data?.id ?? collName;
        collectionIdCache.set(collName, id);
        return id;
    } catch (err: unknown) {
        // If create fails because it already exists, try to get it
        if (axios.isAxiosError(err) && err.response?.status === 409) {
            const resp = await axios.get(`${CHROMA_BASE}/${collName}`, { timeout: 10_000 });
            const id = resp.data?.id ?? collName;
            collectionIdCache.set(collName, id);
            return id;
        }
        throw err;
    }
}

function collectionUrl(collectionId: string): string {
    return `${CHROMA_BASE}/${collectionId}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Upsert a batch of chunks (with embeddings) into the named collection.
 */
export async function upsertChunks(
    collection: CollectionName,
    fileId: string,
    documents: string[],
    embeddings: number[][],
    metadatas: Record<string, string | number>[],
): Promise<void> {
    const collId = await ensureCollection(collection);

    const ids = documents.map((_, i) => `${fileId}_${i}_${uuidv4().slice(0, 8)}`);

    const payload: UpsertPayload = { ids, embeddings, documents, metadatas };

    await axios.post(`${collectionUrl(collId)}/upsert`, payload, {
        timeout: 60_000,
    });

    logger.info(`Upserted ${ids.length} chunks into [${COLLECTIONS[collection]}]`);
}

/**
 * Query a single collection for the top-k nearest chunks to a query vector.
 */
export async function queryCollection(
    collection: CollectionName,
    queryEmbedding: number[],
    topK: number,
    where?: Record<string, string>,
): Promise<QueryResult[]> {
    const collId = await ensureCollection(collection);

    const body: Record<string, unknown> = {
        query_embeddings: [queryEmbedding],
        n_results: topK,
        include: ['documents', 'metadatas', 'distances'],
    };
    if (where && Object.keys(where).length > 0) body.where = where;

    const resp = await axios.post<{
        ids: string[][];
        documents: string[][];
        metadatas: Record<string, string | number>[][];
        distances: number[][];
    }>(`${collectionUrl(collId)}/query`, body, { timeout: 30_000 });

    const { ids, documents, metadatas, distances } = resp.data;

    return (ids[0] ?? []).map((id, i) => ({
        id,
        document: documents[0]?.[i] ?? '',
        metadata: metadatas[0]?.[i] ?? {},
        distance: distances[0]?.[i] ?? 1,
    }));
}

/**
 * Remove all chunks belonging to a file from a collection.
 */
export async function deleteByFileId(
    collection: CollectionName,
    fileId: string,
): Promise<void> {
    const collId = await ensureCollection(collection);
    await axios.post(
        `${collectionUrl(collId)}/delete`,
        { where: { fileId } },
        { timeout: 15_000 },
    );
    logger.info(`Deleted chunks for file ${fileId} from [${COLLECTIONS[collection]}]`);
}

/**
 * Get the total number of embeddings in a collection.
 */
export async function countCollection(collection: CollectionName): Promise<number> {
    try {
        const collId = await ensureCollection(collection);
        const resp = await axios.get<number>(
            `${collectionUrl(collId)}/count`,
            { timeout: 10_000 },
        );
        return typeof resp.data === 'number' ? resp.data : 0;
    } catch {
        return 0;
    }
}
