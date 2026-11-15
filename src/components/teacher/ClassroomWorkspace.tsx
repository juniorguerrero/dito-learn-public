"use client";

import { useState } from "react";
import Link from "next/link";
import { Classroom, OutputType } from "@/lib/types";
import LessonUploader from "./LessonUploader";
import InsightsPanel from "./InsightsPanel";
import StudentDetailModal from "./StudentDetailModal";
import ProfessorChat from "./ProfessorChat";
import MessagesPanel from "./MessagesPanel";

interface LessonLite {
  id: string;
  title: string;
  subject: string;
  summary: string;
  source_name: string;
  generated: string[];
  concept_count: number;
}
interface StudentLite {
  id: string;
  name: string;
  interests: string[];
  favorite_modality_guess: OutputType | null;
}

export default function ClassroomWorkspace({
  classroom,
  lessons,
  students,
}: {
  classroom: Classroom;
  lessons: LessonLite[];
  students: StudentLite[];
}) {
  const [tab, setTab] = useState<"lessons" | "students" | "messages" | "insights" | "assistant">("lessons");
  const [copied, setCopied] = useState(false);
  const [openStudent, setOpenStudent] = useState<string | null>(null);

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
            {classroom.subject} · {classroom.professor_name} · {students.length} students · {lessons.length} lessons
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
            <div className="space-y-3">
              {lessons.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
                  No lessons yet — upload your first piece of course material.
                </p>
              )}
              {lessons.map((l) => (
                <div key={l.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold">{l.title}</h3>
                      <p className="mt-0.5 text-xs text-slate-400">{l.source_name} · {l.concept_count} concepts</p>
                    </div>
                    <Link
                      href={`/dashboard/${l.id}`}
                      className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                    >
                      Open & generate →
                    </Link>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 line-clamp-2">{l.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {l.generated.length === 0 ? (
                      <span className="text-xs text-amber-500">⚠ nothing generated yet — students see an empty lesson</span>
                    ) : (
                      l.generated.map((g) => (
                        <span key={g} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                          ✓ {g.replace("_", " ")}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "students" && (
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
                <p className="mt-2 text-xs font-medium text-fuchsia-500">View metrics & questions →</p>
              </button>
            ))}
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
