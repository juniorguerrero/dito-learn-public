import { NextResponse } from "next/server";
import { extractDocumentText, parseTimeoutMs, ParseOptions } from "./parse";
import {
  FILE_KINDS,
  FileKind,
  MAX_DOCX_DOCUMENT_XML_BYTES,
  MAX_REQUEST_BYTES,
  MIN_LESSON_TEXT_CHARS,
  UploadError,
  checkDocumentHead,
  checkFileMeta,
  checkLessonTextLength,
  checkSubmission,
  decodeTextFile,
  fileExtension,
  normalizeLessonText,
  uploadError,
} from "./uploadRules";

// Server-side intake for lesson material, shared by POST /api/upload and
// POST /api/classrooms/[id]/lessons. Everything here runs before a Learning
// Blueprint is built or anything is written, so a rejected upload can never
// leave a lesson record behind or change existing data.

export interface LessonSource {
  text: string; // normalized, within the lesson length limits
  fileName: string | null; // null = pasted text
  kind: FileKind | "pasted";
  form: FormData; // the other form fields (profile settings)
}

export type IntakeResult = { ok: true; source: LessonSource } | { ok: false; error: UploadError };

export function uploadErrorResponse(e: UploadError) {
  return NextResponse.json(
    { error: e.message, code: e.code },
    { status: e.status, headers: e.code === "busy" ? { "Retry-After": "5" } : undefined }
  );
}

/**
 * Read and validate an upload request. Size is enforced on the bytes actually
 * received (the declared Content-Length is only used to refuse early).
 */
export async function readLessonSubmission(req: Request, parseOptions?: ParseOptions): Promise<IntakeResult> {
  const fail = (error: UploadError): IntakeResult => ({ ok: false, error });

  const contentType = req.headers.get("content-type") || "";
  if (!/^multipart\/form-data|^application\/x-www-form-urlencoded/i.test(contentType)) return fail(uploadError("invalid_request"));

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return fail(uploadError("request_too_large"));

  const body = await readBodyCapped(req, MAX_REQUEST_BYTES);
  if (body === null) return fail(uploadError("request_too_large"));

  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    return fail(uploadError("invalid_request"));
  }

  // HTML forms send an empty, nameless file part when nothing was chosen: that's "no file".
  const files = form.getAll("file").filter(isFilePart).filter((f) => !(f.name === "" && f.size === 0));
  if (files.length > 1) return fail(uploadError("multiple_files"));
  const file = files[0] ?? null;
  const rawText = typeof form.get("text") === "string" ? (form.get("text") as string) : "";

  const shape = checkSubmission(file !== null, rawText);
  if (shape) return fail(shape);

  if (!file) return { ok: true, source: { text: normalizeLessonText(rawText), fileName: null, kind: "pasted", form } };

  const name = file.name || "upload";
  const processed = await processUploadedFile(name, new Uint8Array(await file.arrayBuffer()), parseOptions);
  if (!processed.ok) return fail(processed.error);
  return { ok: true, source: { text: processed.text, fileName: name, kind: processed.kind, form } };
}

function isFilePart(v: FormDataEntryValue): v is File {
  return typeof v === "object" && v !== null && typeof (v as File).arrayBuffer === "function";
}

