import { Router, Request, Response } from 'express';
import axios from 'axios';
import { env } from '../config/env';
import db from '../db/sqlite';
import logger from '../middleware/logger';

const router = Router();

interface ServiceStatus {
    status: 'ok' | 'degraded';
    latencyMs?: number;
    error?: string;
}

async function pingUrl(url: string, timeoutMs = 5000): Promise<ServiceStatus> {
    const start = Date.now();
    try {
        const resp = await axios.get(url, { timeout: timeoutMs });
        // ChromaDB returns a number for heartbeat, Ollama returns JSON
        if (resp.status >= 200 && resp.status < 300) {
            return { status: 'ok', latencyMs: Date.now() - start };
        }
        return { status: 'degraded', error: `HTTP ${resp.status}` };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: 'degraded', error: msg };
    }
}

async function checkSqlite(): Promise<ServiceStatus> {
    try {
        await db.raw('SELECT 1');
        return { status: 'ok' };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: 'degraded', error: msg };
    }
}

router.get('/', async (_req: Request, res: Response) => {
    const [chroma, ollama, sqlite] = await Promise.all([
        pingUrl(`${env.CHROMA_HOST}/api/v2/heartbeat`),
        pingUrl(`${env.OLLAMA_HOST}/api/tags`),
        checkSqlite(),
    ]);

    const services = { chroma, ollama, sqlite };
    const allOk = Object.values(services).every((s) => s.status === 'ok');

    logger.debug('Health check complete', services);

    res.json({
        status: allOk ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        services,
    });
});

export default router;
