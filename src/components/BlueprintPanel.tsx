"use client";

import { Project } from "@/lib/types";

export default function BlueprintPanel({ project }: { project: Project }) {
  const bp = project.blueprint;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Summary + objectives */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
        <h2 className="font-bold">📋 Summary</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{bp.summary}</p>
        <h3 className="mt-5 font-bold">🎯 Learning objectives</h3>
        <ul className="mt-2 space-y-1.5">
          {bp.learning_objectives.map((o, i) => (
            <li key={i} className="flex gap-2 text-sm text-slate-600">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-600">
                {i + 1}
              </span>
              {o}
            </li>
          ))}
        </ul>
      </div>

      {/* Meta */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold">⚙️ Personalization</h2>
        <dl className="mt-3 space-y-2.5 text-sm">
          {[
            ["Level", bp.student_level],
            ["Subject", bp.subject],
            ["Tone", bp.tone],
            ["Visual style", bp.visual_style],
            ["Quiz difficulty", bp.quiz_difficulty],
            ["Goal", project.student_profile.goal],
            ["Study time", project.student_profile.study_time],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{k}</dt>
              <dd className="capitalize text-slate-600">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Key concepts */}
      <div className="lg:col-span-3">
        <h2 className="mb-3 font-bold">💡 Key concepts ({bp.key_concepts.length})</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bp.key_concepts.map((kc) => (
            <div key={kc.name} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold text-violet-700">{kc.name}</h3>
              <p className="mt-1.5 text-sm text-slate-600 line-clamp-3">{kc.definition}</p>
              <p className="mt-2 text-xs text-slate-500 line-clamp-2">
                <span className="font-semibold text-emerald-600">Example: </span>
                {kc.example}
              </p>
              <p className="mt-1.5 text-xs text-slate-500 line-clamp-2">
                <span className="font-semibold text-amber-600">Watch out: </span>
                {kc.common_misconception}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Chapters */}
      <div className="lg:col-span-3">
        <h2 className="mb-3 font-bold">📚 Chapters</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {bp.chapters.map((ch, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold">
                {i + 1}. {ch.title}
              </h3>
              <p className="mt-1 text-sm text-slate-600 line-clamp-3">{ch.summary}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {ch.concepts.map((c) => (
                  <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
