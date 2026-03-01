import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const envSchema = z.object({
    PORT: z.string().default('3001').transform(Number),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    UPLOAD_DIR: z.string().default('./uploads'),
    SQLITE_PATH: z.string().default('./data/omnisearch.db'),

    CHROMA_HOST: z.string().url().default('http://localhost:8000'),
    CHROMA_COLLECTION_TEXT: z.string().default('text_chunks'),
    CHROMA_COLLECTION_IMAGE: z.string().default('image_metadata'),
    CHROMA_COLLECTION_AUDIO: z.string().default('audio_segments'),

    OLLAMA_HOST: z.string().url().default('http://localhost:11434'),
    EMBED_MODEL: z.string().default('nomic-embed-text'),
    LLM_MODEL: z.string().default('llama3.1:8b'),
    VISION_MODEL: z.string().default('llava:7b'),

    WHISPER_MODEL: z.string().default('base.en'),
    WHISPER_BIN: z.string().default('/usr/local/bin/whisper'),

    CHUNK_SIZE: z.string().default('512').transform(Number),
    CHUNK_OVERLAP: z.string().default('64').transform(Number),

    TOP_K: z.string().default('10').transform(Number),
    MAX_CONTEXT_TOKENS: z.string().default('4096').transform(Number),

    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌  Invalid environment configuration:');
    console.error(parsed.error.format());
    process.exit(1);
}

export const env = parsed.data;

// Resolve storage paths to absolute
export const UPLOAD_DIR = path.resolve(env.UPLOAD_DIR);
export const SQLITE_PATH = path.resolve(env.SQLITE_PATH);
