"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const STEPS = [
  "Parsing your document…",
  "Reading between the lines…",
  "Extracting key concepts…",
  "Designing your Learning Blueprint…",
  "Almost there — wiring up your dashboard…",
];

export default function UploadForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [gradeLevel, setGradeLevel] = useState("Middle school");
  const [goal, setGoal] = useState("");
  const [style, setStyle] = useState("Colorful & playful");
  const [studyTime, setStudyTime] = useState("30 minutes");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!file && text.trim().length < 50) {
      setError("Add a file or paste at least a paragraph of text.");
      return;
    }
    setLoading(true);
    setStep(0);
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500);

    try {
      const form = new FormData();
      if (file) form.append("file", file);
      form.append("text", text);
      form.append("grade_level", gradeLevel);
      form.append("goal", goal || "Understand the material deeply");
      form.append("preferred_style", style);
      form.append("study_time", studyTime);

      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      router.push(`/dashboard/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
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
      {/* File drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
        }}
        onClick={() => fileInput.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragOver ? "border-violet-400 bg-violet-50" : "border-slate-300 bg-white hover:border-violet-300"
        }`}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.docx,.doc,.txt,.md"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {file ? (
          <div>
            <p className="font-medium text-violet-700">📄 {file.name}</p>
            <p className="mt-1 text-xs text-slate-400">{(file.size / 1024).toFixed(0)} KB — click to change</p>
          </div>
        ) : (
          <div>
            <p className="font-medium">Drop your PDF, DOCX or TXT here</p>
            <p className="mt-1 text-sm text-slate-400">or click to browse</p>
          </div>
        )}
      </div>

      <div className="relative text-center text-xs font-medium uppercase tracking-wide text-slate-400">
        <span className="relative z-10 bg-slate-50 px-3">or paste text</span>
        <div className="absolute left-0 right-0 top-1/2 -z-0 h-px bg-slate-200" />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Paste chapter text, lecture notes, an article…"
        className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
      />

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

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3.5 font-semibold text-white shadow-lg shadow-violet-200 transition hover:opacity-95 active:scale-[0.99]"
      >
        ✨ Build my Learning Blueprint
      </button>
    </form>
  );
}
