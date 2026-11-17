// Upload rules shared by the browser (instant feedback) and the server (the
// authority). Pure functions only — no fs, no React — so both sides apply the
// same limits and show the same messages.

import { normalizeLessonText } from "./lessonText.mjs";

// ---------- Limits ----------

/** Largest file accepted, checked against the file's actual byte size. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_UPLOAD_LABEL = "10 MiB";

/**
 * Most lesson text one upload may contain. This is exactly the amount the
 * Learning Blueprint reads (see createLearningBlueprint), so nothing accepted
 * is ever silently left out of it.
 *
 * Measured on the *normalized* extracted text (see normalizeLessonText) as its
 * JavaScript string length, i.e. UTF-16 code units: letters, digits, spaces,
 * punctuation and accented letters count 1; most emoji and some rare
 * characters count 2. Page numbers added by the parser are not counted.
 */
export const MAX_LESSON_TEXT_CHARS = 60_000;
export const MIN_LESSON_TEXT_CHARS = 50;

/** Room for multipart headers, pasted text and profile fields on top of the file. */
export const REQUEST_OVERHEAD_BYTES = 512 * 1024;
export const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + REQUEST_OVERHEAD_BYTES;

/** Word documents are ZIP files; refuse ones whose text part unpacks to more than this. */
export const MAX_DOCX_DOCUMENT_XML_BYTES = 32 * 1024 * 1024;

export type FileKind = "pdf" | "docx" | "text";

export const FILE_KINDS: Record<string, FileKind> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".txt": "text",
  ".md": "text",
  ".markdown": "text",
};

/** For <input accept>: extensions only, so the picker doesn't offer .doc etc. */
export const ACCEPT_ATTRIBUTE = Object.keys(FILE_KINDS).join(",");
export const ACCEPTED_LABEL = "PDF, Word (.docx), plain text (.txt) or Markdown (.md)";

// ---------- Errors ----------

export type UploadErrorCode =
  | "invalid_request"
  | "request_too_large"
  | "file_and_text"
  | "no_input"
  | "multiple_files"
  | "file_empty"
  | "file_too_large"
  | "unsupported_type"
  | "legacy_doc"
  | "type_mismatch"
  | "binary_content"
  | "not_utf8"
  | "damaged_file"
  | "password_protected"
  | "docx_too_complex"
  | "no_text_layer"
  | "too_short"
  | "text_too_long"
  | "parse_timeout"
  | "parse_resources"
  | "busy";

export interface UploadError {
  code: UploadErrorCode;
  status: number;
  message: string;
}

