import app from './app';
import { env } from './config/env';
import logger from './middleware/logger';

const server = app.listen(env.PORT, () => {
    logger.info(`🚀  OmniSearch backend running on http://localhost:${env.PORT}`);
    logger.info(`    Environment : ${env.NODE_ENV}`);
    logger.info(`    Ollama      : ${env.OLLAMA_HOST}`);
    logger.info(`    ChromaDB    : ${env.CHROMA_HOST}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received — shutting down gracefully');
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT received — shutting down gracefully');
    server.close(() => {
        process.exit(0);
    });
});
