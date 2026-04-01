import { Router } from 'express';
import { upload } from '../middleware/upload';
import { handleIngest, handleIngestStatus } from '../controllers/ingest.controller';

const router = Router();

/**
 * POST /api/ingest
 * Upload one or more files for ingestion.
 * Body: multipart/form-data
 *   - files: (required) one or more files — PDF, DOCX, PNG, JPG, WEBP, MP3, WAV, M4A
 *   - description: (optional) text description applied to all files in this batch
 *   - tags: (optional) comma-separated list of tags
 *
 * Response 201:
 * {
 *   message: "3 file(s) queued for ingestion",
 *   files: [{ fileId, jobId, originalName, fileType, status: "queued" }, ...]
 * }
 */
router.post('/', upload.array('files', 20), handleIngest);

/**
 * GET /api/ingest/:id/status
 * Poll the processing status of a specific file.
 *
 * Response 200:
 * {
 *   fileId, originalName, fileType,
 *   status: "queued" | "processing" | "completed" | "failed",
 *   chunksIndexed: number,
 *   errorMessage: string | null
 * }
 */
router.get('/:id/status', handleIngestStatus);

export default router;
