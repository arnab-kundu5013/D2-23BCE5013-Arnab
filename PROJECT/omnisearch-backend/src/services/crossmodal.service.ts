import { embedText } from './embedding.service';
import { queryCollection } from './vector.service';
import { insertCrossModalLink } from '../db/queries';
import logger from '../middleware/logger';

/**
 * After a file is ingested, check if its content is semantically similar
 * to existing content in other modalities and create link records.
 *
 * Example: an audio segment that mentions "budget report" might link
 * to a PDF chunk about the budget, or an image caption that describes
 * a chart could link to a text passage referencing the same data.
 *
 * This is called post-ingest and runs as a best-effort operation —
 * if it fails, it does not block the main ingest pipeline.
 */
export async function detectCrossModalLinks(
    fileId: string,
    fileType: 'pdf' | 'docx' | 'image' | 'audio',
    sampleText: string,
): Promise<number> {
    const SIMILARITY_THRESHOLD = 0.75; // minimum cosine similarity to create a link
    const LINK_TOP_K = 3;

    let linksCreated = 0;

    try {
        const embedding = await embedText(sampleText);

        // Determine which collections to search for cross-modal matches
        const targetCollections: Array<{ name: 'TEXT' | 'IMAGE' | 'AUDIO'; linkType: string }> = [];

        if (fileType === 'pdf' || fileType === 'docx') {
            targetCollections.push(
                { name: 'IMAGE', linkType: 'text_to_image' },
                { name: 'AUDIO', linkType: 'text_to_audio' },
            );
        } else if (fileType === 'image') {
            targetCollections.push(
                { name: 'TEXT', linkType: 'image_to_text' },
                { name: 'AUDIO', linkType: 'image_to_audio' },
            );
        } else if (fileType === 'audio') {
            targetCollections.push(
                { name: 'TEXT', linkType: 'audio_to_text' },
                { name: 'IMAGE', linkType: 'audio_to_image' },
            );
        }

        for (const target of targetCollections) {
            const results = await queryCollection(target.name, embedding, LINK_TOP_K);

            for (const hit of results) {
                const similarity = 1 - hit.distance;
                if (similarity < SIMILARITY_THRESHOLD) continue;

                // Don't create self-links
                const targetFileId = String(hit.metadata.fileId || '');
                if (targetFileId === fileId) continue;

                await insertCrossModalLink({
                    source_file_id: fileId,
                    target_file_id: targetFileId,
                    source_chunk_id: null,
                    target_chunk_id: hit.id,
                    link_type: target.linkType,
                    confidence: similarity,
                    created_at: new Date().toISOString(),
                });

                linksCreated++;
            }
        }

        if (linksCreated > 0) {
            logger.info(`Cross-modal: created ${linksCreated} link(s) for file ${fileId}`);
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Cross-modal link detection failed for ${fileId}: ${msg} — skipping`);
    }

    return linksCreated;
}
