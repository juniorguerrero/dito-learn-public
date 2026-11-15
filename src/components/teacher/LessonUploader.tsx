"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function LessonUploader({ classroomId }: { classroomId: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [grade, setGrade] = useState("High school");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!file && text.trim().length < 50) {
      setError("Add a file or paste some material.");
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      form.append("text", text);
      form.append("grade_level", grade);
      const res = await fetch(`/api/classrooms/${classroomId}/lessons`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setFile(null);
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-bold">📤 Add a lesson</h3>
      <p className="mt-0.5 text-xs text-slate-400">Upload material — Claude builds the Learning Blueprint.</p>

      <div
        onClick={() => fileInput.current?.click()}
        className="mt-3 cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-5 text-center transition hover:border-violet-300"
      >
        <input ref={fileInput} type="file" accept=".pdf,.docx,.doc,.txt,.md" className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)} />
        {file ? <p className="text-sm font-medium text-violet-700">📄 {file.name}</p> : <p className="text-sm text-slate-400">Drop / click: PDF, DOCX, TXT</p>}
      </div>

      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="…or paste material here"
        className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-violet-400" />

      <label className="mt-3 block text-sm">
        <span className="text-slate-500">Baseline level</span>
        <select value={grade} onChange={(e) => setGrade(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2 outline-none focus:border-violet-400">
          {["Elementary school", "Middle school", "High school", "College", "Adult learner"].map((g) => <option key={g}>{g}</option>)}
        </select>
      </label>

      {error && <p className="mt-2 rounded-xl bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={loading}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-2.5 font-semibold text-white shadow transition hover:opacity-95 disabled:opacity-50">
        {loading ? "Building blueprint…" : "✨ Create lesson"}
      </button>
    </form>
  );
}