const STATUS: Record<UploadErrorCode, number> = {
  invalid_request: 400,
  request_too_large: 413,
  file_and_text: 400,
  no_input: 400,
  multiple_files: 400,
  file_empty: 400,
  file_too_large: 413,
  unsupported_type: 415,
  legacy_doc: 415,
  type_mismatch: 415,
  binary_content: 415,
  not_utf8: 422,
  damaged_file: 422,
  password_protected: 422,
  docx_too_complex: 422,
  no_text_layer: 422,
  too_short: 422,
  text_too_long: 422,
  parse_timeout: 422,
  parse_resources: 422,
  busy: 503,
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

const fmt = (n: number) => n.toLocaleString("en-US");

const UTF8_HOWTO =
  "Re-save it as UTF-8: in Notepad choose File → Save as → Encoding: UTF-8; in TextEdit choose Format → Make Plain Text, " +
  "then save with “Unicode (UTF-8)”; in VS Code click the encoding in the status bar → Save with Encoding → UTF-8. Then upload it again.";

export interface ErrorContext {
  name?: string;
  size?: number;
  chars?: number;
  atLeast?: boolean; // chars is a lower bound (reading stopped early)
  detected?: string; // human description of what the bytes look like
  expected?: string;
  encoding?: string;
  seconds?: number;
  pasted?: boolean;
}

export function uploadError(code: UploadErrorCode, c: ErrorContext = {}): UploadError {
  const file = c.name ? `“${c.name}”` : "This file";
  const src = c.pasted ? "The pasted text" : file;
  const messages: Record<UploadErrorCode, () => string> = {
    invalid_request: () => "The upload couldn't be read. Please try again from the upload form.",
    request_too_large: () => `This upload is larger than the ${MAX_UPLOAD_LABEL} limit. Choose a file of ${MAX_UPLOAD_LABEL} or less.`,
    file_and_text: () =>
      "You added a file and also pasted text. Please choose one: remove the file to use the pasted text, or clear the pasted text to upload the file.",
    no_input: () => `Add a file (${ACCEPTED_LABEL}) or paste at least a paragraph of text.`,
    multiple_files: () => "Please add one file at a time.",
    file_empty: () => `${file} is empty (0 bytes). Choose the file that contains your lesson material.`,
    file_too_large: () =>
      `${file} is ${formatBytes(c.size ?? 0)}, but the maximum is ${MAX_UPLOAD_LABEL}. ` +
      "Try saving it without large images or embedded media, or split the material into smaller lessons.",
    unsupported_type: () => `${file} isn't a supported file type${c.detected ? ` (it looks like ${c.detected})` : ""}. Upload a ${ACCEPTED_LABEL} file.`,
    legacy_doc: () =>
      `${file} is an older Word 97–2003 document (.doc), which can't be read. ` +
      "Open it in Word or LibreOffice, choose Save as → Word Document (.docx) or export it as PDF, and upload that file.",
    type_mismatch: () =>
      `${file} is named like ${c.expected ?? "a supported document"} but isn't one${c.detected ? ` — it looks like ${c.detected}` : ""}. ` +
      "Check that you chose the right file, or save it again in the correct format.",
    binary_content: () =>
      `${file} contains binary data${c.detected ? ` (it looks like ${c.detected})` : ""}, not plain text. ` +
      `Files named .txt or .md must contain text. Upload the original document as PDF or .docx, or choose the right file.`,
    not_utf8: () => `${file} isn't saved as UTF-8 text${c.encoding ? ` (it appears to be ${c.encoding})` : ""}. ${UTF8_HOWTO}`,
    damaged_file: () =>
      `${file} appears to be damaged or incomplete, so its text can't be read. ` +
      `Open it in ${c.expected === "a PDF" ? "a PDF viewer" : "Word or LibreOffice"} to check it, then save or export a fresh copy and upload that.`,
    password_protected: () =>
      `${file} is password-protected, so its text can't be read. Open it with its password, save a copy without the password ` +
      "(for example File → Print → Save as PDF, or your PDF app's “remove security” option), and upload that copy.",
    docx_too_complex: () =>
      `${file} unpacks to more document data than can be processed safely. Save a copy without embedded objects, or split it into smaller lessons.`,
    no_text_layer: () =>
      `${file} has no selectable text — it looks like a scanned or image-only PDF. Dito Learn reads the text stored in a PDF and can't read text from images. ` +
      "Run OCR (text recognition) on it first — for example “Scan & OCR” / “Recognize text” in Adobe Acrobat, or the OCR option of your scanner app — " +
      "or upload the original document (.docx, .txt) instead. Tip: if you can't select words in the PDF viewer, it needs OCR.",
    too_short: () =>
      c.chars === 0
        ? `${src} contains no text — only blank space. A lesson needs at least ${MIN_LESSON_TEXT_CHARS} characters (about a paragraph).`
        : `${src} has only ${fmt(c.chars ?? 0)} characters of text. A lesson needs at least ${MIN_LESSON_TEXT_CHARS} characters (about a paragraph).`,
    text_too_long: () =>
      `${src} has ${c.atLeast ? "more than " : ""}${fmt(c.chars ?? 0)} characters of text, but a lesson can use at most ${fmt(MAX_LESSON_TEXT_CHARS)} ` +
      "(roughly 9,000 words or 20–25 pages of plain text), which is all the Learning Blueprint reads. " +
      "Split the material into smaller lessons, or remove appendices and reference sections, and upload each part separately.",
    parse_timeout: () =>
      `Reading ${file} took longer than ${c.seconds === 1 ? "1 second" : `${c.seconds ?? 20} seconds`}, so it was stopped. The document may be very complex ` +
      "(large scans, many drawings or embedded fonts). Try exporting it again as a simpler PDF or .docx, or split it into smaller parts.",
    parse_resources: () =>
      `${file} needed more memory to read than is allowed, so processing was stopped. Try exporting it again as a simpler PDF or .docx, or split it into smaller parts.`,
    busy: () => "Several documents are being processed right now. Please try again in a moment.",
  };
  return { code, status: STATUS[code], message: messages[code]() };
}

// ---------- File name / size ----------

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** Checks that need only the name and size (run before reading any bytes). */
export function checkFileMeta(name: string, size: number): UploadError | null {
  const ext = fileExtension(name);
  if (ext === ".doc") return uploadError("legacy_doc", { name });
  if (!FILE_KINDS[ext]) return uploadError("unsupported_type", { name });
  if (size === 0) return uploadError("file_empty", { name });
  if (size > MAX_UPLOAD_BYTES) return uploadError("file_too_large", { name, size });
  return null;
}

// ---------- Content signatures ----------

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** What a file's first bytes say it is (null = no known binary signature). */
export function detectSignature(b: Uint8Array): { kind: string; label: string } | null {
  if (startsWith(b, ascii("%PDF-"))) return { kind: "pdf", label: "a PDF document" };
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])) return { kind: "zip", label: "a ZIP archive" };
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { kind: "ole", label: "an older Microsoft Office file (.doc, .xls or .ppt)" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", label: "a PNG image" };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { kind: "image", label: "a JPEG image" };
  if (startsWith(b, ascii("GIF8"))) return { kind: "image", label: "a GIF image" };
  if (startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8)) return { kind: "image", label: "a WebP image" };
  if (startsWith(b, ascii("ftyp"), 4)) return { kind: "media", label: "a video or image (MP4/HEIC) file" };
  if (startsWith(b, ascii("ID3"))) return { kind: "media", label: "an MP3 audio file" };
  if (startsWith(b, [0x1f, 0x8b])) return { kind: "archive", label: "a compressed (gzip) file" };
  if (startsWith(b, ascii("Rar!"))) return { kind: "archive", label: "a RAR archive" };
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { kind: "archive", label: "a 7-Zip archive" };
  if (startsWith(b, ascii("MZ"))) return { kind: "program", label: "a Windows program" };
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return { kind: "program", label: "a program file" };
  if (startsWith(b, ascii("{\\rtf"))) return { kind: "rtf", label: "a Rich Text (RTF) document" };
  return null;
}

