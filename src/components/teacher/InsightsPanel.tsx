"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClassroomAnalytics } from "@/lib/platform";

const MODALITY_ICON: Record<string, string> = {
  mindmap: "🧠", flashcards: "🃏", story_slides: "📖", podcast: "🎙️",
  story_audio: "🔊", game: "🎮", video: "🎬", song: "🎵",
};

export default function InsightsPanel({ classroomId }: { classroomId: string }) {
  const [data, setData] = useState<ClassroomAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/classrooms/${classroomId}/analytics`, { cache: "no-store" });
    setData(await res.json());
    setLoading(false);
  }, [classroomId]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">Loading insights…</div>;
  if (!data) return null;

  const maxOpens = Math.max(1, ...data.modality_opens.map((m) => m.opens));

  return (
    <div className="space-y-5">
      {/* Headline insight */}
      <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-600 to-fuchsia-600 p-6 text-white shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide opacity-80">💡 Key insight</span>
          <button onClick={load} className="text-xs opacity-70 hover:opacity-100">↻ refresh</button>
        </div>
        <p className="mt-2 text-lg font-bold leading-snug">{data.headline}</p>
        <div className="mt-3 flex gap-5 text-sm opacity-90">
          <span>🧑‍🎓 {data.student_count} students</span>
          <span>👀 {data.modality_opens.reduce((s, m) => s + m.opens, 0)} lesson opens</span>
          <span>✅ {data.completions} completed</span>
          <span>💬 {data.question_count} questions</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Modality popularity */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold">How your class learns</h3>
          <p className="text-xs text-slate-400">Opens per learning format (with completions)</p>
          <div className="mt-4 space-y-2.5">
            {data.modality_opens.map((m) => (
              <div key={m.modality}>
                <div className="flex items-center justify-between text-sm">
                  <span>{MODALITY_ICON[m.modality]} {m.label}</span>
                  <span className="text-slate-400">{m.opens} opens · {m.completions} done</span>
                </div>
                <div className="mt-1 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-all"
                    style={{ width: `${(m.opens / maxOpens) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Questions feed */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold">What students are asking</h3>
          <p className="text-xs text-slate-400">Live questions to the AI tutor</p>
          <div className="nice-scroll mt-3 max-h-72 space-y-2 overflow-y-auto">
            {data.questions.length === 0 && <p className="text-sm text-slate-400">No questions yet.</p>}
            {data.questions.map((q, i) => (
              <div key={i} className="rounded-xl bg-slate-50 p-3">
                <p className="text-sm text-slate-700">“{q.text}”</p>
                <p className="mt-1 text-[11px] text-slate-400">— {q.student_name} · {q.lesson_title}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Per-student table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold">Per-student activity</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2 pr-4 font-medium">Student</th>
                <th className="pb-2 pr-4 font-medium">Interests</th>
                <th className="pb-2 pr-4 font-medium">Opens</th>
                <th className="pb-2 pr-4 font-medium">Completed</th>
                <th className="pb-2 pr-4 font-medium">Questions</th>
                <th className="pb-2 font-medium">Learns best via</th>
              </tr>
            </thead>
            <tbody>
              {data.per_student.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-slate-400">No students yet.</td></tr>
              )}
              {data.per_student.map((s) => (
                <tr key={s.student_id} className="border-b border-slate-50">
                  <td className="py-2 pr-4 font-medium">{s.name}</td>
                  <td className="py-2 pr-4 text-slate-400">{s.interests.slice(0, 3).join(", ") || "—"}</td>
                  <td className="py-2 pr-4">{s.opens}</td>
                  <td className="py-2 pr-4">{s.completions}</td>
                  <td className="py-2 pr-4">{s.questions}</td>
                  <td className="py-2 font-medium text-violet-600">{s.favorite}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
