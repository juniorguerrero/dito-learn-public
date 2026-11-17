import fs from "fs";
import path from "path";
import { dataRoot, writeJsonAtomic } from "./dataDir";
import { getEvents, getStudent, logEvent, safeId } from "./db";
import { getProject } from "./store";
import { OUTPUT_TYPES as OUTPUT_ORDER, flashcardDeckKey, isOutputType, uniqueCompletions, validateFlashcardState } from "./progressShared";
import { Classroom, LearningEvent, LessonProgress, OutputType, Project, Student } from "./types";

// Per-student, per-lesson learning progress: flashcard choices + position and
// which learning formats are completed. One JSON file per (student, lesson):
//   data/progress/<studentId>/<lessonId>.json
//
// Every exported mutation is fully synchronous (read -> check -> write with no
// await in between), so concurrent requests handled by the Node process cannot
// interleave and double-count a completion. Analytics additionally de-duplicate
// completion events on read, which also neutralizes legacy duplicates.

export class ProgressError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ProgressError";
  }
}

interface Ctx {
  student: Student;
  project: Project;
  classroomId: string;
}

const progressFile = (studentId: string, lessonId: string) =>
  path.join(dataRoot(), "progress", studentId, `${lessonId}.json`);

function resolveContext(studentId: unknown, lessonId: unknown): Ctx {
  if (typeof studentId !== "string" || !safeId(studentId)) throw new ProgressError(400, "A valid student_id is required");
  if (typeof lessonId !== "string" || !safeId(lessonId)) throw new ProgressError(400, "A valid lesson id is required");
  const student = getStudent(studentId);
  if (!student) throw new ProgressError(404, "Student not found");
  const project = getProject(lessonId);
  if (!project || !project.classroom_id) throw new ProgressError(404, "Lesson not found");
  if (!student.classroom_ids.includes(project.classroom_id)) {
    throw new ProgressError(403, "Join this lesson's class to save your progress");
  }
  return { student, project, classroomId: project.classroom_id };
}

function readStored(studentId: string, lessonId: string): LessonProgress | null {
  const f = progressFile(studentId, lessonId);
  if (!fs.existsSync(f)) return null;
  try {
    const p = JSON.parse(fs.readFileSync(f, "utf-8")) as LessonProgress;
    return { ...p, completed: p.completed || {}, flashcards: p.flashcards ?? null, flashcards_rev: p.flashcards_rev ?? 0 };
  } catch (err) {
    // Never let a damaged file take the lesson down; keep it aside for inspection.
    console.error("progress: unreadable file, starting fresh", f, err);
    try {
      fs.renameSync(f, `${f}.corrupt-${Date.now()}`);
    } catch {
      /* ignore */
    }
    return null;
  }
}

// Atomic write: readers never see a half-written file.
function writeStored(p: LessonProgress): void {
  writeJsonAtomic(progressFile(p.student_id, p.lesson_id), p);
}

/**
 * Starting point for a student who has no progress file yet. Completions that
 * were logged before progress was persisted (events.jsonl) are carried over so
 * the student and the teacher dashboard agree.
 */
function initialProgress(ctx: Ctx, events: LearningEvent[] = getEvents(ctx.classroomId)): LessonProgress {
  const completed: LessonProgress["completed"] = {};
  uniqueCompletions(events)
    .filter((e) => e.student_id === ctx.student.id && e.lesson_id === ctx.project.id && isOutputType(e.modality))
    .forEach((e) => {
      completed[e.modality!] = e.created_at;
    });
  const now = new Date().toISOString();
  return {
    student_id: ctx.student.id,
    lesson_id: ctx.project.id,
    classroom_id: ctx.classroomId,
    completed,
    flashcards: null,
    flashcards_rev: 0,
    created_at: now,
    updated_at: now,
  };
}

const load = (ctx: Ctx) => readStored(ctx.student.id, ctx.project.id) ?? initialProgress(ctx);

/** Drop flashcard state that was saved against a deck that has since been regenerated. */
function forClient(p: LessonProgress, project: Project): LessonProgress {
  if (p.flashcards && p.flashcards.deck_key !== flashcardDeckKey(project.outputs.flashcards)) {
    return { ...p, flashcards: null };
  }
  return p;
}

export function getLessonProgress(studentId: unknown, lessonId: unknown): LessonProgress {
  const ctx = resolveContext(studentId, lessonId);
  return forClient(load(ctx), ctx.project);
}

