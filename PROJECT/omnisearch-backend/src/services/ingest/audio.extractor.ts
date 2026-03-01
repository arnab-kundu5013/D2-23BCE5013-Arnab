import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { env } from '../../config/env';
import logger from '../../middleware/logger';

export interface AudioSegment {
    startSec: number;
    endSec: number;
    text: string;
    speakerLabel: string;
}

export interface AudioResult {
    segments: AudioSegment[];
    fullTranscript: string;
    durationSec: number;
}

/**
 * Parse Whisper.cpp JSON output into typed AudioSegment objects.
 * Whisper JSON format:
 *   { "transcription": [{ "offsets": { "from": 0, "to": 3200 }, "text": "..." }, ...] }
 */
function parseWhisperJson(raw: string): AudioSegment[] {
    try {
        const parsed = JSON.parse(raw) as {
            transcription?: Array<{
                offsets: { from: number; to: number };
                text: string;
                speaker?: string;
            }>;
        };

        return (parsed.transcription ?? []).map((seg, idx) => ({
            // Whisper offsets are in milliseconds
            startSec: seg.offsets.from / 1000,
            endSec: seg.offsets.to / 1000,
            text: seg.text.trim(),
            speakerLabel: seg.speaker ?? `speaker_${idx}`,
        }));
    } catch {
        return [];
    }
}

/**
 * Parse a Whisper SRT/VTT output as a fallback when JSON mode is unavailable.
 * Matches lines like: "00:00:01,000 --> 00:00:04,000" followed by text.
 */
function parseWhisperSrt(raw: string): AudioSegment[] {
    const segments: AudioSegment[] = [];
    // Match SRT timestamp blocks: "HH:MM:SS,mmm --> HH:MM:SS,mmm"
    const timePattern = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/g;
    const lines = raw.split('\n');

    let i = 0;
    while (i < lines.length) {
        const timeLine = lines[i];
        const match = timePattern.exec(timeLine);
        if (match) {
            const toSec = (h: string, m: string, s: string, ms: string) =>
                Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

            const startSec = toSec(match[1], match[2], match[3], match[4]);
            const endSec = toSec(match[5], match[6], match[7], match[8]);

            // Collect all non-empty lines after the timestamp as text
            const textLines: string[] = [];
            i++;
            while (i < lines.length && lines[i].trim() !== '' && !/^\d+$/.test(lines[i].trim())) {
                textLines.push(lines[i].trim());
                i++;
            }

            const text = textLines.join(' ').trim();
            if (text) segments.push({ startSec, endSec, text, speakerLabel: '' });
        }
        i++;
        timePattern.lastIndex = 0; // reset regex for next iteration
    }

    return segments;
}

/**
 * Run Whisper.cpp on an audio file and return timestamped transcript segments.
 *
 * The function tries JSON output first; if the binary doesn't support --output-json,
 * it falls back to SRT/text parsing.  If Whisper isn't installed at all, it
 * returns a single segment with a placeholder so the file is still indexed.
 */
export async function extractAudio(filePath: string): Promise<AudioResult> {
    const fileName = path.basename(filePath);
    const whisperBin = env.WHISPER_BIN;
    const model = env.WHISPER_MODEL;

    logger.info(`Transcribing audio: ${fileName} (model: ${model})`);

    // Output base path — Whisper writes <base>.json or <base>.srt
    const outputBase = filePath.replace(/\.[^.]+$/, '_whisper_out');

    return new Promise((resolve) => {
        const args = [
            '-m', model.includes('/') ? model : `models/ggml-${model}.bin`,
            '-f', filePath,
            '--output-json',
            '--output-file', outputBase,
            '--language', 'en',
            '--print-progress', 'false',
        ];

        logger.debug(`Whisper command: ${whisperBin} ${args.join(' ')}`);

        const proc = spawn(whisperBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        const timeout = setTimeout(() => {
            proc.kill('SIGKILL');
            logger.warn(`Whisper timed out for ${fileName} — returning empty transcript`);
            resolve({ segments: [], fullTranscript: '', durationSec: 0 });
        }, 10 * 60 * 1000); // 10 minute hard limit

        proc.on('close', (code) => {
            clearTimeout(timeout);

            if (code !== 0) {
                logger.warn(`Whisper exited with code ${code} for ${fileName}: ${stderr.slice(0, 300)}`);
                // Whisper not installed or failed — return stub so ingest doesn't hard-fail
                resolve({
                    segments: [{ startSec: 0, endSec: 0, text: `[Whisper unavailable] ${fileName}`, speakerLabel: '' }],
                    fullTranscript: `[Whisper unavailable] ${fileName}`,
                    durationSec: 0,
                });
                return;
            }

            // Try reading the JSON output file first
            const jsonPath = `${outputBase}.json`;
            const srtPath = `${outputBase}.srt`;

            let segments: AudioSegment[] = [];

            if (fs.existsSync(jsonPath)) {
                segments = parseWhisperJson(fs.readFileSync(jsonPath, 'utf-8'));
                fs.unlinkSync(jsonPath);
            } else if (fs.existsSync(srtPath)) {
                segments = parseWhisperSrt(fs.readFileSync(srtPath, 'utf-8'));
                fs.unlinkSync(srtPath);
            } else if (stdout.trim()) {
                // Plain text fallback — Whisper printed to stdout
                segments = [{ startSec: 0, endSec: 0, text: stdout.trim(), speakerLabel: '' }];
            }

            const fullTranscript = segments.map((s) => s.text).join(' ');
            const durationSec = segments.length > 0 ? segments[segments.length - 1].endSec : 0;

            logger.info(`Audio ${fileName}: ${segments.length} segments, ${durationSec.toFixed(1)}s`);
            resolve({ segments, fullTranscript, durationSec });
        });
    });
}
