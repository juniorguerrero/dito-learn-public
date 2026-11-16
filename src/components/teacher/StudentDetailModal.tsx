"use client";

import { useEffect, useState } from "react";
import type { StudentDetail } from "@/lib/platform";

const MODALITY_ICON: Record<string, string> = {
  mindmap: "🧠", flashcards: "🃏", story_slides: "📖", podcast: "🎙️",
  story_audio: "🔊", game: "🎮", video: "🎬", song: "🎵",
};

export default function StudentDetailModal({
  classroomId,
  studentId,
  onClose,
}: {
  classroomId: string;
  studentId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/classrooms/${classroomId}/students/${studentId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setData(j.error ? null : j))
      .finally(() => setLoading(false));
  }, [classroomId, studentId]);

  const maxOpens = data ? Math.max(1, ...data.modality_breakdown.map((m) => m.opens)) : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-3xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className="p-16 text-center text-slate-400">Loading student…</div>
        ) : !data ? (
          <div className="p-16 text-center text-slate-400">Couldn&apos;t load this student.</div>
        ) : (
          <div>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 rounded-t-3xl bg-gradient-to-r from-violet-600 to-fuchsia-600 p-6 text-white">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 text-xl font-bold">
                  {data.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-xl font-bold">{data.name}</h2>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {data.interests.map((i) => (
                      <span key={i} className="rounded-full bg-white/20 px-2 py-0.5 text-[11px]">{i}</span>
                    ))}
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="rounded-full bg-white/20 px-3 py-1 text-sm hover:bg-white/30">✕</button>
            </div>

            <div className="space-y-5 p-6">
              {/* Metric tiles */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  ["Lessons", data.totals.lessons_opened],
                  ["Opens", data.totals.opens],
                  ["Completed", data.totals.completions],
                  ["Questions", data.totals.questions],
                ].map(([label, val]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
                    <div className="text-2xl font-bold text-violet-700">{val}</div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
                  </div>
                ))}
              </div>

              {/* Prediction vs reality */}
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-violet-50 p-4 text-sm">
                <span>
                  We guessed <span className="font-semibold text-violet-700">{data.favorite_modality_guess ? MODALITY_ICON[data.favorite_modality_guess] + " " + data.favorite_modality_guess.replace("_", " ") : "—"}</span>
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  Actually learns most via{" "}
                  <span className="font-semibold text-fuchsia-700">
                    {data.actual_favorite ? MODALITY_ICON[data.actual_favorite.modality] + " " + data.actual_favorite.label : "no activity yet"}
                  </span>
                </span>
                {data.matches_guess !== null && (
                  <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${data.matches_guess ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {data.matches_guess ? "✓ matched prediction" : "↯ surprised us"}
                  </span>
                )}
              </div>

              {/* Modality breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-slate-600">How {data.name} learns</h3>
                {data.modality_breakdown.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400">No format activity yet.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {data.modality_breakdown.map((m) => (
                      <div key={m.modality}>
                        <div className="flex items-center justify-between text-sm">
                          <span>{MODALITY_ICON[m.modality]} {m.label}</span>
                          <span className="text-slate-400">{m.opens} opens · {m.completions} done</span>
                        </div>
                        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400" style={{ width: `${(m.opens / maxOpens) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Questions this student asked */}
              <div>
                <h3 className="text-sm font-semibold text-slate-600">What {data.name} has asked the AI tutor</h3>
                {data.questions.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400">No questions yet.</p>
                ) : (
                  <div className="nice-scroll mt-2 max-h-52 space-y-2 overflow-y-auto">
                    {data.questions.map((q, i) => (
                      <div key={i} className="rounded-xl bg-slate-50 p-3">
                        <p className="text-sm text-slate-700">“{q.text}”</p>
                        <p className="mt-1 text-[11px] text-slate-400">on {q.lesson_title}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Saved progress per lesson (what the student sees on their side) */}
              {data.progress.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-600">Progress by lesson</h3>
                  <div className="mt-2 space-y-1.5">
                    {data.progress.map((p) => (
                      <div key={p.lesson_id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm" data-testid="lesson-progress">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{p.title}</span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {p.completed.length} / {Object.keys(MODALITY_ICON).length} formats done
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {Object.entries(MODALITY_ICON).map(([m, icon]) => {
                            const done = p.completed.includes(m as (typeof p.completed)[number]);
                            return (
                              <span key={m} title={`${m.replace("_", " ")}${done ? " — done" : ""}`}
                                className={`rounded-md px-1.5 py-0.5 text-xs ${done ? "bg-emerald-100 text-emerald-700" : "bg-white text-slate-300 grayscale"}`}>
                                {icon}{done ? " ✓" : ""}
                              </span>
                            );
                          })}
                          {p.flashcards && (
                            <span className="ml-auto text-xs text-slate-500">
                              🃏 {p.flashcards.known}/{p.flashcards.total} known · {p.flashcards.review} to review
                            </span>
                          )}
                          {!p.flashcards && p.completed.length === 0 && (
                            <span className="ml-auto text-xs text-slate-400">Not started</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Per-lesson */}
              {data.lessons.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-600">Activity by lesson</h3>
                  <div className="mt-2 space-y-1.5">
                    {data.lessons.map((l) => (
                      <div key={l.lesson_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                        <span className="truncate pr-2">{l.title}</span>
                        <span className="shrink-0 text-slate-400">{l.opens} opens · {l.completions} done</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
