"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateClassroom() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [professor, setProfessor] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/classrooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, subject, professor_name: professor, description }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      router.push(`/teacher/${json.classroom.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2.5 font-semibold text-white shadow-md shadow-violet-200 transition hover:opacity-95"
      >
        + New classroom
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => !saving && setOpen(false)}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold">New classroom</h2>
        <p className="text-sm text-slate-400">Students will join with an auto-generated code.</p>
        <div className="mt-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Classroom name (e.g. Biology 101)"
            className="w-full rounded-xl border border-slate-200 p-2.5 outline-none focus:border-violet-400" />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (e.g. Biology)"
            className="w-full rounded-xl border border-slate-200 p-2.5 outline-none focus:border-violet-400" />
          <input value={professor} onChange={(e) => setProfessor(e.target.value)} placeholder="Your name"
            className="w-full rounded-xl border border-slate-200 p-2.5 outline-none focus:border-violet-400" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Short description (optional)"
            className="w-full rounded-xl border border-slate-200 p-2.5 outline-none focus:border-violet-400" />
        </div>
        {error && <p className="mt-2 rounded-xl bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} disabled={saving} className="rounded-xl px-4 py-2 text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="rounded-xl bg-violet-600 px-5 py-2 font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
