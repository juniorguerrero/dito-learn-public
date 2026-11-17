// Document text extraction, run in a worker thread (see src/lib/parse.ts).
//
// Why a separate, plain-JS worker file:
// - Isolation: the parent enforces a timeout with worker.terminate(), which
//   really stops this thread (even in a tight loop), and V8 heap limits via
//   `resourceLimits`. A runaway document can't keep burning CPU in the server.
// - Runtime: this file is loaded from disk by path and is never bundled by
//   Next.js, so pdf-parse / pdf.js resolve their own worker module from
//   node_modules. (Bundling pdf-parse into the route is what broke PDF uploads
//   in both `next dev` and `next start`.)
//
// Input  (workerData): { kind: "pdf" | "docx", bytes: Uint8Array, maxChars: number, batchPages: number }
// Output (postMessage): { ok: true, text, stoppedEarly, pagesRead, totalPages }
//                     | { ok: false, reason: "damaged" | "password", detail }

import { parentPort, workerData } from "node:worker_threads";
import { normalizeLessonText } from "../lib/lessonText.mjs";

const { kind, bytes, maxChars, batchPages } = workerData;

async function extractPdf() {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({
    data: bytes,
    verbosity: 0, // no pdf.js console noise in server logs
    isEvalSupported: false, // never compile code from font data
    stopAtErrors: true, // damaged streams fail instead of yielding partial text
  });
  try {
    const info = await parser.getInfo();
    const totalPages = info.total;
    let text = "";
    let pagesRead = 0;
    // Read in batches and stop as soon as the text is over the lesson limit:
    // a long book is rejected after a few pages instead of being fully extracted.
    // The limit applies to *normalized* text (blank pages, for example, add
    // newlines that normalization removes), so measure exactly that. Because
    // normalization never makes a longer text shorter than its prefix, a
    // normalized prefix over the limit means the whole document is over it.
    while (pagesRead < totalPages) {
      const first = pagesRead + 1;
      const last = Math.min(totalPages, pagesRead + batchPages);
      const result = await parser.getText({ first, last, pageJoiner: "" });
      text += (text ? "\n\n" : "") + result.text;
      pagesRead = last;
      if (pagesRead < totalPages && normalizeLessonText(text).length > maxChars) {
        return { ok: true, text, stoppedEarly: true, pagesRead, totalPages };
      }
    }
    return { ok: true, text, stoppedEarly: false, pagesRead, totalPages };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx() {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
  return { ok: true, text: result.value, stoppedEarly: false, pagesRead: null, totalPages: null };
}

try {
  const out = kind === "pdf" ? await extractPdf() : await extractDocx();
  parentPort.postMessage(out);
} catch (err) {
  const name = err && typeof err === "object" ? err.name : "";
  const detail = `${name || "Error"}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
  parentPort.postMessage({ ok: false, reason: name === "PasswordException" ? "password" : "damaged", detail });
}
