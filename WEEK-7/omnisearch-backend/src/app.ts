import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';

import { env } from './config/env';
import logger from './middleware/logger';
import { errorHandler } from './middleware/error';

import healthRouter from './routes/health.routes';
import ingestRouter from './routes/ingest.routes';
import queryRouter from './routes/query.routes';
import filesRouter from './routes/files.routes';

const app = express();

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// HTTP request logger — skip in test env to keep output clean
if (env.NODE_ENV !== 'test') {
    app.use(
        morgan('combined', {
            stream: { write: (msg) => logger.info(msg.trim()) },
        }),
    );
}

// Ensure logs directory exists
const logsDir = path.resolve('logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/health', healthRouter);
app.use('/api/ingest', ingestRouter);
app.use('/api/query', queryRouter);
app.use('/api/files', filesRouter);

// 404 catch-all
app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found.' });
});

// Global error handler — must be last
app.use(errorHandler);

export default app;
