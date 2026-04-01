import axios from 'axios';
import { env } from '../config/env';
import logger from '../middleware/logger';

const OLLAMA_GENERATE_URL = `${env.OLLAMA_HOST}/api/generate`;

export interface LlmStreamCallbacks {
    onToken: (token: string) => void;
    onDone: (fullResponse: string) => void;
    onError: (error: Error) => void;
}

/**
 * Send a prompt to the locally running Ollama LLM and stream
 * tokens back one at a time via the provided callbacks.
 *
 * Ollama /api/generate with stream:true returns newline-delimited
 * JSON objects where each line has { "response": "token", "done": bool }.
 */
export async function streamLlmResponse(
    systemPrompt: string,
    userPrompt: string,
    callbacks: LlmStreamCallbacks,
): Promise<void> {
    let fullResponse = '';

    try {
        const response = await axios.post(
            OLLAMA_GENERATE_URL,
            {
                model: env.LLM_MODEL,
                system: systemPrompt,
                prompt: userPrompt,
                stream: true,
            },
            {
                responseType: 'stream',
                timeout: 5 * 60 * 1000, // 5 minute timeout for slow models
            },
        );

        const stream = response.data as NodeJS.ReadableStream;
        let leftover = '';

        stream.on('data', (chunk: Buffer) => {
            const text = leftover + chunk.toString('utf-8');
            const lines = text.split('\n');

            // The last element might be an incomplete JSON line — hold it for next chunk
            leftover = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                try {
                    const parsed = JSON.parse(trimmed) as { response?: string; done?: boolean };

                    if (parsed.response) {
                        fullResponse += parsed.response;
                        callbacks.onToken(parsed.response);
                    }

                    if (parsed.done) {
                        callbacks.onDone(fullResponse);
                        return;
                    }
                } catch {
                    // Malformed JSON line — skip silently
                    logger.debug(`Skipped non-JSON Ollama output: ${trimmed.slice(0, 80)}`);
                }
            }
        });

        stream.on('end', () => {
            // If Ollama ends without sending done:true, fire onDone anyway
            if (fullResponse) {
                callbacks.onDone(fullResponse);
            }
        });

        stream.on('error', (err: Error) => {
            callbacks.onError(err);
        });
    } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error(`LLM streaming failed: ${error.message}`);
        callbacks.onError(error);
    }
}

/**
 * Non-streaming variant — sends the prompt and waits for the full response.
 * Useful for testing and simpler query flows.
 */
export async function generateLlmResponse(
    systemPrompt: string,
    userPrompt: string,
): Promise<string> {
    const response = await axios.post<{ response: string }>(
        OLLAMA_GENERATE_URL,
        {
            model: env.LLM_MODEL,
            system: systemPrompt,
            prompt: userPrompt,
            stream: false,
        },
        { timeout: 5 * 60 * 1000 },
    );
    return response.data.response;
}
