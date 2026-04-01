import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { UPLOAD_DIR } from '../config/env';
import { SUPPORTED_MIME_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILES_PER_REQUEST } from '../config/constants';

// Ensure upload directory exists when middleware is first loaded
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
        // Use a UUID so filenames never collide even if the same file is uploaded twice
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${uuidv4()}${ext}`);
    },
});

function fileFilter(
    _req: Express.Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback,
) {
    if (SUPPORTED_MIME_TYPES[file.mimetype]) {
        cb(null, true);
    } else {
        cb(
            new Error(
                `Unsupported file type: ${file.mimetype}. ` +
                `Accepted types: PDF, DOCX, PNG, JPG, WEBP, MP3, WAV, M4A.`,
            ),
        );
    }
}

export const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: MAX_FILES_PER_REQUEST,
    },
});
