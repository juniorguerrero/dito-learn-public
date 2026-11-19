"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AttemptDetail,
  GameVersionInfo,
  TeacherGameOverviewLesson,
  TeacherLessonGameResults,
  TeacherStudentGameResults,
  VersionBest,
} from "@/lib/gameResults";
import { FOCUS_RING, OutcomeLabel, ReviewPanel, when } from "../game/GameReview";

// Teacher's Concept Quest results for one lesson of the classroom: per student
// the latest result, best score per game version (current version highlighted)
// and the number of finished games, with drill-down into every finished game's
// answers. Only finished games count; unfinished ones never appear.
// Archived lessons are listed too (teacher history).

type View = { kind: "list" } | { kind: "student"; studentId: string } | { kind: "attempt"; studentId: string; attemptId: string };

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const j = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !j) throw new Error(j?.error || `Couldn't load game results (HTTP ${res.status}).`);
  return j;
}

/** Focus the visible element with this data-focus-key (table and card layouts both render one). */
function focusKey(key: string | null): boolean {
  if (!key) return false;
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`));
  const el = els.find((e) => e.offsetParent !== null);
  el?.focus();
  return Boolean(el);
}

function pickDefault(lessons: TeacherGameOverviewLesson[]): string {
  const active = lessons.filter((l) => !l.archived);
  return (
    active.find((l) => l.finished_attempts > 0)?.id ??
    active.find((l) => l.has_game)?.id ??
    active[0]?.id ??
    lessons.find((l) => l.finished_attempts > 0)?.id ??
    lessons[0]?.id ??
    ""
  );
}

const versionOf = (versions: GameVersionInfo[], v: string) => versions.find((x) => x.version === v);

function VersionChip({ info, compact = false }: { info?: GameVersionInfo; compact?: boolean }) {
  if (!info) return null;
  return (
    <span
      data-current={info.is_current ? "true" : "false"}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        info.is_current ? "bg-violet-600 text-white" : "bg-slate-200 text-slate-700"
      }`}
    >
      {compact ? `V${info.number}` : info.label}
      {info.is_current ? " · current" : ""}
    </span>
  );
}

