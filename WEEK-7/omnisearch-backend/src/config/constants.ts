import { env } from './env';

export const COLLECTIONS = {
    TEXT: env.CHROMA_COLLECTION_TEXT,
    IMAGE: env.CHROMA_COLLECTION_IMAGE,
    AUDIO: env.CHROMA_COLLECTION_AUDIO,
} as const;

export const CHUNK_SIZE = env.CHUNK_SIZE;
export const CHUNK_OVERLAP = env.CHUNK_OVERLAP;
export const TOP_K = env.TOP_K;
export const MAX_CONTEXT_TOKENS = env.MAX_CONTEXT_TOKENS;

export const SUPPORTED_MIME_TYPES: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'image/png': 'image',
    'image/jpeg': 'image',
    'image/webp': 'image',
    'audio/mpeg': 'audio',
    'audio/wav': 'audio',
    'audio/x-wav': 'audio',
    'audio/mp4': 'audio',
    'audio/x-m4a': 'audio',
};

export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB
export const MAX_FILES_PER_REQUEST = 20;
