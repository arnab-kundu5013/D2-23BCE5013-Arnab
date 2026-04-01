import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import logger from './logger';

export interface AppError extends Error {
    statusCode?: number;
    code?: string;
}

export function errorHandler(
    err: AppError,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    // Multer-specific errors
    if (err instanceof MulterError) {
        res.status(400).json({
            error: 'FILE_UPLOAD_ERROR',
            message: err.message,
            code: err.code,
        });
        return;
    }

    // Zod validation errors
    if (err instanceof ZodError) {
        res.status(422).json({
            error: 'VALIDATION_ERROR',
            message: 'Request body failed schema validation',
            details: err.flatten().fieldErrors,
        });
        return;
    }

    // File filter rejections from multer (passed as plain Error)
    if (err.message && err.message.startsWith('Unsupported file type')) {
        res.status(400).json({
            error: 'UNSUPPORTED_FILE_TYPE',
            message: err.message,
        });
        return;
    }

    const statusCode = err.statusCode ?? 500;
    logger.error(`${statusCode} — ${err.message}`, { stack: err.stack });

    res.status(statusCode).json({
        error: err.code ?? 'INTERNAL_SERVER_ERROR',
        message:
            statusCode === 500 && process.env.NODE_ENV === 'production'
                ? 'An unexpected error occurred.'
                : err.message,
    });
}

// Convenience factory to create typed AppErrors with a status code
export function createError(message: string, statusCode = 500, code?: string): AppError {
    const err: AppError = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}
