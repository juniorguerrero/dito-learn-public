import { getClassroom, getStudent, listStudentsInClassroom } from "./db";
import { classroomLessons, findClassroomLesson } from "./lessons";
import { currentGameInfo, listGameVersions, readStudentAttempts } from "./gameAttempts";
import {
  AttemptDetail,
  GameVersionInfo,
  TeacherGameOverviewLesson,
  TeacherLessonGameResults,
  TeacherLessonInfo,
  TeacherStudentGameResults,
  attemptDetail,
  isFinished,
  summarizeAttempts,
} from "./gameResults";
import { Classroom, Project, Student } from "./types";

// Teacher views of Concept Quest results (read-only).
//
// - A lesson's results are only reachable through its own classroom (the
//   classroom must list the lesson and the lesson must belong to it), and a
//   student's only if they are enrolled in that classroom. Anything else is a
//   404, like the lesson-management routes.
// - Only finished attempts count (wins and game overs). In-progress and
//   interrupted attempts never appear in counts, latest results or best scores.
// - Archived lessons are included (teacher history); results are never
//   changed by edits, archiving, restoring or regeneration.
// - A student whose attempt file can't be read (damaged file, disk or
//   permission problem) is flagged as "results unavailable" and left out of
//   the totals, never shown as "not played"; the file is never touched.
// - There is no teacher login in this app (unchanged): like the other teacher
//   routes, these are open to anyone who can reach the server.

export class TeacherGameError extends Error {
  constructor(public status: 404 | 503, public code: string, message: string) {
    super(message);
    this.name = "TeacherGameError";
  }
}

const RESULTS_UNAVAILABLE = "This student's saved game results for this lesson can't be read right now (a storage problem). Nothing was changed.";

const lessonInfo = (p: Project): TeacherLessonInfo => ({ id: p.id, title: p.blueprint.title, archived: Boolean(p.archived_at) });
const byName = (a: Student, b: Student) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

function lookup(classroomId: string, lessonId: string): { classroom: Classroom; project: Project } {
  const found = findClassroomLesson(classroomId, lessonId);
  if (!found.ok) throw new TeacherGameError(404, found.code, found.message);
  return { classroom: found.classroom, project: found.project };
}

function enrolledStudent(classroom: Classroom, studentId: string): Student {
  const s = getStudent(studentId);
  if (!s || !s.classroom_ids.includes(classroom.id)) throw new TeacherGameError(404, "student_not_found", "Student not found in this classroom");
  return s;
}

/**
 * Number the lesson's game versions: stored versions (oldest first), then any
 * version seen in results without a stored copy, then the current version if
 * nobody has played it yet.
 */
export function gameVersionCatalog(lessonId: string, currentVersion: string | null, seen: string[] = []): GameVersionInfo[] {
  const list: { version: string; first_seen_at: string | null }[] = listGameVersions(lessonId).map((v) => ({ version: v.version, first_seen_at: v.created_at }));
  const has = (v: string) => list.some((x) => x.version === v);
  seen.forEach((v) => {
    if (!has(v)) list.push({ version: v, first_seen_at: null });
  });
  if (currentVersion && !has(currentVersion)) list.push({ version: currentVersion, first_seen_at: null });
  return list.map((x, i) => ({ ...x, number: i + 1, label: `Version ${i + 1}`, is_current: x.version === currentVersion }));
}

export function teacherLessonGameResults(classroomId: string, lessonId: string): TeacherLessonGameResults {
  const { classroom, project } = lookup(classroomId, lessonId);
  const game = currentGameInfo(project.outputs.game);
  const students = listStudentsInClassroom(classroom.id).sort(byName);
  const rows = students.map((s) => {
    const read = readStudentAttempts(s.id, project.id, classroom.id);
    const sum = summarizeAttempts(read.attempts, game);
    return {
      student_id: s.id,
      name: s.name,
      results_unavailable: read.unavailable,
      finished_count: sum.finished_count,
      victories: sum.best_by_version.reduce((n, v) => n + v.victories, 0),
      latest: sum.latest,
      best_by_version: sum.best_by_version,
    };
  });
  const versions = gameVersionCatalog(project.id, game.current_version, rows.flatMap((r) => r.best_by_version.map((b) => b.version)));
  return {
    lesson: lessonInfo(project),
    game,
    versions,
    totals: {
      students: rows.length,
      students_played: rows.filter((r) => r.finished_count > 0).length,
      finished_attempts: rows.reduce((n, r) => n + r.finished_count, 0),
      victories: rows.reduce((n, r) => n + r.victories, 0),
      students_unavailable: rows.filter((r) => r.results_unavailable).length,
    },
    students: rows,
  };
}

export function teacherStudentGameResults(classroomId: string, lessonId: string, studentId: string): TeacherStudentGameResults {
  const { classroom, project } = lookup(classroomId, lessonId);
  const student = enrolledStudent(classroom, studentId);
  const game = currentGameInfo(project.outputs.game);
  const read = readStudentAttempts(student.id, project.id, classroom.id);
  if (read.unavailable) throw new TeacherGameError(503, "results_unavailable", RESULTS_UNAVAILABLE);
  const summary = summarizeAttempts(read.attempts, game);
  return {
    lesson: lessonInfo(project),
    game,
    versions: gameVersionCatalog(project.id, game.current_version, summary.best_by_version.map((b) => b.version)),
    student: { id: student.id, name: student.name },
    summary,
  };
}

export function teacherAttemptDetail(classroomId: string, lessonId: string, studentId: string, attemptId: string): AttemptDetail {
  const { classroom, project } = lookup(classroomId, lessonId);
  const student = enrolledStudent(classroom, studentId);
  const read = readStudentAttempts(student.id, project.id, classroom.id);
  if (read.unavailable) throw new TeacherGameError(503, "results_unavailable", RESULTS_UNAVAILABLE);
  const a = read.attempts.find((x) => x.id === String(attemptId).toLowerCase());
  if (!a || !isFinished(a)) throw new TeacherGameError(404, "attempt_not_found", "No finished attempt with that id for this student and lesson");
  return attemptDetail(a, currentGameInfo(project.outputs.game).current_version);
}

/** Per lesson of the classroom (active and archived, in class order): who has finished games. */
export function teacherGameOverview(classroomId: string): { lessons: TeacherGameOverviewLesson[] } {
  const classroom = getClassroom(classroomId);
  if (!classroom) throw new TeacherGameError(404, "classroom_not_found", "Classroom not found");
  const { active, archived } = classroomLessons(classroom);
  const pos = new Map(classroom.lesson_ids.map((id, i) => [id, i]));
  const students = listStudentsInClassroom(classroom.id);
  const lessons = [...active, ...archived]
    .sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
    .map((p) => {
      const reads = students.map((s) => readStudentAttempts(s.id, p.id, classroom.id));
      const counts = reads.map((r) => r.attempts.filter(isFinished).length);
      return {
        ...lessonInfo(p),
        has_game: Boolean(p.outputs.game),
        students_played: counts.filter((n) => n > 0).length,
        finished_attempts: counts.reduce((a, b) => a + b, 0),
        students_unavailable: reads.filter((r) => r.unavailable).length,
      };
    });
  return { lessons };
}
