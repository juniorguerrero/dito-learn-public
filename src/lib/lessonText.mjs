// Lesson-text normalization, shared by the browser, the API routes
// (via src/lib/uploadRules.ts) and the document-parser worker
// (src/workers/parse-document.worker.mjs, which is plain JS loaded from disk).
// Keeping one implementation means the 60,000-character limit is measured the
// same way everywhere.

/**
 * Drop a byte-order mark, unify line endings, drop control characters, trim
 * trailing spaces on each line, collapse 3+ blank lines to one blank line,
 * and trim the ends.
 *
 * Monotonic: for any text `a + b`, normalizeLessonText(a).length is at most
 * normalizeLessonText(a + b).length. So once a prefix of a document is over the
 * limit, the whole document is too — which is what makes it safe for the
 * parser to stop reading early.
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeLessonText(s) {
  return s
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
