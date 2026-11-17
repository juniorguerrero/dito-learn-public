import { getClassroom } from "./db";
import { getProject, updateProject } from "./store";
import { LessonPatchError, validateLessonPatch } from "./lessonRules";
import { Classroom, Project } from "./types";

// Teacher lesson management: edit title/summary, archive and restore.
//
// - Title and summary live in the lesson's blueprint, which every view (teacher,
//   student, analytics, tutor) already reads, so an edit shows up everywhere at
//   once. Nothing is regenerated: source text, generated formats, ids and every
//   student's progress stay as they are.
// - Archiving sets `archived_at` on the lesson. The lesson keeps its place in
//   classroom.lesson_ids, so restoring puts it back exactly where it was and
//   repeating archive/restore can never duplicate or reorder anything.
// - All writes go through updateProject (synchronous read-modify-write), so an
//   edit can't overwrite a format that is being generated at the same moment.

export const isArchived = (p: Pick<Project, "archived_at">) => Boolean(p.archived_at);

export interface LessonSummary {
  id: string;
  title: string;
  subject: string;
  summary: string;
  source_name: string;
  generated: string[];
  concept_count: number;
  created_at: string;
  archived_at: string | null;
  metadata_updated_at: string | null;
}

export function lessonSummary(p: Project): LessonSummary {
  return {
    id: p.id,
    title: p.blueprint.title,
    subject: p.blueprint.subject,
    summary: p.blueprint.summary,
    source_name: p.source_name,
    generated: Object.keys(p.outputs),
    concept_count: p.blueprint.key_concepts.length,
    created_at: p.created_at,
    archived_at: p.archived_at ?? null,
    metadata_updated_at: p.metadata_updated_at ?? null,
  };
}

/** The classroom's lessons in their original order, split into active and archived. */
export function classroomLessons(classroom: Classroom): { active: Project[]; archived: Project[] } {
  const all = classroom.lesson_ids
    .map((id) => getProject(id))
    .filter((p): p is Project => p !== null && p.classroom_id === classroom.id);
  return { active: all.filter((p) => !isArchived(p)), archived: all.filter(isArchived) };
}

export type LessonLookup =
  | { ok: true; classroom: Classroom; project: Project }
  | { ok: false; status: 404; code: "classroom_not_found" | "lesson_not_found"; message: string };

/** A lesson only counts as part of a classroom if both sides agree (no cross-classroom access). */
export function findClassroomLesson(classroomId: string, lessonId: string): LessonLookup {
  const classroom = getClassroom(classroomId);
  if (!classroom) return { ok: false, status: 404, code: "classroom_not_found", message: "Classroom not found" };
  const project = classroom.lesson_ids.includes(lessonId) ? getProject(lessonId) : null;
  if (!project || project.classroom_id !== classroom.id) {
    return { ok: false, status: 404, code: "lesson_not_found", message: "Lesson not found in this classroom" };
  }
  return { ok: true, classroom, project };
}

export type PatchResult =
  | { ok: true; lesson: LessonSummary; changed: boolean }
  | { ok: false; status: 400 | 404; code: LessonPatchError["code"] | "classroom_not_found" | "lesson_not_found"; message: string };

/**
 * Apply a teacher edit. Idempotent: archiving an archived lesson (or restoring an
 * active one, or saving unchanged text) writes nothing and keeps the original
 * archived_at / timestamps.
 */
export function patchLesson(classroomId: string, lessonId: string, body: unknown, now = () => new Date().toISOString()): PatchResult {
  const found = findClassroomLesson(classroomId, lessonId);
  if (!found.ok) return found;
  const checked = validateLessonPatch(body);
  if (!checked.ok) return { ok: false, status: 400, ...checked.error };
  const { title, summary, archived } = checked.patch;

  let changed = false;
  // Read-modify-write on the *current* file with no await in between.
  const saved = updateProjectIfChanged(lessonId, (p) => {
    const at = now();
    if (title !== undefined && title !== p.blueprint.title) {
      p.blueprint.title = title;
      p.metadata_updated_at = at;
      changed = true;
    }
    if (summary !== undefined && summary !== p.blueprint.summary) {
      p.blueprint.summary = summary;
      p.metadata_updated_at = at;
      changed = true;
    }
    if (archived === true && !isArchived(p)) {
      p.archived_at = at;
      changed = true;
    }
    if (archived === false && isArchived(p)) {
      delete p.archived_at;
      changed = true;
    }
    return changed;
  });
  if (!saved) return { ok: false, status: 404, code: "lesson_not_found", message: "Lesson not found in this classroom" };
  return { ok: true, lesson: lessonSummary(saved), changed };
}

/** Like updateProject, but skips the write entirely when `mutate` reports no change. */
function updateProjectIfChanged(id: string, mutate: (p: Project) => boolean): Project | null {
  const current = getProject(id);
  if (!current) return null;
  const probe = structuredClone(current);
  if (!mutate(probe)) return current;
  return updateProject(id, (p) => {
    mutate(p);
  });
}

export type StudentLessonView =
  | { kind: "lesson"; classroom: Classroom; project: Project }
  | { kind: "archived"; classroom: Classroom; title: string }
  | { kind: "not_found" };

/** What a student link /student/[classroomId]/[lessonId] should show. */
export function studentLessonView(classroomId: string, lessonId: string): StudentLessonView {
  const found = findClassroomLesson(classroomId, lessonId);
  if (!found.ok) {
    // Older lessons may exist without being listed; keep the previous rule for those.
    const classroom = getClassroom(classroomId);
    const project = getProject(lessonId);
    if (classroom && project && project.classroom_id === classroom.id) {
      return isArchived(project) ? { kind: "archived", classroom, title: project.blueprint.title } : { kind: "lesson", classroom, project };
    }
    return { kind: "not_found" };
  }
  if (isArchived(found.project)) return { kind: "archived", classroom: found.classroom, title: found.project.blueprint.title };
  return { kind: "lesson", classroom: found.classroom, project: found.project };
}
