import { Router } from 'express';
import { upload } from '../middleware/upload';
import { handleTextQuery, handleImageQuery } from '../controllers/query.controller';

const router = Router();

/**
 * POST /api/query
 * Submit a natural language query and receive a grounded, cited answer.
 *
 * Body: application/json
 *   - query: (required) the natural language question, max 2000 chars
 *   - topK: (optional) results per collection, default env.TOP_K
 *   - modalities: (optional) array of ['text','image','audio'], default all
 *   - stream: (optional) boolean, default true — if true, response is SSE
 *
 * SSE events (when stream=true):
 *   context   → retrieved source chunks and metadata
 *   token     → individual LLM token
 *   citations → final numbered source citations
 *   done      → stream complete with usage stats
 *   error     → error event if something fails mid-stream
 *
 * JSON response (when stream=false):
 *   { answer, citations, context, crossModalLinks, usage }
 */
router.post('/', handleTextQuery);

/**
 * POST /api/query/image
 * Submit an image file to perform cross-modal semantic search.
 *
 * Body: multipart/form-data
 *   - file: (required) single PNG, JPG, or WEBP image
 *   - topK: (optional) results per collection
 *
 * Response 200:
 *   { queryImage, caption, topK, results: { text, image, audio } }
 */
router.post('/image', upload.single('file'), handleImageQuery);

export default router;
