"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FileDropZone from "../FileDropZone";
import { MAX_LESSON_TEXT_CHARS, checkSubmission, normalizeLessonText } from "@/lib/uploadRules";
import { postLessonMaterial } from "@/lib/uploadClient";

export default function LessonUploader({ classroomId }: { classroomId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [grade, setGrade] = useState("High school");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState("");

  const textChars = normalizeLessonText(text).length;
  const both = file !== null && textChars > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreated("");
    const problem = checkSubmission(file !== null, text);
    if (problem) {
      setError(problem.message);
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      else form.append("text", text);
      form.append("grade_level", grade);
      const result = await postLessonMaterial<{ lesson: { id: string; title: string } }>(`/api/classrooms/${classroomId}/lessons`, form);
      if (!result.ok) {
        setError(result.message); // the chosen file stays selected so it can be retried or replaced
        return;
      }
      setFile(null);
      setText("");
      setCreated(result.data.lesson.title);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="lesson-uploader">
      <h3 className="font-bold">📤 Add a lesson</h3>
      <p className="mt-0.5 text-xs text-slate-400">Upload material — Claude builds the Learning Blueprint.</p>

      <div className="mt-3">
        <FileDropZone file={file} onFileChange={setFile} onError={setError} disabled={loading} compact />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        aria-label="Paste lesson material"
        aria-describedby="lesson-text-count"
        placeholder="…or paste material here"
        disabled={loading}
        className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-violet-400"
      />
      <p id="lesson-text-count" className={`text-right text-[11px] ${textChars > MAX_LESSON_TEXT_CHARS ? "font-semibold text-red-600" : "text-slate-400"}`}>
        {textChars.toLocaleString("en-US")} / {MAX_LESSON_TEXT_CHARS.toLocaleString("en-US")} characters
      </p>
      {both && (
        <p className="mt-1 rounded-xl bg-amber-50 p-2 text-xs text-amber-700" data-testid="both-inputs-note">
          You've added a file and pasted text — only one can be used. Remove the file or clear the text.
        </p>
      )}

      <label className="mt-3 block text-sm">
        <span className="text-slate-500">Baseline level</span>
        <select value={grade} onChange={(e) => setGrade(e.target.value)} disabled={loading} className="mt-1 w-full rounded-xl border border-slate-200 p-2 outline-none focus:border-violet-400">
          {["Elementary school", "Middle school", "High school", "College", "Adult learner"].map((g) => <option key={g}>{g}</option>)}
        </select>
      </label>

      {error && (
        <p role="alert" data-testid="upload-error" className="mt-2 rounded-xl bg-red-50 p-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {created && !error && (
        <p role="status" data-testid="upload-success" className="mt-2 rounded-xl bg-emerald-50 p-2 text-sm text-emerald-700">
          ✓ Lesson created: {created}
        </p>
      )}

      <button type="submit" disabled={loading}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-2.5 font-semibold text-white shadow transition hover:opacity-95 disabled:opacity-50">
        {loading ? "Building blueprint…" : "✨ Create lesson"}
      </button>
    </form>
  );
}
