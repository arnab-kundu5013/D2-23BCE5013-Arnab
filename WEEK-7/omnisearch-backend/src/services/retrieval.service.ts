import { queryCollection, QueryResult } from './vector.service';
import { getLinksBySourceFile, CrossModalLink } from '../db/queries';
import { TOP_K } from '../config/constants';
import logger from '../middleware/logger';

export interface RetrievalResult {
    id: string;
    document: string;
    metadata: Record<string, string | number>;
    score: number;
    modality: 'text' | 'image' | 'audio';
}

export interface RetrievalResponse {
    results: RetrievalResult[];
    crossModalLinks: CrossModalLink[];
}

/**
 * Reciprocal Rank Fusion (RRF) — merges ranked lists from different
 * retrieval sources so no single modality dominates the final ranking.
 *
 * RRF score for a document at rank r = 1 / (k + r)
 * where k is a smoothing constant (typically 60).
 */
function rrfScore(rank: number, k = 60): number {
    return 1 / (k + rank);
}

function convertDistanceToScore(result: QueryResult): number {
    // ChromaDB cosine distance: 0 = identical, 2 = opposite
    // Convert to a similarity score where higher is better
    return Math.max(0, 1 - result.distance);
}

/**
 * Merge multiple ranked lists using RRF and produce a single sorted list.
 */
function fuseResults(
    textHits: QueryResult[],
    imageHits: QueryResult[],
    audioHits: QueryResult[],
): RetrievalResult[] {
    const scoreMap = new Map<string, { result: RetrievalResult; rrfTotal: number }>();

    const addHits = (hits: QueryResult[], modality: 'text' | 'image' | 'audio') => {
        hits.forEach((hit, rank) => {
            const key = hit.id;
            const existing = scoreMap.get(key);
            const contribution = rrfScore(rank + 1);

            if (existing) {
                existing.rrfTotal += contribution;
            } else {
                scoreMap.set(key, {
                    result: {
                        id: hit.id,
                        document: hit.document,
                        metadata: hit.metadata,
                        score: convertDistanceToScore(hit),
                        modality,
                    },
                    rrfTotal: contribution,
                });
            }
        });
    };

    addHits(textHits, 'text');
    addHits(imageHits, 'image');
    addHits(audioHits, 'audio');

    return Array.from(scoreMap.values())
        .sort((a, b) => b.rrfTotal - a.rrfTotal)
        .map((entry) => ({ ...entry.result, score: entry.rrfTotal }));
}

/**
 * Run a multi-collection retrieval query:
 *  1. Embed the query (caller passes embedding)
 *  2. Fan out ANN search across all three ChromaDB collections
 *  3. Fuse results with RRF re-ranking
 *  4. Resolve any cross-modal links attached to top results
 */
export async function retrieveAll(
    queryEmbedding: number[],
    topK: number = TOP_K,
    modalities: string[] = ['text', 'image', 'audio'],
): Promise<RetrievalResponse> {
    const promises: Promise<QueryResult[]>[] = [];
    const labels: ('text' | 'image' | 'audio')[] = [];

    if (modalities.includes('text')) {
        promises.push(queryCollection('TEXT', queryEmbedding, topK));
        labels.push('text');
    }
    if (modalities.includes('image')) {
        promises.push(queryCollection('IMAGE', queryEmbedding, topK));
        labels.push('image');
    }
    if (modalities.includes('audio')) {
        promises.push(queryCollection('AUDIO', queryEmbedding, topK));
        labels.push('audio');
    }

    const settled = await Promise.all(promises);

    // Build per-modality result arrays
    const resultsByModality: Record<string, QueryResult[]> = {};
    labels.forEach((label, i) => {
        resultsByModality[label] = settled[i];
    });

    const fused = fuseResults(
        resultsByModality['text'] ?? [],
        resultsByModality['image'] ?? [],
        resultsByModality['audio'] ?? [],
    );

    // Resolve cross-modal links for the top results
    const fileIds = new Set(fused.map((r) => String(r.metadata.fileId)));
    const allLinks: CrossModalLink[] = [];

    for (const fid of fileIds) {
        const links = await getLinksBySourceFile(fid);
        allLinks.push(...links);
    }

    logger.info(
        `Retrieval: ${fused.length} results fused from ` +
        `${resultsByModality['text']?.length ?? 0} text, ` +
        `${resultsByModality['image']?.length ?? 0} image, ` +
        `${resultsByModality['audio']?.length ?? 0} audio hits`,
    );

    return { results: fused, crossModalLinks: allLinks };
}
