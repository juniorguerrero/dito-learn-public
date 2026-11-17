"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FileDropZone from "./FileDropZone";
import { MAX_LESSON_TEXT_CHARS, checkSubmission, normalizeLessonText } from "@/lib/uploadRules";
import { postLessonMaterial } from "@/lib/uploadClient";

const STEPS = [
  "Parsing your document…",
  "Reading between the lines…",
  "Extracting key concepts…",
  "Designing your Learning Blueprint…",
  "Almost there — wiring up your dashboard…",
];

export default function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [gradeLevel, setGradeLevel] = useState("Middle school");
  const [goal, setGoal] = useState("");
  const [style, setStyle] = useState("Colorful & playful");
  const [studyTime, setStudyTime] = useState("30 minutes");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  const textChars = normalizeLessonText(text).length;
  const both = file !== null && textChars > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const problem = checkSubmission(file !== null, text);
    if (problem) {
      setError(problem.message);
      return;
    }
    setLoading(true);
    setStep(0);
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500);

    try {
      const form = new FormData();
      if (file) form.append("file", file);
      else form.append("text", text);
      form.append("grade_level", gradeLevel);
      form.append("goal", goal || "Understand the material deeply");
      form.append("preferred_style", style);
      form.append("study_time", studyTime);

      const result = await postLessonMaterial<{ id: string }>("/api/upload", form);
      if (!result.ok) {
        setError(result.message);
        setLoading(false);
        return;
      }
      router.push(`/dashboard/${result.data.id}`);
    } finally {
      clearInterval(ticker);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-violet-200 bg-white p-10 text-center shadow-sm">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
        <p className="mt-5 font-semibold text-violet-700">{STEPS[step]}</p>
        <p className="mt-1 text-sm text-slate-400">Claude is building your Learning Blueprint — usually 15–30 seconds.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <FileDropZone file={file} onFileChange={setFile} onError={setError} />

      <div className="relative text-center text-xs font-medium uppercase tracking-wide text-slate-400">
        <span className="relative z-10 bg-slate-50 px-3">or paste text</span>
        <div className="absolute left-0 right-0 top-1/2 -z-0 h-px bg-slate-200" />
      </div>

      <div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          aria-label="Paste lesson text"
          aria-describedby="upload-text-count"
          placeholder="Paste chapter text, lecture notes, an article…"
          className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
        <p id="upload-text-count" className={`mt-1 text-right text-xs ${textChars > MAX_LESSON_TEXT_CHARS ? "font-semibold text-red-600" : "text-slate-400"}`}>
          {textChars.toLocaleString("en-US")} / {MAX_LESSON_TEXT_CHARS.toLocaleString("en-US")} characters
        </p>
        {both && (
          <p className="mt-1 rounded-xl bg-amber-50 p-2 text-xs text-amber-700" data-testid="both-inputs-note">
            You've added a file and pasted text — only one can be used. Remove the file or clear the text.
          </p>
        )}
      </div>

      {/* Student profile */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-600">Personalize it</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-500">Grade level</span>
            <select
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 outline-none focus:border-violet-400"
            >
              {["Elementary school", "Middle school", "High school", "College", "Adult learner"].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-500">Study time available</span>
            <select
              value={studyTime}
              onChange={(e) => setStudyTime(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 outline-none focus:border-violet-400"
            >
              {["15 minutes", "30 minutes", "1 hour", "2+ hours"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-500">Preferred style</span>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 outline-none focus:border-violet-400"
            >
              {["Colorful & playful", "Anime / manga", "Watercolor storybook", "Sci-fi & futuristic", "Minimal & clean", "Comic book"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-500">Learning goal (optional)</span>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Pass Friday's quiz on photosynthesis"
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 outline-none focus:border-violet-400"
            />
          </label>
        </div>
      </div>

      {error && (
        <p role="alert" data-testid="upload-error" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3.5 font-semibold text-white shadow-lg shadow-violet-200 transition hover:opacity-95 active:scale-[0.99]"
      >
        ✨ Build my Learning Blueprint
      </button>
    </form>
  );
}
