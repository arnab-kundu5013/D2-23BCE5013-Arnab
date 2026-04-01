import { env } from '../../config/env';

export interface Chunk {
    chunkIndex: number;
    text: string;
    charStart: number;
    charEnd: number;
    pageNumber?: number;
}

/**
 * Split text into overlapping chunks using a sentence-boundary-aware
 * sliding window. The goal is to avoid cutting sentences mid-way while
 * staying close to the configured CHUNK_SIZE (measured in words as a
 * proxy for tokens — good enough without a tokenizer dependency).
 */
export function chunkText(
    text: string,
    pageNumber?: number,
): Chunk[] {
    const chunkSize = env.CHUNK_SIZE;   // target words per chunk
    const overlap = env.CHUNK_OVERLAP;  // words to re-include from previous chunk

    if (!text || text.trim().length === 0) return [];

    // Split on sentence-ending punctuation, keeping the delimiter attached
    const sentences = text
        .replace(/([.!?])\s+/g, '$1\n')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

    const chunks: Chunk[] = [];
    let wordBuffer: string[] = [];
    let sentenceBuffer: string[] = [];
    let chunkIndex = 0;
    let charCursor = 0;

    const flush = () => {
        if (wordBuffer.length === 0) return;
        const text = sentenceBuffer.join(' ').trim();
        if (!text) return;

        const charStart = charCursor;
        const charEnd = charStart + text.length;
        charCursor = charEnd + 1;

        chunks.push({ chunkIndex, text, charStart, charEnd, pageNumber });
        chunkIndex++;

        // Keep the tail of the word buffer for overlap
        const keepWords = wordBuffer.slice(-overlap);
        const keepSentences: string[] = [];
        let kept = 0;
        // Walk sentences in reverse to rebuild the overlap sentence list
        for (let i = sentenceBuffer.length - 1; i >= 0 && kept < overlap; i--) {
            const wc = sentenceBuffer[i].split(/\s+/).length;
            kept += wc;
            keepSentences.unshift(sentenceBuffer[i]);
        }

        wordBuffer = keepWords;
        sentenceBuffer = keepSentences;
    };

    for (const sentence of sentences) {
        const words = sentence.split(/\s+/);
        wordBuffer.push(...words);
        sentenceBuffer.push(sentence);

        if (wordBuffer.length >= chunkSize) {
            flush();
        }
    }

    // Last partial chunk
    if (wordBuffer.length > 0) flush();

    return chunks;
}

/**
 * Assign page numbers to chunks produced from per-page text arrays.
 * Flattens pages then chunks each page individually so each chunk
 * knows exactly which page it came from.
 */
export function chunkPages(
    pages: Array<{ pageNumber: number; text: string }>,
): Chunk[] {
    const allChunks: Chunk[] = [];
    let globalIndex = 0;

    for (const page of pages) {
        const pageChunks = chunkText(page.text, page.pageNumber);
        for (const c of pageChunks) {
            allChunks.push({ ...c, chunkIndex: globalIndex++ });
        }
    }

    return allChunks;
}
