"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Classroom, OutputType } from "@/lib/types";
import type { LessonSummary } from "@/lib/lessons";
import LessonUploader from "./LessonUploader";
import LessonManager from "./LessonManager";
import InsightsPanel from "./InsightsPanel";
import StudentDetailModal from "./StudentDetailModal";
import ProfessorChat from "./ProfessorChat";
import MessagesPanel from "./MessagesPanel";

interface StudentLite {
  id: string;
  name: string;
  interests: string[];
  favorite_modality_guess: OutputType | null;
}

export default function ClassroomWorkspace({
  classroom,
  lessons: initialActive,
  archivedLessons: initialArchived,
  students: initialStudents,
}: {
  classroom: Classroom;
  lessons: LessonSummary[];
  archivedLessons: LessonSummary[];
  students: StudentLite[];
}) {
  const router = useRouter();
  // All lessons by id; active/archived are derived in the classroom's original order.
  const byId = (list: LessonSummary[]) => Object.fromEntries(list.map((l) => [l.id, l]));
  const [lessonsById, setLessonsById] = useState<Record<string, LessonSummary>>(() => byId([...initialActive, ...initialArchived]));
  useEffect(() => {
    // New server data (e.g. after router.refresh()) is the source of truth.
    setLessonsById(byId([...initialActive, ...initialArchived]));
  }, [initialActive, initialArchived]);
  const ordered = useMemo(() => {
    const pos = new Map(classroom.lesson_ids.map((id, i) => [id, i]));
    return Object.values(lessonsById).sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity));
  }, [lessonsById, classroom.lesson_ids]);
  const lessons = ordered.filter((l) => !l.archived_at);
  const archivedLessons = ordered.filter((l) => l.archived_at);
  const onLessonChanged = useCallback(
    (l: LessonSummary) => {
      setLessonsById((m) => ({ ...m, [l.id]: l }));
      router.refresh(); // keep server-rendered views (counts, other pages' cache) in step
    },
    [router]
  );

  // Students can join while this page is open: keep the roster fresh.
  const [students, setStudents] = useState<StudentLite[]>(initialStudents);
  const [refreshing, setRefreshing] = useState(false);
  const refreshStudents = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/classrooms/${classroom.id}`, { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as { students?: (Omit<StudentLite, "favorite_modality_guess"> & { favorite_modality_guess?: OutputType | null })[] };
        if (j.students) setStudents(j.students.map((s) => ({ ...s, favorite_modality_guess: s.favorite_modality_guess ?? null })));
      }
    } catch {
      /* keep the current list */
    } finally {
      setRefreshing(false);
    }
  }, [classroom.id]);
  const [tab, setTab] = useState<"lessons" | "students" | "messages" | "insights" | "assistant">("lessons");
  const [copied, setCopied] = useState(false);
  const [openStudent, setOpenStudent] = useState<string | null>(null);
  useEffect(() => {
    if (tab === "students" || tab === "messages") refreshStudents();
  }, [tab, refreshStudents]);

  function copyCode() {
    navigator.clipboard?.writeText(classroom.join_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Link href="/teacher" className="text-sm text-slate-400 hover:text-violet-600">← All classrooms</Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{classroom.name}</h1>
          <p className="mt-0.5 text-slate-500">
            {classroom.subject} · {classroom.professor_name} · {students.length} students ·{" "}
            <span data-testid="lesson-count">{lessons.length} {lessons.length === 1 ? "lesson" : "lessons"}</span>
            {archivedLessons.length > 0 && <span data-testid="archived-count"> · {archivedLessons.length} archived</span>}
          </p>
        </div>
        <button
          onClick={copyCode}
          className="rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50 px-5 py-2.5 text-center transition hover:bg-violet-100"
        >
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-violet-400">Join code</span>
          <span className="font-mono text-xl font-bold tracking-widest text-violet-700">{classroom.join_code}</span>
          <span className="ml-2 text-xs text-violet-500">{copied ? "copied!" : "click to copy"}</span>
        </button>
      </div>

      <div className="mt-5 flex gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {[
          ["lessons", "📚 Lessons"],
          ["students", "🧑‍🎓 Students"],
          ["messages", "💬 Messages"],
          ["insights", "📊 Insights"],
          ["assistant", "🤖 Ask AI"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k as typeof tab)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              tab === k ? "bg-violet-600 text-white shadow" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "lessons" && (
          <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
            <LessonUploader classroomId={classroom.id} />
            <LessonManager classroomId={classroom.id} active={lessons} archived={archivedLessons} onLessonChanged={onLessonChanged} />
          </div>
        )}

        {tab === "students" && (
          <div>
          <div className="mb-3 flex justify-end">
            <button onClick={refreshStudents} disabled={refreshing} className="text-xs text-slate-400 hover:text-violet-600 disabled:opacity-50">
              {refreshing ? "Refreshing…" : "↻ refresh"}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {students.length === 0 && (
              <p className="col-span-full rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
                No students yet. Share join code <span className="font-mono font-bold">{classroom.join_code}</span>.
              </p>
            )}
            {students.map((s) => (
              <button
                key={s.id}
                onClick={() => setOpenStudent(s.id)}
                className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-fuchsia-300 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-fuchsia-100 font-bold text-fuchsia-600">
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <h3 className="font-semibold">{s.name}</h3>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.interests.slice(0, 4).map((i) => (
                    <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{i}</span>
                  ))}
                </div>
                {s.favorite_modality_guess && (
                  <p className="mt-2 text-xs text-slate-400">Likely loves: <span className="font-medium text-violet-600">{s.favorite_modality_guess.replace("_", " ")}</span></p>
                )}
                <p className="mt-2 text-xs font-medium text-fuchsia-500">View progress & questions →</p>
              </button>
            ))}
          </div>
          </div>
        )}

        {tab === "messages" && <MessagesPanel classroomId={classroom.id} students={students} />}
        {tab === "insights" && <InsightsPanel classroomId={classroom.id} />}
        {tab === "assistant" && <ProfessorChat classroomId={classroom.id} />}
      </div>

      {openStudent && (
        <StudentDetailModal classroomId={classroom.id} studentId={openStudent} onClose={() => setOpenStudent(null)} />
      )}
    </main>
  );
}
