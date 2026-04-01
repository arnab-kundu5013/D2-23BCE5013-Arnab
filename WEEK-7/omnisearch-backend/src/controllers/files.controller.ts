import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { listFiles, getFileById, deleteFileById, deleteLinksByFileId, listAllLinks, getFileStats } from '../db/queries';
import { deleteByFileId, countCollection, queryCollection } from '../services/vector.service';
import { createError } from '../middleware/error';
import logger from '../middleware/logger';

/**
 * GET /api/files
 * Paginated file list with optional type and status filters.
 */
export async function handleListFiles(req: Request, res: Response, next: NextFunction) {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
        const type = (req.query.type as string) || undefined;
        const status = (req.query.status as string) || undefined;

        const { rows, total } = await listFiles({ page, limit, type, status });

        res.json({
            files: rows.map((f) => ({
                id: f.id,
                originalName: f.original_name,
                fileType: f.file_type,
                mimeType: f.mime_type,
                sizeBytes: f.size_bytes,
                status: f.status,
                chunksIndexed: f.chunks_indexed,
                tags: JSON.parse(f.tags || '[]'),
                description: f.description,
                createdAt: f.created_at,
                updatedAt: f.updated_at,
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        next(err);
    }
}

/**
 * GET /api/files/:id
 * Single file detail with chunk count.
 */
export async function handleGetFile(req: Request, res: Response, next: NextFunction) {
    try {
        const file = await getFileById(req.params.id);
        if (!file) {
            return next(createError(`File ${req.params.id} not found`, 404, 'FILE_NOT_FOUND'));
        }

        res.json({
            id: file.id,
            originalName: file.original_name,
            fileType: file.file_type,
            mimeType: file.mime_type,
            sizeBytes: file.size_bytes,
            status: file.status,
            chunksIndexed: file.chunks_indexed,
            tags: JSON.parse(file.tags || '[]'),
            description: file.description,
            errorMessage: file.error_message,
            storedPath: file.stored_path,
            createdAt: file.created_at,
            updatedAt: file.updated_at,
        });
    } catch (err) {
        next(err);
    }
}

/**
 * DELETE /api/files/:id
 * Remove a file from disk, SQLite, and all ChromaDB collections.
 */
export async function handleDeleteFile(req: Request, res: Response, next: NextFunction) {
    try {
        const file = await getFileById(req.params.id);
        if (!file) {
            return next(createError(`File ${req.params.id} not found`, 404, 'FILE_NOT_FOUND'));
        }

        // Remove from vector store (all collections, best-effort)
        const collectionMap: Record<string, 'TEXT' | 'IMAGE' | 'AUDIO'> = {
            pdf: 'TEXT',
            docx: 'TEXT',
            image: 'IMAGE',
            audio: 'AUDIO',
        };
        const collection = collectionMap[file.file_type];
        if (collection) {
            try {
                await deleteByFileId(collection, file.id);
            } catch (chromaErr: unknown) {
                const msg = chromaErr instanceof Error ? chromaErr.message : String(chromaErr);
                logger.warn(`ChromaDB delete failed for ${file.id}: ${msg} — continuing`);
            }
        }

        // Remove cross-modal links
        await deleteLinksByFileId(file.id);

        // Remove from disk
        if (fs.existsSync(file.stored_path)) {
            fs.unlinkSync(file.stored_path);
        }

        // Remove from SQLite
        await deleteFileById(file.id);

        logger.info(`Deleted file ${file.id} (${file.original_name})`);

        res.json({
            message: `File ${file.original_name} deleted successfully`,
            deletedId: file.id,
        });
    } catch (err) {
        next(err);
    }
}

/**
 * GET /api/files/:id/download
 * Stream the original uploaded file back to the client.
 */
export async function handleDownloadFile(req: Request, res: Response, next: NextFunction) {
    try {
        const file = await getFileById(req.params.id);
        if (!file) {
            return next(createError(`File ${req.params.id} not found`, 404, 'FILE_NOT_FOUND'));
        }

        if (!fs.existsSync(file.stored_path)) {
            return next(createError('File not found on disk — it may have been moved or deleted.', 410, 'FILE_GONE'));
        }

        res.setHeader('Content-Type', file.mime_type);
        res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
        res.setHeader('Content-Length', file.size_bytes);

        const stream = fs.createReadStream(file.stored_path);
        stream.pipe(res);
    } catch (err) {
        next(err);
    }
}

/**
 * GET /api/files/:id/chunks
 * List indexed chunks for a specific file.
 * This queries ChromaDB for all vectors matching the fileId.
 */
export async function handleListChunks(req: Request, res: Response, next: NextFunction) {
    try {
        const file = await getFileById(req.params.id);
        if (!file) {
            return next(createError(`File ${req.params.id} not found`, 404, 'FILE_NOT_FOUND'));
        }

        // We don't have a "get all by fileId" in ChromaDB REST easily,
        // so we do a dummy query with a zero vector and a large topK with where filter.
        // A proper approach uses the /get endpoint with where filters.
        const collectionMap: Record<string, 'TEXT' | 'IMAGE' | 'AUDIO'> = {
            pdf: 'TEXT',
            docx: 'TEXT',
            image: 'IMAGE',
            audio: 'AUDIO',
        };
        const collection = collectionMap[file.file_type];

        if (!collection) {
            return res.json({ fileId: file.id, chunks: [] });
        }

        // Use a high topK and filter by fileId metadata
        const results = await queryCollection(collection, [], file.chunks_indexed + 10, { fileId: file.id });

        res.json({
            fileId: file.id,
            originalName: file.original_name,
            fileType: file.file_type,
            totalChunks: file.chunks_indexed,
            chunks: results.map((r) => ({
                id: r.id,
                text: r.document,
                metadata: r.metadata,
            })),
        });
    } catch (err) {
        next(err);
    }
}

/**
 * GET /api/links
 * List all cross-modal link records.
 */
export async function handleListLinks(_req: Request, res: Response, next: NextFunction) {
    try {
        const links = await listAllLinks();

        res.json({
            total: links.length,
            links: links.map((l) => ({
                id: l.id,
                sourceFileId: l.source_file_id,
                targetFileId: l.target_file_id,
                sourceChunkId: l.source_chunk_id,
                targetChunkId: l.target_chunk_id,
                linkType: l.link_type,
                confidence: l.confidence,
                createdAt: l.created_at,
            })),
        });
    } catch (err) {
        next(err);
    }
}

/**
 * GET /api/stats
 * Overall system statistics: file counts per type, disk usage, chunk counts.
 */
export async function handleStats(_req: Request, res: Response, next: NextFunction) {
    try {
        const stats = await getFileStats();
        const links = await listAllLinks();

        // Aggregate stats by type and overall
        const byType: Record<string, { count: number; totalSize: number; totalChunks: number }> = {};
        let totalFiles = 0;
        let totalSize = 0;
        let totalChunks = 0;

        for (const row of stats) {
            if (!byType[row.file_type]) {
                byType[row.file_type] = { count: 0, totalSize: 0, totalChunks: 0 };
            }
            byType[row.file_type].count += Number(row.count);
            byType[row.file_type].totalSize += Number(row.total_size);
            byType[row.file_type].totalChunks += Number(row.total_chunks);

            totalFiles += Number(row.count);
            totalSize += Number(row.total_size);
            totalChunks += Number(row.total_chunks);
        }

        // Get per-collection vector counts from ChromaDB (best-effort)
        let textVectors = 0;
        let imageVectors = 0;
        let audioVectors = 0;
        try {
            [textVectors, imageVectors, audioVectors] = await Promise.all([
                countCollection('TEXT'),
                countCollection('IMAGE'),
                countCollection('AUDIO'),
            ]);
        } catch {
            logger.warn('Could not fetch ChromaDB collection counts for stats');
        }

        res.json({
            totalFiles,
            totalSizeBytes: totalSize,
            totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
            totalChunksIndexed: totalChunks,
            crossModalLinks: links.length,
            byFileType: byType,
            vectorCollections: {
                text_chunks: textVectors,
                image_metadata: imageVectors,
                audio_segments: audioVectors,
            },
        });
    } catch (err) {
        next(err);
    }
}
