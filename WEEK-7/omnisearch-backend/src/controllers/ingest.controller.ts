import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SUPPORTED_MIME_TYPES } from '../config/constants';
import { insertFile, getFileById } from '../db/queries';
import { processFile } from '../services/processor';
import { createError } from '../middleware/error';
import logger from '../middleware/logger';

const ingestBodySchema = z.object({
    description: z.string().max(500).optional(),
    tags: z.string().optional(),
});

export async function handleIngest(req: Request, res: Response, next: NextFunction) {
    try {
        const files = req.files as Express.Multer.File[] | undefined;

        if (!files || files.length === 0) {
            return next(createError('No files uploaded. Send at least one file in the "files" field.', 400, 'NO_FILES'));
        }

        const body = ingestBodySchema.safeParse(req.body);
        const description = body.success ? (body.data.description ?? null) : null;
        const tags = body.success && body.data.tags
            ? JSON.stringify(body.data.tags.split(',').map((t) => t.trim()).filter(Boolean))
            : '[]';

        const results = [];

        for (const file of files) {
            const fileType = SUPPORTED_MIME_TYPES[file.mimetype];
            if (!fileType) {
                logger.warn(`Skipping unsupported file: ${file.originalname} (${file.mimetype})`);
                continue;
            }

            const now = new Date().toISOString();
            const record = await insertFile({
                original_name: file.originalname,
                stored_path: file.path,
                file_type: fileType as 'pdf' | 'docx' | 'image' | 'audio',
                mime_type: file.mimetype,
                size_bytes: file.size,
                status: 'queued',
                tags,
                description,
                chunks_indexed: 0,
                error_message: null,
                created_at: now,
                updated_at: now,
            });

            // Process the file directly — no Redis/Bull needed
            // Fire and forget so the API responds quickly
            processFile(record.id, file.path, fileType, file.originalname);

            results.push({
                fileId: record.id,
                originalName: file.originalname,
                fileType,
                status: 'queued',
            });
        }

        if (results.length === 0) {
            return next(createError('No valid files were accepted.', 400, 'NO_VALID_FILES'));
        }

        res.status(201).json({
            message: `${results.length} file(s) accepted for processing`,
            files: results,
        });
    } catch (err) {
        next(err);
    }
}

export async function handleIngestStatus(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params;
        if (!id) return next(createError('Missing file ID', 400));

        const file = await getFileById(id);
        if (!file) {
            return next(createError(`File ${id} not found`, 404, 'FILE_NOT_FOUND'));
        }

        res.json({
            fileId: file.id,
            originalName: file.original_name,
            fileType: file.file_type,
            status: file.status,
            chunksIndexed: file.chunks_indexed,
            errorMessage: file.error_message,
            createdAt: file.created_at,
            updatedAt: file.updated_at,
        });
    } catch (err) {
        next(err);
    }
}