export interface FlashcardSaveResult {
  progress: LessonProgress;
  // false when a newer (or the same) revision was already stored: the snapshot
  // arrived late or was re-sent, and is ignored rather than rolling back.
  applied: boolean;
}

export function saveFlashcardProgress(
  studentId: unknown,
  lessonId: unknown,
  input: unknown,
  rev: unknown
): FlashcardSaveResult {
  const ctx = resolveContext(studentId, lessonId);
  if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev <= 0) {
    throw new ProgressError(400, "rev must be a positive integer");
  }
  const cards = ctx.project.outputs.flashcards?.cards || [];
  if (cards.length === 0) throw new ProgressError(409, "This lesson has no flashcards yet");

  const deckKey = flashcardDeckKey(ctx.project.outputs.flashcards);
  const sent = (input as { deck_key?: unknown } | null)?.deck_key;
  if (sent !== deckKey) throw new ProgressError(409, "The flashcard deck has changed; progress was reset");

  const checked = validateFlashcardState(input, cards.length);
  if (!checked.ok) throw new ProgressError(400, checked.error);

  // Read-compare-write is synchronous, so concurrent requests can't interleave here.
  const p = load(ctx);
  if (rev <= p.flashcards_rev) return { progress: forClient(p, ctx.project), applied: false };
  p.flashcards = { deck_key: deckKey, ...checked.value };
  p.flashcards_rev = rev;
  p.updated_at = new Date().toISOString();
  writeStored(p);
  return { progress: forClient(p, ctx.project), applied: true };
}

export interface CompletionResult {
  progress: LessonProgress;
  newly_completed: boolean;
  event: LearningEvent | null;
}

/**
 * Idempotently mark a learning format complete for a student's lesson.
 * Only the first call logs a `modality_complete` event (what teacher totals are
 * built from); repeats, retries and refreshes return the existing record.
 */
export function recordCompletion(studentId: unknown, lessonId: unknown, modality: unknown): CompletionResult {
  const ctx = resolveContext(studentId, lessonId);
  if (!isOutputType(modality)) throw new ProgressError(400, "A valid modality is required");

  const p = load(ctx);
  if (p.completed[modality]) return { progress: forClient(p, ctx.project), newly_completed: false, event: null };

  // Log first, then persist: if persisting fails a retry may log again, but
  // analytics count unique (student, lesson, modality) so totals stay correct.
  const event = logEvent({
    classroom_id: ctx.classroomId,
    student_id: ctx.student.id,
    student_name: ctx.student.name,
    lesson_id: ctx.project.id,
    type: "modality_complete",
    modality: modality as OutputType,
  });
  p.completed[modality] = event.created_at;
  p.updated_at = event.created_at;
  writeStored(p);
  return { progress: forClient(p, ctx.project), newly_completed: true, event };
}

// ---------- Professor view ----------

export interface LessonProgressSummary {
  lesson_id: string;
  title: string;
  // Archived lessons stay in the teacher's view (clearly labelled); students don't see them.
  archived: boolean;
  completed: OutputType[];
  flashcards: { known: number; review: number; total: number } | null;
  updated_at: string | null; // null = the student hasn't saved anything on this lesson
}

/**
 * Read-only summary of one student's saved progress on every lesson of a
 * classroom (what the student sees, so teacher and student views agree).
 * `events` should be the classroom's events; used for pre-existing completions.
 */
export function summarizeStudentProgress(student: Student, classroom: Classroom, events: LearningEvent[]): LessonProgressSummary[] {
  const mine = events.filter((e) => e.student_id === student.id);
  return classroom.lesson_ids
    .map((lessonId) => {
      const project = getProject(lessonId);
      if (!project) return null;
      const ctx: Ctx = { student, project, classroomId: classroom.id };
      const stored = readStored(student.id, lessonId);
      const p = forClient(stored ?? initialProgress(ctx, mine), project);
      const total = project.outputs.flashcards?.cards.length ?? 0;
      return {
        lesson_id: lessonId,
        title: project.blueprint.title,
        archived: Boolean(project.archived_at),
        completed: OUTPUT_ORDER.filter((m) => p.completed[m]),
        flashcards: p.flashcards && total > 0 ? { known: p.flashcards.known.length, review: p.flashcards.review.length, total } : null,
        updated_at: stored ? stored.updated_at : null,
      };
    })
    .filter((x): x is LessonProgressSummary => x !== null);
}