/** PDF allows a little junk before the header; pdf.js accepts it within the first 1 KiB. */
function hasPdfHeader(b: Uint8Array): boolean {
  const limit = Math.min(b.length, 1024);
  for (let i = 0; i + 5 <= limit; i++) if (startsWith(b, ascii("%PDF-"), i)) return true;
  return false;
}

/**
 * Signature checks for PDF/DOCX. Needs only the first 1 KiB, so the browser can
 * run it before uploading. Returns null when the bytes match the extension.
 */
export function checkDocumentHead(name: string, head: Uint8Array): UploadError | null {
  const kind = FILE_KINDS[fileExtension(name)];
  const sig = detectSignature(head);
  if (kind === "pdf" && !hasPdfHeader(head)) {
    return uploadError("type_mismatch", { name, expected: "a PDF", detected: sig?.label ?? (looksLikeText(head) ? "plain text" : undefined) });
  }
  if (kind === "docx") {
    if (sig?.kind === "ole") return uploadError("legacy_doc", { name });
    if (sig?.kind !== "zip") {
      return uploadError("type_mismatch", { name, expected: "a Word (.docx) document", detected: sig?.label ?? (looksLikeText(head) ? "plain text" : undefined) });
    }
  }
  return null;
}

function looksLikeText(b: Uint8Array): boolean {
  if (b.length === 0) return false;
  let printable = 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    if (x === 9 || x === 10 || x === 13 || (x >= 32 && x < 127) || x >= 0x80) printable++;
  }
  return !b.includes(0) && printable / b.length > 0.95;
}

