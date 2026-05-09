/**
 * Client-side PDF text extraction for Quickstart seed input.
 * Lazy-imports `pdfjs-dist` on first invocation so the dashboard's
 * initial bundle stays lean. No server roundtrip; PDFs never leave
 * the browser.
 *
 * @module paracosm/dashboard/quickstart/pdf-extract
 */

// Static `?url` import: Vite bundles pdf.worker.min.mjs as its own
// asset chunk and gives us back its public URL. Doing this with a
// literal-string import (not a dynamic call) is what lets the static
// analyzer hook the worker file into the build graph. The pdfjs lib
// itself (~1MB) still loads lazily via the dynamic import below.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface PdfExtractResult {
  /** Extracted text content, joined across pages with blank-line breaks. */
  text: string;
  /** Number of pages in the source PDF. */
  pages: number;
  /** True when `text` was truncated to stay within `maxBytes`. */
  truncated: boolean;
}

export interface PdfExtractOptions {
  /** Hard cap on extracted bytes (UTF-8). Default 50 000. */
  maxBytes?: number;
  /** Cap on pages scanned. Default 100. */
  maxPages?: number;
}

/**
 * Resolve the worker URL to an absolute string anchored against the
 * current origin. Vite returns a relative path like `/assets/pdf.worker-abc.mjs`
 * which works on the dev/preview server but can 404 when the dashboard
 * is mounted behind a path-rewriting proxy. Anchoring against
 * `window.location.origin` makes the URL absolute so `new Worker(...)`
 * routes through the same origin regardless of base-path.
 */
function resolveWorkerSrc(): string {
  if (typeof window === 'undefined') return pdfWorkerUrl;
  try {
    return new URL(pdfWorkerUrl, window.location.origin).toString();
  } catch {
    return pdfWorkerUrl;
  }
}

let pdfjsModule: typeof import('pdfjs-dist') | null = null;

/**
 * Load `pdfjs-dist` exactly once and pin `GlobalWorkerOptions.workerSrc`
 * before the first `getDocument()` call. The prior implementation set
 * the worker source AFTER the dynamic import on every call, racing the
 * module's own bootstrap and producing a "GlobalWorkerOptions.workerSrc"
 * error on the very first upload — the user could only recover with a
 * hard refresh. Pinning the URL once, in the same async closure as the
 * import, removes that race.
 */
async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsModule) return pdfjsModule;
  const mod = await import('pdfjs-dist');
  (mod as unknown as { GlobalWorkerOptions: { workerSrc: string } })
    .GlobalWorkerOptions.workerSrc = resolveWorkerSrc();
  pdfjsModule = mod;
  return mod;
}

/**
 * Extract text from a PDF File. Uses `pdfjs-dist` via dynamic import.
 *
 * @throws Error when the file is not a PDF or the extraction fails.
 */
export async function extractPdfText(
  file: File,
  options: PdfExtractOptions = {},
): Promise<PdfExtractResult> {
  const { maxBytes = 50_000, maxPages = 100 } = options;
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    throw new Error(`File is not a PDF: ${file.name}`);
  }
  const pdfjs = await loadPdfjs();

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const scanPages = Math.min(pdf.numPages, maxPages);
  const chunks: string[] = [];
  let totalBytes = 0;
  let truncated = false;
  try {
    for (let i = 1; i <= scanPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as Array<{ str?: string }>)
        .map(item => item.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const pageBytes = new Blob([pageText]).size;
      if (totalBytes + pageBytes > maxBytes) {
        const remaining = maxBytes - totalBytes;
        if (remaining > 0) {
          // Truncate at the byte level, not the character level: a raw
          // `pageText.slice(0, remaining)` would under-count for
          // multi-byte UTF-8 glyphs and blow past the budget on
          // non-ASCII PDFs.
          const encoded = new TextEncoder().encode(pageText);
          const truncatedBytes = encoded.slice(0, remaining);
          const decoded = new TextDecoder('utf-8', { fatal: false })
            .decode(truncatedBytes)
            .replace(/�$/, '');
          chunks.push(decoded);
          totalBytes = maxBytes;
        }
        truncated = true;
        break;
      }
      chunks.push(pageText);
      totalBytes += pageBytes;
    }
    const text = chunks.join('\n\n');
    // Raise a recognisable error code when pdf.js parsed the document
    // but every page returned empty text. This usually means the PDF is
    // a scanned image with no embedded text layer; the caller can map
    // the code to a friendlier user-facing message instead of showing
    // "PDF extraction failed: ".
    if (text.trim().length === 0) {
      const e = new Error('PDF contains no extractable text. It may be a scanned image without OCR.');
      (e as Error & { code?: string }).code = 'PDF_NO_TEXT';
      throw e;
    }
    return { text, pages: pdf.numPages, truncated };
  } finally {
    // Release the native PDFDocumentProxy handle even when iteration
    // threw partway through.
    try { pdf.destroy(); } catch { /* noop */ }
  }
}
