import { RetrievalResult } from '../services/retrieval.service';
import { MAX_CONTEXT_TOKENS } from '../config/constants';

/**
 * Build the system prompt that instructs the LLM on how to behave.
 * Key rules:
 *  - Answer ONLY from provided context
 *  - Cite sources using [1], [2], etc.
 *  - State explicitly when context doesn't contain the answer
 */
function buildSystemPrompt(): string {
    return [
        'You are OmniSearch, an AI research assistant.',
        'Your job is to answer the user\'s question using ONLY the context provided below.',
        '',
        'Rules:',
        '1. Base your answer strictly on the context chunks provided.',
        '2. Cite your sources using numbered references like [1], [2], etc.',
        '3. If the context does not contain enough information to answer, say so clearly.',
        '4. Never invent facts or cite sources that are not in the provided context.',
        '5. When multiple context chunks support the same point, cite all of them.',
        '6. If information from different modalities (text, image, audio) supports the answer, cite all relevant sources.',
        '7. Be concise but thorough. Prefer structured answers when the question calls for it.',
    ].join('\n');
}

/**
 * Rough word-count based token estimator.
 * A proper tokenizer would be more accurate but this avoids adding
 * a heavy dependency. Average English word ≈ 1.3 tokens.
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.split(/\s+/).length * 1.3);
}

/**
 * Format a single retrieval result into a numbered context block.
 */
function formatContextBlock(result: RetrievalResult, index: number): string {
    const meta = result.metadata;
    const header: string[] = [];

    header.push(`[${index + 1}]`);
    header.push(`Source: ${meta.fileName || 'unknown'}`);
    header.push(`Type: ${result.modality}`);

    if (result.modality === 'text') {
        if (meta.pageNumber) header.push(`Page: ${meta.pageNumber}`);
    } else if (result.modality === 'image') {
        header.push('(Image caption)');
    } else if (result.modality === 'audio') {
        if (meta.startSec !== undefined) {
            header.push(`Audio ${meta.startSec}s–${meta.endSec}s`);
        }
    }

    return `${header.join(' | ')}\n${result.document}\n`;
}

export interface BuiltPrompt {
    systemPrompt: string;
    userPrompt: string;
    includedCount: number;
    droppedCount: number;
}

/**
 * Construct the full prompt with the query and retrieved context chunks.
 * Respects the MAX_CONTEXT_TOKENS budget — lower-ranked chunks are
 * dropped if the combined context exceeds the token limit.
 */
export function buildPrompt(query: string, results: RetrievalResult[]): BuiltPrompt {
    const systemPrompt = buildSystemPrompt();

    // Reserve some budget for the system prompt, query, and response
    const systemTokens = estimateTokens(systemPrompt);
    const queryTokens = estimateTokens(query);
    const reservedForResponse = 512;
    const availableBudget = MAX_CONTEXT_TOKENS - systemTokens - queryTokens - reservedForResponse;

    const contextBlocks: string[] = [];
    let usedTokens = 0;
    let includedCount = 0;

    for (const result of results) {
        const block = formatContextBlock(result, includedCount);
        const blockTokens = estimateTokens(block);

        if (usedTokens + blockTokens > availableBudget && includedCount > 0) {
            break;
        }

        contextBlocks.push(block);
        usedTokens += blockTokens;
        includedCount++;
    }

    const droppedCount = results.length - includedCount;

    const userPrompt = [
        '--- CONTEXT ---',
        contextBlocks.join('\n'),
        '--- END CONTEXT ---',
        '',
        `Question: ${query}`,
    ].join('\n');

    return { systemPrompt, userPrompt, includedCount, droppedCount };
}
