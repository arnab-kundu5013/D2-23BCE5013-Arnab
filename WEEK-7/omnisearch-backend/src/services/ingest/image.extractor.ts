import sharp from 'sharp';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { env } from '../../config/env';
import logger from '../../middleware/logger';

export interface ImageMetadata {
    width: number;
    height: number;
    format: string;
    resizedPath: string;
}

export interface ImageResult {
    meta: ImageMetadata;
    captionText: string;
    ocrText: string;
}

const OLLAMA_GENERATE_URL = `${env.OLLAMA_HOST}/api/generate`;
// Max dimension for the image we send to LLaVA — keeps it fast without losing detail
const LLAVA_MAX_DIM = 768;

/**
 * Resize the image to a manageable size and encode it as base64.
 * We write the resized version to a temp file alongside the original.
 */
async function resizeAndEncode(filePath: string): Promise<{ meta: ImageMetadata; base64: string }> {
    const image = sharp(filePath);
    const originalMeta = await image.metadata();

    const resized = image.resize({
        width: LLAVA_MAX_DIM,
        height: LLAVA_MAX_DIM,
        fit: 'inside',
        withoutEnlargement: true,
    });

    const resizedPath = filePath.replace(/(\.[^.]+)$/, '_resized.jpg');
    await resized.jpeg({ quality: 85 }).toFile(resizedPath);

    const buffer = fs.readFileSync(resizedPath);
    const base64 = buffer.toString('base64');

    const resizedMeta = await sharp(resizedPath).metadata();

    return {
        meta: {
            width: resizedMeta.width ?? originalMeta.width ?? 0,
            height: resizedMeta.height ?? originalMeta.height ?? 0,
            format: originalMeta.format ?? 'jpeg',
            resizedPath,
        },
        base64,
    };
}

/**
 * Ask the locally running LLaVA model to describe what is in the image.
 * Returns an empty string if LLaVA is unavailable — ingestion continues
 * with an empty caption so the file is still indexed.
 */
async function captionWithLlava(base64Image: string, fileName: string): Promise<string> {
    const prompt =
        'Describe this image in detail. Mention any text, objects, people, charts, ' +
        'diagrams, or notable features you can see. Be specific and factual.';

    try {
        const response = await axios.post<{ response: string }>(
            OLLAMA_GENERATE_URL,
            {
                model: env.VISION_MODEL,
                prompt,
                images: [base64Image],
                stream: false,
            },
            { timeout: 120_000 }, // vision inference is slow on CPU
        );
        return response.data.response.trim();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`LLaVA captioning failed for ${fileName}: ${msg} — indexing with empty caption`);
        return '';
    }
}

/**
 * Main entry point for image extraction.
 * Resizes the image, generates a caption via LLaVA, and returns all metadata.
 */
export async function extractImage(filePath: string): Promise<ImageResult> {
    const fileName = path.basename(filePath);
    logger.info(`Extracting image: ${fileName}`);

    const { meta, base64 } = await resizeAndEncode(filePath);
    const captionText = await captionWithLlava(base64, fileName);

    // ocrText is reserved for Stage 3+ Tesseract integration — empty for now
    const ocrText = '';

    logger.info(`Image ${fileName}: caption=${captionText.slice(0, 80)}...`);

    return { meta, captionText, ocrText };
}
