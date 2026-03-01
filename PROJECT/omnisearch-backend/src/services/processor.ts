import { extractPdf } from './ingest/pdf.extractor';
import { extractDocx } from './ingest/docx.extractor';
import { extractImage } from './ingest/image.extractor';
import { extractAudio } from './ingest/audio.extractor';
import { chunkText, chunkPages } from './ingest/chunker';
import { embedBatch, embedText } from './embedding.service';
import { upsertChunks } from './vector.service';
import { updateFileStatus, updateFileChunksIndexed, markFileFailed } from '../db/queries';
import logger from '../middleware/logger';

/**
 * Process a file directly — no Redis queue needed.
 * Called right after upload; runs extraction → chunking → embedding → indexing.
 */
export async function processFile(
    fileId: string,
    storedPath: string,
    fileType: string,
    fileName: string,
): Promise<void> {
    await updateFileStatus(fileId, 'processing');

    try {
        if (fileType === 'pdf') {
            await processPdf(fileId, storedPath, fileName);
        } else if (fileType === 'docx') {
            await processDocx(fileId, storedPath, fileName);
        } else if (fileType === 'image') {
            await processImage(fileId, storedPath, fileName);
        } else if (fileType === 'audio') {
            await processAudio(fileId, storedPath, fileName);
        } else {
            throw new Error(`Unknown file type: ${fileType}`);
        }

        await updateFileStatus(fileId, 'completed');
        logger.info(`File ${fileId} (${fileName}) processed successfully`);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`File ${fileId} processing failed: ${message}`);
        await markFileFailed(fileId, message);
    }
}

async function processPdf(fileId: string, filePath: string, fileName: string) {
    const result = await extractPdf(filePath);
    const chunks = chunkPages(result.pages);

    if (chunks.length === 0) {
        await updateFileChunksIndexed(fileId, 0);
        return;
    }

    const texts = chunks.map((c) => c.text);
    const embeddings = await embedBatch(texts);
    const metadatas = chunks.map((c) => ({
        fileId, fileName,
        chunkIndex: c.chunkIndex,
        pageNumber: c.pageNumber ?? 1,
        charStart: c.charStart,
        charEnd: c.charEnd,
        modality: 'text',
    }));

    await upsertChunks('TEXT', fileId, texts, embeddings, metadatas);
    await updateFileChunksIndexed(fileId, chunks.length);
    logger.info(`PDF ${fileId}: ${chunks.length} chunks indexed`);
}

async function processDocx(fileId: string, filePath: string, fileName: string) {
    const result = await extractDocx(filePath);
    const chunks = chunkText(result.text);

    if (chunks.length === 0) {
        await updateFileChunksIndexed(fileId, 0);
        return;
    }

    const texts = chunks.map((c) => c.text);
    const embeddings = await embedBatch(texts);
    const metadatas = chunks.map((c) => ({
        fileId, fileName,
        chunkIndex: c.chunkIndex,
        pageNumber: 1,
        charStart: c.charStart,
        charEnd: c.charEnd,
        modality: 'text',
    }));

    await upsertChunks('TEXT', fileId, texts, embeddings, metadatas);
    await updateFileChunksIndexed(fileId, chunks.length);
    logger.info(`DOCX ${fileId}: ${chunks.length} chunks indexed`);
}

async function processImage(fileId: string, filePath: string, fileName: string) {
    const result = await extractImage(filePath);
    const captionDoc = result.captionText || `[no caption] ${fileName}`;
    const embedding = await embedText(captionDoc);

    const metadata = {
        fileId, fileName,
        imagePath: filePath,
        width: result.meta.width,
        height: result.meta.height,
        captionText: result.captionText,
        ocrText: result.ocrText,
        modality: 'image',
    };

    await upsertChunks('IMAGE', fileId, [captionDoc], [embedding], [metadata]);
    await updateFileChunksIndexed(fileId, 1);
    logger.info(`Image ${fileId}: captioned and indexed`);
}

async function processAudio(fileId: string, filePath: string, fileName: string) {
    const result = await extractAudio(filePath);

    if (result.segments.length === 0) {
        await updateFileChunksIndexed(fileId, 0);
        return;
    }

    const documents = result.segments.map((s) => s.text);
    const embeddings = await embedBatch(documents);
    const metadatas = result.segments.map((seg) => ({
        fileId, fileName,
        startSec: seg.startSec,
        endSec: seg.endSec,
        transcriptText: seg.text,
        speakerLabel: seg.speakerLabel,
        modality: 'audio',
    }));

    await upsertChunks('AUDIO', fileId, documents, embeddings, metadatas);
    await updateFileChunksIndexed(fileId, result.segments.length);
    logger.info(`Audio ${fileId}: ${result.segments.length} segments indexed`);
}