function BestScores({ best, versions }: { best: VersionBest[]; versions: GameVersionInfo[] }) {
  if (best.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Best score by game version">
      {best.map((b) => {
        const info = versionOf(versions, b.version);
        return (
          <li
            key={b.version}
            data-current={b.is_current ? "true" : "false"}
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${b.is_current ? "border-2 border-violet-300 bg-violet-50" : "border border-slate-200 bg-slate-50 text-slate-600"}`}
          >
            <VersionChip info={info} compact />
            <span className="font-bold">⭐ {b.best_score}</span>
          </li>
        );
      })}
    </ul>
  );
}

function LatestCell({
  latest,
  versions,
  unavailable = false,
}: {
  latest: TeacherLessonGameResults["students"][number]["latest"];
  versions: GameVersionInfo[];
  unavailable?: boolean;
}) {
  if (unavailable) {
    return (
      <span className="text-amber-700" data-testid="results-unavailable">
        ⚠️ Saved results can&apos;t be read right now (storage problem; nothing was changed)
      </span>
    );
  }
  if (!latest) return <span className="text-slate-400">Not played yet</span>;
  return (
    <div>
      <div className="font-medium">
        <OutcomeLabel outcome={latest.outcome} /> · ⭐ {latest.score}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        {when(latest.finished_at)}
        {!latest.is_current_version && <VersionChip info={versionOf(versions, latest.version)} compact />}
      </div>
    </div>
  );
}

export default function GameResultsPanel({ classroomId }: { classroomId: string }) {
  const [overview, setOverview] = useState<TeacherGameOverviewLesson[] | null>(null);
  const [lessonId, setLessonId] = useState("");
  const [data, setData] = useState<TeacherLessonGameResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>({ kind: "list" });
  const returnTo = useRef<string | null>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    getJson<{ lessons: TeacherGameOverviewLesson[] }>(`/api/classrooms/${classroomId}/game-results`)
      .then((j) => {
        if (!live) return;
        setOverview(j.lessons);
        setLessonId((cur) => (cur && j.lessons.some((l) => l.id === cur) ? cur : pickDefault(j.lessons)));
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load game results"));
    return () => {
      live = false;
    };
  }, [classroomId, reload]);

  useEffect(() => {
    if (!lessonId) return;
    let live = true;
    setLoading(true);
    setError(null);
    getJson<TeacherLessonGameResults>(`/api/classrooms/${classroomId}/lessons/${lessonId}/game-results`)
      .then((j) => live && setData(j))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load game results"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [classroomId, lessonId, reload]);

  // Coming back to the list: focus the button that opened the student.
  useEffect(() => {
    if (view.kind === "list" && returnTo.current && data) {
      if (focusKey(returnTo.current)) returnTo.current = null;
    }
  }, [view, data]);

  const open = (v: View, from: string) => {
    returnTo.current = from;
    setView(v);
  };

  const active = overview?.filter((l) => !l.archived) ?? [];
  const archived = overview?.filter((l) => l.archived) ?? [];
  const optionLabel = (l: TeacherGameOverviewLesson) =>
    `${l.title}${!l.has_game ? " (no game yet)" : l.finished_attempts ? ` (${l.students_played} played)` : ""}`;

  return (
    <section aria-labelledby="game-results-title" data-testid="teacher-game-results" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="game-results-title" ref={listHeadingRef} tabIndex={-1} className="text-lg font-bold outline-none">
            🎮 Concept Quest results
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">Finished games only: wins and games that ran out of lives. Unfinished games are never counted.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col text-xs font-semibold text-slate-500 md:w-80 md:flex-none">
            Lesson
            <select
              value={lessonId}
              onChange={(e) => {
                // Data for another lesson is never shown (see the lesson id check below),
                // so nothing is cleared here: re-selecting the same lesson keeps its results.
                setView({ kind: "list" });
                setLessonId(e.target.value);
              }}
              data-testid="game-results-lesson"
              className={`mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800 ${FOCUS_RING}`}
            >
              {overview === null && <option value="">Loading lessons…</option>}
              {overview !== null && overview.length === 0 && <option value="">No lessons yet</option>}
              {active.length > 0 && (
                <optgroup label="Active lessons">
                  {active.map((l) => (
                    <option key={l.id} value={l.id}>{optionLabel(l)}</option>
                  ))}
                </optgroup>
              )}
              {archived.length > 0 && (
                <optgroup label="Archived lessons (hidden from students)">
                  {archived.map((l) => (
                    <option key={l.id} value={l.id}>{`${optionLabel(l)} · archived`}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <button
            onClick={() => setReload((n) => n + 1)}
            className={`shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:border-violet-300 ${FOCUS_RING}`}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          ⚠️ {error}
        </p>
      )}
      {!error && (loading || (lessonId && data?.lesson.id !== lessonId)) && (
        <p role="status" className="mt-6 text-center text-sm text-slate-400">Loading results…</p>
      )}
      {!error && overview !== null && overview.length === 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">No lessons yet — upload course material first.</p>
      )}

      {!loading && data && data.lesson.id === lessonId && (
        <div className="mt-4">
          {view.kind === "list" && <LessonResults data={data} onOpenStudent={(id) => open({ kind: "student", studentId: id }, `student-${id}`)} />}
          {view.kind === "student" && (
            <StudentResults
              classroomId={classroomId}
              lessonId={lessonId}
              studentId={view.studentId}
              returnKey={returnTo}
              onBack={() => setView({ kind: "list" })}
              onOpenAttempt={(attemptId) => open({ kind: "attempt", studentId: view.studentId, attemptId }, `attempt-${attemptId}`)}
            />
          )}
          {view.kind === "attempt" && (
            <AttemptReview
              classroomId={classroomId}
              lessonId={lessonId}
              studentId={view.studentId}
              attemptId={view.attemptId}
              versions={data.versions}
              studentName={data.students.find((s) => s.student_id === view.studentId)?.name ?? "Student"}
              onBack={() => setView({ kind: "student", studentId: view.studentId })}
            />
          )}
        </div>
      )}
    </section>
  );
}

function LessonResults({ data, onOpenStudent }: { data: TeacherLessonGameResults; onOpenStudent: (studentId: string) => void }) {
  const { lesson, game, versions, totals, students } = data;
  return (
    <div>
      <div className="rounded-2xl bg-slate-50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{lesson.title}</h3>
          {lesson.archived && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700" title="Hidden from students; results kept">
              Archived
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-600" data-testid="game-results-totals">
          {totals.students_played} of {totals.students} {totals.students === 1 ? "student" : "students"} played · {totals.finished_attempts} finished{" "}
          {totals.finished_attempts === 1 ? "game" : "games"} · {totals.victories} won
        </p>
        {totals.students_unavailable > 0 && (
          <p className="mt-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800" role="note" data-testid="game-results-unavailable-note">
            ⚠️ Saved results for {totals.students_unavailable} {totals.students_unavailable === 1 ? "student" : "students"} can&apos;t be read right now, so they
            aren&apos;t included above. Nothing was changed; their games are counted again once the files can be read.
          </p>
        )}
        {!game.has_game && <p className="mt-2 text-sm text-slate-500">This lesson has no game yet. It is built the first time a student opens it, or from the lesson page.</p>}
        {game.has_game && !game.playable && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800" role="note">
            ⚠️ The current game can&apos;t be played: {game.unplayable_reason} Regenerate it from the lesson page.
          </p>
        )}
        {versions.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Game versions</p>
            <ul className="mt-1 flex flex-wrap gap-2" data-testid="game-versions">
              {versions.map((v) => (
                <li key={v.version} data-current={v.is_current ? "true" : "false"} className={`rounded-xl px-2.5 py-1 text-xs ${v.is_current ? "border-2 border-violet-400 bg-white" : "border border-slate-200 bg-white text-slate-600"}`}>
                  <VersionChip info={v} /> {v.first_seen_at ? <span className="ml-1">first played {when(v.first_seen_at)}</span> : <span className="ml-1">not played yet</span>}
                </li>
              ))}
            </ul>
            {versions.length > 1 && <p className="mt-1 text-xs text-slate-500">Regenerating the game makes a new version with different questions, so best scores are kept per version.</p>}
          </div>
        )}
      </div>

      {students.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">No students in this class yet.</p>
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <table className="mt-4 hidden w-full text-left text-sm md:table" data-testid="game-results-table">
            <caption className="sr-only">Concept Quest results by student for {lesson.title}</caption>
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th scope="col" className="py-2 pr-3 font-semibold">Student</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Latest result</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Best score by version</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Finished games</th>
                <th scope="col" className="py-2 font-semibold"><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.student_id} className="border-b border-slate-100 align-top" data-testid="game-results-row" data-student={s.student_id}>
                  <th scope="row" className="py-3 pr-3 font-semibold">{s.name}</th>
                  <td className="py-3 pr-3"><LatestCell latest={s.latest} versions={versions} unavailable={s.results_unavailable} /></td>
                  <td className="py-3 pr-3"><BestScores best={s.best_by_version} versions={versions} /></td>
                  <td className="py-3 pr-3" data-testid="finished-count">
                    {s.results_unavailable ? "—" : <>{s.finished_count} <span className="text-xs text-slate-500">({s.victories} won)</span></>}
                  </td>
                  <td className="py-3 text-right">
                    {s.finished_count > 0 && (
                      <button
                        data-focus-key={`student-${s.student_id}`}
                        onClick={() => onOpenStudent(s.student_id)}
                        aria-label={`View ${s.name}'s games`}
                        className={`rounded-xl border border-violet-200 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 ${FOCUS_RING}`}
                      >
                        View games →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Phones: one card per student */}
          <ul className="mt-4 space-y-3 md:hidden" data-testid="game-results-cards" aria-label={`Concept Quest results by student for ${lesson.title}`}>
            {students.map((s) => (
              <li key={s.student_id} className="rounded-2xl border border-slate-200 p-3 text-sm" data-student={s.student_id}>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold">{s.name}</h4>
                  <span className="shrink-0 text-xs text-slate-500">
                    {s.results_unavailable ? "—" : `${s.finished_count} finished · ${s.victories} won`}
                  </span>
                </div>
                <div className="mt-2"><LatestCell latest={s.latest} versions={versions} unavailable={s.results_unavailable} /></div>
                {s.best_by_version.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-xs text-slate-500">Best score by version</p>
                    <BestScores best={s.best_by_version} versions={versions} />
                  </div>
                )}
                {s.finished_count > 0 && (
                  <button
                    data-focus-key={`student-${s.student_id}`}
                    onClick={() => onOpenStudent(s.student_id)}
                    aria-label={`View ${s.name}'s games`}
                    className={`mt-3 w-full rounded-xl border border-violet-200 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 ${FOCUS_RING}`}
                  >
                    View games →
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function StudentResults({
  classroomId,
  lessonId,
  studentId,
  returnKey,
  onBack,
  onOpenAttempt,
}: {
  classroomId: string;
  lessonId: string;
  studentId: string;
  returnKey: React.MutableRefObject<string | null>;
  onBack: () => void;
  onOpenAttempt: (attemptId: string) => void;
}) {
  const [data, setData] = useState<TeacherStudentGameResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    getJson<TeacherStudentGameResults>(`/api/classrooms/${classroomId}/lessons/${lessonId}/game-results/${studentId}`)
      .then((j) => live && setData(j))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load this student's games"));
    return () => {
      live = false;
    };
  }, [classroomId, lessonId, studentId]);

  // Arriving: focus the heading; coming back from a game review: focus that game's button.
  useEffect(() => {
    if (!data) return;
    const key = returnKey.current;
    if (key && key.startsWith("attempt-") && focusKey(key)) {
      returnKey.current = `student-${studentId}`;
      return;
    }
    headingRef.current?.focus();
  }, [data, returnKey, studentId]);

  const back = (
    <button onClick={onBack} className={`rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium hover:border-violet-300 ${FOCUS_RING}`}>
      ← All students
    </button>
  );
  if (error) {
    return (
      <div>
        {back}
        <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">⚠️ {error}</p>
      </div>
    );
  }
  if (!data) return <p role="status" className="text-center text-sm text-slate-400">Loading games…</p>;
  const { student, summary, versions, lesson } = data;

  return (
    <div data-testid="teacher-student-games">
      {back}
      <h3 ref={headingRef} tabIndex={-1} className="mt-3 text-lg font-bold outline-none">
        {student.name}: {lesson.title}
      </h3>
      <p className="text-sm text-slate-600">
        {summary.finished_count} finished {summary.finished_count === 1 ? "game" : "games"}
        {summary.latest && (
          <>
            {" "}· latest: <OutcomeLabel outcome={summary.latest.outcome} /> ⭐ {summary.latest.score}
          </>
        )}
      </p>

      {summary.best_by_version.length > 0 && (
        <div className="mt-3">
          <h4 className="text-sm font-semibold text-slate-600">Best score by game version</h4>
          <ul className="mt-1.5 space-y-1.5">
            {summary.best_by_version.map((b) => (
              <li
                key={b.version}
                data-current={b.is_current ? "true" : "false"}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${b.is_current ? "border-2 border-violet-300 bg-violet-50" : "border border-slate-200 bg-slate-50 text-slate-600"}`}
              >
                <VersionChip info={versionOf(versions, b.version)} />
                <span>
                  Best ⭐ <span className="font-bold">{b.best_score}</span> · {b.finished_attempts} {b.finished_attempts === 1 ? "game" : "games"} · {b.victories} won
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h4 className="mt-4 text-sm font-semibold text-slate-600">Finished games (newest first)</h4>
      {summary.attempts.length === 0 ? (
        <p className="mt-1 text-sm text-slate-400">No finished games.</p>
      ) : (
        <ul className="mt-1.5 divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid="teacher-attempts">
          {summary.attempts.map((a) => (
            <li key={a.id}>
              <button
                data-focus-key={`attempt-${a.id}`}
                onClick={() => onOpenAttempt(a.id)}
                aria-label={`Review game from ${when(a.finished_at)}: ${a.outcome === "victory" ? "quest complete" : "out of lives"}, score ${a.score}, ${versionOf(versions, a.version)?.label ?? "earlier version"}`}
                className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm hover:bg-slate-50 ${FOCUS_RING}`}
              >
                <span className="text-slate-500">{when(a.finished_at)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <OutcomeLabel outcome={a.outcome} />
                  <span className="font-semibold">⭐ {a.score}</span>
                  <span className="text-xs text-slate-500">{a.levels_cleared}/{a.levels_total} levels</span>
                  <VersionChip info={versionOf(versions, a.version)} compact />
                  <span className="text-xs font-semibold text-violet-600">Review →</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttemptReview({
  classroomId,
  lessonId,
  studentId,
  attemptId,
  versions,
  studentName,
  onBack,
}: {
  classroomId: string;
  lessonId: string;
  studentId: string;
  attemptId: string;
  versions: GameVersionInfo[];
  studentName: string;
  onBack: () => void;
}) {
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getJson<{ attempt: AttemptDetail }>(`/api/classrooms/${classroomId}/lessons/${lessonId}/game-results/${studentId}/attempts/${attemptId}`)
      .then((j) => live && setAttempt(j.attempt))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load this game"));
    return () => {
      live = false;
    };
  }, [classroomId, lessonId, studentId, attemptId]);

  if (error) {
    return (
      <div>
        <button onClick={onBack} className={`rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium ${FOCUS_RING}`}>← {studentName}&apos;s games</button>
        <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">⚠️ {error}</p>
      </div>
    );
  }
  if (!attempt) return <p role="status" className="text-center text-sm text-slate-400">Loading answers…</p>;
  const v = versionOf(versions, attempt.version);
  return (
    <div data-testid="teacher-attempt-review">
      {v && (
        <p className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          Played on <VersionChip info={v} />
        </p>
      )}
      <ReviewPanel data={attempt} onBack={onBack} backLabel={`${studentName}'s games`} perspective="teacher" studentName={studentName} />
    </div>
  );
}
