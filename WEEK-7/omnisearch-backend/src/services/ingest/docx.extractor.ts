import mammoth from 'mammoth';

export interface DocxResult {
    text: string;
    warnings: string[];
}

/**
 * Convert a DOCX file to clean plain text using mammoth.
 * All Word formatting (bold, italic, headings, tables) is discarded —
 * only the readable text content is preserved.
 */
export async function extractDocx(filePath: string): Promise<DocxResult> {
    const result = await mammoth.extractRawText({ path: filePath });

    return {
        text: result.value.trim(),
        warnings: result.messages
            .filter((m) => m.type === 'warning')
            .map((m) => m.message),
    };
}
