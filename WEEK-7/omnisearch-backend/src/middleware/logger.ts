import winston from 'winston';
import { env } from '../config/env';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const devFormat = combine(
    colorize({ all: true }),
    timestamp({ format: 'HH:mm:ss' }),
    errors({ stack: true }),
    printf(({ level, message, timestamp: ts, stack }) => {
        return stack
            ? `[${ts}] ${level}: ${message}\n${stack}`
            : `[${ts}] ${level}: ${message}`;
    }),
);

const prodFormat = combine(
    timestamp(),
    errors({ stack: true }),
    winston.format.json(),
);

const logger = winston.createLogger({
    level: env.LOG_LEVEL,
    format: env.NODE_ENV === 'development' ? devFormat : prodFormat,
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            handleExceptions: true,
        }),
        new winston.transports.File({
            filename: 'logs/combined.log',
            handleExceptions: true,
        }),
    ],
    exitOnError: false,
});

export default logger;
