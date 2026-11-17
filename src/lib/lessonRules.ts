// Rules for teacher edits to a lesson's title/summary and archive state.
// Pure (no fs, no React): the edit form and the API use the same limits.

export const MAX_LESSON_TITLE_CHARS = 120;
export const MAX_LESSON_SUMMARY_CHARS = 1000;

/** Titles are one line: all whitespace (including line breaks) collapses to single spaces. */
export function normalizeLessonTitle(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

/** Summaries may have paragraphs: unify line endings, drop control characters, trim lines and ends. */
export function normalizeLessonSummary(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface LessonPatch {
  title?: string;
  summary?: string;
  archived?: boolean;
}

export type LessonPatchError = { code: "invalid_request" | "invalid_title" | "invalid_summary"; message: string };

const ALLOWED = new Set(["title", "summary", "archived"]);

export function checkLessonTitle(raw: string): LessonPatchError | null {
  const title = normalizeLessonTitle(raw);
  if (!title) return { code: "invalid_title", message: "The title can't be empty." };
  if (title.length > MAX_LESSON_TITLE_CHARS) {
    return { code: "invalid_title", message: `The title is ${title.length} characters; please keep it to ${MAX_LESSON_TITLE_CHARS} or fewer.` };
  }
  return null;
}

export function checkLessonSummary(raw: string): LessonPatchError | null {
  const summary = normalizeLessonSummary(raw);
  if (!summary) return { code: "invalid_summary", message: "The summary can't be empty." };
  if (summary.length > MAX_LESSON_SUMMARY_CHARS) {
    return {
      code: "invalid_summary",
      message: `The summary is ${summary.length.toLocaleString("en-US")} characters; please keep it to ${MAX_LESSON_SUMMARY_CHARS.toLocaleString("en-US")} or fewer.`,
    };
  }
  return null;
}

/** Validate a PATCH body. Unknown fields are rejected so typos never silently do nothing. */
export function validateLessonPatch(body: unknown): { ok: true; patch: LessonPatch } | { ok: false; error: LessonPatchError } {
  const fail = (code: LessonPatchError["code"], message: string) => ({ ok: false as const, error: { code, message } });
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid_request", "Send a JSON object with title, summary and/or archived.");
  const o = body as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !ALLOWED.has(k));
  if (unknown.length) return fail("invalid_request", `Unknown field(s): ${unknown.join(", ")}. Allowed: title, summary, archived.`);
  if (!("title" in o) && !("summary" in o) && !("archived" in o)) return fail("invalid_request", "Nothing to change: send title, summary and/or archived.");

  const patch: LessonPatch = {};
  if ("title" in o) {
    if (typeof o.title !== "string") return fail("invalid_title", "The title must be text.");
    const err = checkLessonTitle(o.title);
    if (err) return { ok: false, error: err };
    patch.title = normalizeLessonTitle(o.title);
  }
  if ("summary" in o) {
    if (typeof o.summary !== "string") return fail("invalid_summary", "The summary must be text.");
    const err = checkLessonSummary(o.summary);
    if (err) return { ok: false, error: err };
    patch.summary = normalizeLessonSummary(o.summary);
  }
  if ("archived" in o) {
    if (typeof o.archived !== "boolean") return fail("invalid_request", "archived must be true or false.");
    patch.archived = o.archived;
  }
  return { ok: true, patch };
}
