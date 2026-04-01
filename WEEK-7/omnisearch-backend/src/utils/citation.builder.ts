import { RetrievalResult } from '../services/retrieval.service';

export interface Citation {
    number: number;
    fileName: string;
    fileId: string;
    modality: 'text' | 'image' | 'audio';
    excerpt: string;
    pageNumber?: number;
    startSec?: number;
    endSec?: number;
}

/**
 * Build citation objects from the retrieval results that were actually
 * included in the LLM prompt. The numbering matches the [1], [2], ...
 * references in the prompt builder context blocks.
 */
export function buildCitations(results: RetrievalResult[], includedCount: number): Citation[] {
    return results.slice(0, includedCount).map((r, i) => {
        const meta = r.metadata;

        const citation: Citation = {
            number: i + 1,
            fileName: String(meta.fileName || 'unknown'),
            fileId: String(meta.fileId || ''),
            modality: r.modality,
            excerpt: r.document.slice(0, 400),
        };

        if (r.modality === 'text' && meta.pageNumber) {
            citation.pageNumber = Number(meta.pageNumber);
        }

        if (r.modality === 'audio') {
            if (meta.startSec !== undefined) citation.startSec = Number(meta.startSec);
            if (meta.endSec !== undefined) citation.endSec = Number(meta.endSec);
        }

        return citation;
    });
}
