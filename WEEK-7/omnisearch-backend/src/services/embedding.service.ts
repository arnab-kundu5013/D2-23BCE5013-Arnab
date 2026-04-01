import axios from 'axios';
import { env } from '../config/env';
import logger from '../middleware/logger';

const OLLAMA_EMBED_URL = `${env.OLLAMA_HOST}/api/embeddings`;

export interface EmbedResult {
    embedding: number[];
}

/**
 * Generate a vector embedding for a single text string using the
 * Ollama nomic-embed-text model running locally.
 */
export async function embedText(text: string): Promise<number[]> {
    const response = await axios.post<EmbedResult>(
        OLLAMA_EMBED_URL,
        { model: env.EMBED_MODEL, prompt: text },
        { timeout: 30_000 },
    );
    return response.data.embedding;
}

/**
 * Batch-embed multiple texts sequentially to avoid overwhelming Ollama.
 * Returns embeddings in the same order as the input array.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
        // Sequential — Ollama local inference is single-threaded anyway
        const vec = await embedText(text);
        embeddings.push(vec);
        logger.debug(`Embedded chunk (${vec.length}d): "${text.slice(0, 60)}..."`);
    }
    return embeddings;
}