async function readBodyCapped(req: Request, cap: number): Promise<ArrayBuffer | null> {
  if (!req.body) return new ArrayBuffer(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

export type FileResult = { ok: true; text: string; kind: FileKind } | { ok: false; error: UploadError };

/**
 * Validate one uploaded file by its actual bytes and extract its lesson text.
 * Exported for tests and fixture checks.
 */
export async function processUploadedFile(name: string, bytes: Uint8Array, parseOptions?: ParseOptions): Promise<FileResult> {
  const fail = (error: UploadError, detail?: string): FileResult => {
    if (detail) console.warn(`upload rejected (${error.code}) ${JSON.stringify(name)}: ${detail}`);
    return { ok: false, error };
  };

  const meta = checkFileMeta(name, bytes.byteLength);
  if (meta) return fail(meta);
  const kind = FILE_KINDS[fileExtension(name)];

  if (kind === "text") {
    const decoded = decodeTextFile(name, bytes);
    if (!decoded.ok) return fail(decoded.error);
    const text = normalizeLessonText(decoded.text);
    const len = checkLessonTextLength(text, { name });
    return len ? fail(len) : { ok: true, text, kind };
  }

  const head = checkDocumentHead(name, bytes.subarray(0, 1024));
  if (head) return fail(head);
  if (kind === "docx") {
    const zipProblem = inspectDocxZip(name, bytes);
    if (zipProblem) return fail(zipProblem.error, zipProblem.detail);
  }

  const expected = kind === "pdf" ? "a PDF" : "a Word document";
  const parsed = await extractDocumentText(kind, bytes, parseOptions);
  if (!parsed.ok) {
    switch (parsed.reason) {
      case "password":
        return fail(uploadError("password_protected", { name }), parsed.detail);
      case "timeout":
        return fail(uploadError("parse_timeout", { name, seconds: Math.max(1, Math.round((parseOptions?.timeoutMs ?? parseTimeoutMs()) / 1000)) }), parsed.detail);
      case "resources":
        return fail(uploadError("parse_resources", { name }), parsed.detail);
      case "busy":
        return fail(uploadError("busy"));
      default:
        return fail(uploadError("damaged_file", { name, expected }), parsed.detail);
    }
  }

  const text = normalizeLessonText(parsed.text);
  if (kind === "pdf" && text.length === 0) return fail(uploadError("no_text_layer", { name }));
  if (parsed.stoppedEarly) return fail(uploadError("text_too_long", { name, chars: text.length, atLeast: true }));
  if (text.length < MIN_LESSON_TEXT_CHARS && kind === "pdf" && (parsed.totalPages ?? 0) > 0 && text.length < 20 * (parsed.totalPages ?? 1)) {
    // A few stray characters (page numbers, a header) on otherwise image-only pages.
    return fail(uploadError("no_text_layer", { name }));
  }
  const len = checkLessonTextLength(text, { name });
  return len ? fail(len) : { ok: true, text, kind };
}

// ---------- DOCX container check (before handing it to the parser) ----------

/**
 * Reads the ZIP central directory: a .docx must be a complete ZIP with Word
 * parts, and its XML must not unpack to an unreasonable size (zip bombs).
 * Declared sizes can lie; the worker's memory limit is the backstop.
 */
export function inspectDocxZip(name: string, b: Uint8Array): { error: UploadError; detail: string } | null {
  const damaged = (detail: string) => ({ error: uploadError("damaged_file", { name, expected: "a Word document" }), detail });
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return damaged("zip end-of-central-directory record not found (truncated?)");
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    return { error: uploadError("docx_too_complex", { name }), detail: "zip64 archive" };
  }
  if (cdOffset + cdSize > eocd) return damaged("central directory outside the file");

  const names: string[] = [];
  let largestWordXml = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || view.getUint32(p, true) !== 0x02014b50) return damaged(`bad central directory entry ${n}`);
    const uncompressed = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    if (localOffset >= cdOffset) return damaged(`entry ${n} points outside the data area`);
    const entryName = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    names.push(entryName);
    if (/^word\/.*\.xml$/i.test(entryName)) largestWordXml = Math.max(largestWordXml, uncompressed);
    p += 46 + nameLen + extraLen + commentLen;
  }
  const hasContentTypes = names.includes("[Content_Types].xml");
  const hasWordPart = names.some((x) => /^word\/.*\.xml$/i.test(x));
  if (!hasContentTypes || !hasWordPart) {
    return { error: uploadError("type_mismatch", { name, expected: "a Word (.docx) document", detected: "a ZIP archive without Word content" }), detail: "no word/*.xml part" };
  }
  if (largestWordXml > MAX_DOCX_DOCUMENT_XML_BYTES) {
    return { error: uploadError("docx_too_complex", { name }), detail: `word xml unpacks to ${largestWordXml} bytes` };
  }
  return null;
}