// ---------- Text files ----------

/**
 * Decode a .txt / .md file. Requires UTF-8 (a UTF-8 byte-order mark is fine);
 * rejects binary data and other encodings with an explanation.
 */
export function decodeTextFile(name: string, bytes: Uint8Array): { ok: true; text: string } | { ok: false; error: UploadError } {
  const sig = detectSignature(bytes);
  if (sig?.kind === "rtf") return { ok: false, error: uploadError("unsupported_type", { name, detected: sig.label }) };
  if (sig) return { ok: false, error: uploadError("binary_content", { name, detected: sig.label }) };
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    return { ok: false, error: uploadError("not_utf8", { name, encoding: "UTF-16 (“Unicode”)" }) };
  }
  if (bytes.includes(0)) return { ok: false, error: uploadError("binary_content", { name }) };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); // strips a UTF-8 BOM
  } catch {
    return { ok: false, error: uploadError("not_utf8", { name, encoding: guessLegacyEncoding(bytes) }) };
  }
  // Stray control characters: a few are tolerated (removed later), many mean binary data.
  let controls = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) || c === 127) controls++;
  }
  if (controls > Math.max(2, text.length * 0.001)) return { ok: false, error: uploadError("binary_content", { name }) };
  return { ok: true, text };
}

function guessLegacyEncoding(bytes: Uint8Array): string | undefined {
  // Bytes 0x80–0xFF that aren't valid UTF-8 usually mean Windows-1252 / Latin-1 (older Windows or Mac editors).
  return bytes.some((b) => b >= 0x80) ? "Windows-1252 / Latin-1 or another older encoding" : undefined;
}

// ---------- Text normalization + length ----------

/**
 * Normalization applied to every lesson source (files and pasted text) before
 * it is measured and stored. Implemented in lessonText.mjs so the parser worker
 * uses the very same function.
 */
export { normalizeLessonText };

/** Length rules for normalized lesson text. */
export function checkLessonTextLength(text: string, c: { name?: string; pasted?: boolean; atLeast?: boolean } = {}): UploadError | null {
  if (text.length < MIN_LESSON_TEXT_CHARS) return uploadError("too_short", { ...c, chars: text.length });
  if (text.length > MAX_LESSON_TEXT_CHARS) return uploadError("text_too_long", { ...c, chars: text.length });
  return null;
}

// ---------- Browser-side pre-check ----------

interface FileLike {
  name: string;
  size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * What the browser can check before uploading: name, size, signature, and for
 * text files encoding + length. The server repeats all of it (and parses).
 */
export async function precheckFile(file: FileLike): Promise<UploadError | null> {
  const meta = checkFileMeta(file.name, file.size);
  if (meta) return meta;
  const kind = FILE_KINDS[fileExtension(file.name)];
  if (kind === "text") {
    const decoded = decodeTextFile(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!decoded.ok) return decoded.error;
    return checkLessonTextLength(normalizeLessonText(decoded.text), { name: file.name });
  }
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return checkDocumentHead(file.name, head);
}

/** A submission is either one file or pasted text — never both. */
export function checkSubmission(hasFile: boolean, pastedText: string): UploadError | null {
  const text = normalizeLessonText(pastedText);
  if (hasFile && text.length > 0) return uploadError("file_and_text");
  if (!hasFile && text.length === 0) return uploadError("no_input");
  if (!hasFile) return checkLessonTextLength(text, { pasted: true });
  return null;
}
