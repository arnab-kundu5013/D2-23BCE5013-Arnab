import pdfParse from 'pdf-parse';
import fs from 'fs';

export interface PdfPage {
    pageNumber: number;
    text: string;
}

export interface PdfResult {
    fullText: string;
    pages: PdfPage[];
    totalPages: number;
    title?: string;
}

/**
 * Extract text from a PDF file, preserving per-page content.
 * pdf-parse gives us a single text blob with a render_page callback
 * that lets us split content per page.
 */
export async function extractPdf(filePath: string): Promise<PdfResult> {
    const buffer = fs.readFileSync(filePath);

    const pages: PdfPage[] = [];
    let pageCounter = 0;

    const data = await pdfParse(buffer, {
        // Called once per page — lets us record page-level text splits
        pagerender(pageData) {
            return pageData.getTextContent().then(
                (textContent: { items: Array<{ str: string; hasEOL?: boolean }> }) => {
                    pageCounter += 1;
                    const text = textContent.items
                        .map((item) => item.str + (item.hasEOL ? '\n' : ' '))
                        .join('')
                        .trim();
                    pages.push({ pageNumber: pageCounter, text });
                    return text;
                },
            );
        },
    });

    // Fallback: if pagerender produced no per-page data use the full text
    if (pages.length === 0 && data.text) {
        pages.push({ pageNumber: 1, text: data.text.trim() });
    }

    return {
        fullText: data.text.trim(),
        pages,
        totalPages: data.numpages,
        title: (data.info?.Title as string | undefined) ?? undefined,
    };
}
