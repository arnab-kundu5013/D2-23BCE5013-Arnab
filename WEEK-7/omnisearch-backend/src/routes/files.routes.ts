import { Router } from 'express';
import {
    handleListFiles,
    handleGetFile,
    handleDeleteFile,
    handleDownloadFile,
    handleListChunks,
    handleListLinks,
    handleStats,
} from '../controllers/files.controller';

const router = Router();

/**
 * GET /api/files
 * Paginated list of all ingested files.
 * Query params: page (default 1), limit (default 20), type (pdf|docx|image|audio), status
 */
router.get('/', handleListFiles);

/**
 * GET /api/stats
 * System-wide statistics: total files, size, chunks, vector counts.
 * Mounted before /:id so Express doesn't treat "stats" as a file ID.
 */
router.get('/stats', handleStats);

/**
 * GET /api/files/links
 * List all cross-modal link records, sorted by confidence descending.
 */
router.get('/links', handleListLinks);

/**
 * GET /api/files/:id
 * Single file detail with metadata, chunk count, and error info.
 */
router.get('/:id', handleGetFile);

/**
 * DELETE /api/files/:id
 * Remove file from disk, SQLite, ChromaDB, and cross-modal links.
 */
router.delete('/:id', handleDeleteFile);

/**
 * GET /api/files/:id/download
 * Stream the original uploaded file back with correct Content-Type.
 */
router.get('/:id/download', handleDownloadFile);

/**
 * GET /api/files/:id/chunks
 * List all indexed chunks for a specific file.
 */
router.get('/:id/chunks', handleListChunks);

export default router;
