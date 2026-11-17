"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LessonSummary } from "@/lib/lessons";
import { MAX_LESSON_SUMMARY_CHARS, MAX_LESSON_TITLE_CHARS, checkLessonSummary, checkLessonTitle, normalizeLessonSummary, normalizeLessonTitle } from "@/lib/lessonRules";

// Teacher's lesson list: edit title/summary, archive, restore.
// Lessons are always shown in the classroom's original order, so a restored
// lesson reappears exactly where it was.

async function patchLesson(classroomId: string, lessonId: string, body: Record<string, unknown>) {
  try {
    const res = await fetch(`/api/classrooms/${classroomId}/lessons/${lessonId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { lesson?: LessonSummary; error?: string } | null;
    if (res.ok && json?.lesson) return { ok: true as const, lesson: json.lesson };
    return { ok: false as const, message: json?.error || `Couldn't save (HTTP ${res.status}). Please try again.` };
  } catch {
    return { ok: false as const, message: "Couldn't reach the server. Check your connection and try again." };
  }
}

export default function LessonManager({
  classroomId,
  active,
  archived,
  onLessonChanged,
}: {
  classroomId: string;
  active: LessonSummary[];
  archived: LessonSummary[];
  onLessonChanged: (lesson: LessonSummary) => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const changed = (lesson: LessonSummary, message: string) => {
    onLessonChanged(lesson);
    setAnnouncement(message);
  };

  return (
    <div className="space-y-3">
      <p role="status" aria-live="polite" data-testid="lesson-announcement" className={announcement ? "rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700" : "sr-only"}>
        {announcement}
      </p>

      {active.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
          {archived.length ? "No active lessons — upload new material or restore an archived lesson." : "No lessons yet — upload your first piece of course material."}
        </p>
      )}
      <ul className="space-y-3" data-testid="active-lessons" aria-label="Active lessons">
        {active.map((l) => (
          <li key={l.id}>
            <LessonCard classroomId={classroomId} lesson={l} onChanged={changed} />
          </li>
        ))}
      </ul>

      {archived.length > 0 && (
        <section className="pt-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            aria-controls="archived-lessons"
            data-testid="toggle-archived"
            className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-left text-sm font-semibold text-amber-800 outline-none hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <span>🗄️ Archived lessons ({archived.length})</span>
            <span className="text-xs font-normal text-amber-700">{showArchived ? "Hide" : "Show"} · hidden from students, progress kept</span>
          </button>
          {showArchived && (
            <ul id="archived-lessons" className="mt-3 space-y-3" data-testid="archived-lessons" aria-label="Archived lessons">
              {archived.map((l) => (
                <li key={l.id}>
                  <LessonCard classroomId={classroomId} lesson={l} onChanged={changed} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

type Mode = "view" | "edit" | "confirm-archive";

function LessonCard({
  classroomId,
  lesson,
  onChanged,
}: {
  classroomId: string;
  lesson: LessonSummary;
  onChanged: (lesson: LessonSummary, message: string) => void;
}) {
  const isArchived = Boolean(lesson.archived_at);
  const [mode, setMode] = useState<Mode>("view");
  const [title, setTitle] = useState(lesson.title);
  const [summary, setSummary] = useState(lesson.summary);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mode === "edit") titleInput.current?.focus();
  }, [mode]);

  function startEdit() {
    setTitle(lesson.title);
    setSummary(lesson.summary);
    setError("");
    setMode("edit");
  }

  function cancel() {
    setMode("view");
    setError("");
    requestAnimationFrame(() => editButton.current?.focus());
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const problem = checkLessonTitle(title) || checkLessonSummary(summary);
    if (problem) {
      setError(problem.message);
      return;
    }
    const body: Record<string, string> = {};
    if (normalizeLessonTitle(title) !== lesson.title) body.title = title;
    if (normalizeLessonSummary(summary) !== lesson.summary) body.summary = summary;
    if (Object.keys(body).length === 0) {
      cancel();
      return;
    }
    setBusy(true);
    const r = await patchLesson(classroomId, lesson.id, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setMode("view");
    onChanged(r.lesson, `Saved “${r.lesson.title}”. Generated formats and student progress were kept.`);
    requestAnimationFrame(() => editButton.current?.focus());
  }

  async function setArchived(archived: boolean) {
    setBusy(true);
    setError("");
    const r = await patchLesson(classroomId, lesson.id, { archived });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setMode("view");
    onChanged(
      r.lesson,
      archived
        ? `Archived “${r.lesson.title}”. Students no longer see it; their progress is kept. Restore it from Archived lessons.`
        : `Restored “${r.lesson.title}”. Students see it again, with their progress.`
    );
  }

  const titleLen = normalizeLessonTitle(title).length;
  const summaryLen = normalizeLessonSummary(summary).length;

  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${isArchived ? "border-dashed border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white"}`}
      data-testid="lesson-card"
      data-lesson-id={lesson.id}
      data-archived={isArchived ? "true" : "false"}
    >
      {mode === "edit" ? (
        <form onSubmit={save} onKeyDown={(e) => e.key === "Escape" && cancel()} aria-label={`Edit ${lesson.title}`} data-testid="edit-lesson-form">
          <label className="block text-sm">
            <span className="font-medium text-slate-600">Title</span>
            <input
              ref={titleInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              aria-describedby={`title-count-${lesson.id}`}
              data-testid="edit-title"
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            <span id={`title-count-${lesson.id}`} className={`mt-0.5 block text-right text-[11px] ${titleLen > MAX_LESSON_TITLE_CHARS ? "font-semibold text-red-600" : "text-slate-400"}`}>
              {titleLen} / {MAX_LESSON_TITLE_CHARS}
            </span>
          </label>
          <label className="mt-2 block text-sm">
            <span className="font-medium text-slate-600">Summary</span>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              disabled={busy}
              rows={4}
              aria-describedby={`summary-count-${lesson.id}`}
              data-testid="edit-summary"
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            <span id={`summary-count-${lesson.id}`} className={`mt-0.5 block text-right text-[11px] ${summaryLen > MAX_LESSON_SUMMARY_CHARS ? "font-semibold text-red-600" : "text-slate-400"}`}>
              {summaryLen.toLocaleString("en-US")} / {MAX_LESSON_SUMMARY_CHARS.toLocaleString("en-US")}
            </span>
          </label>
          <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-500" data-testid="edit-note">
            Saving changes the title and summary that teachers and students see. Nothing is regenerated: the source material,
            {lesson.generated.length > 0 ? ` the ${lesson.generated.length} generated format${lesson.generated.length === 1 ? "" : "s"}` : " generated formats"} and
            students&apos; progress stay as they are.
            {lesson.generated.length > 0 &&
              " Formats that were already generated keep the wording they were made with (for example a title in the mind map's centre, the podcast intro or song lyrics)."}
          </p>
          {error && <p role="alert" className="mt-2 rounded-xl bg-red-50 p-2 text-sm text-red-600" data-testid="lesson-error">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={busy} data-testid="save-lesson"
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button type="button" onClick={cancel} disabled={busy} data-testid="cancel-edit"
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-bold" data-testid="lesson-title">
                {lesson.title}
                {isArchived && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-700">Archived</span>
                )}
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                {lesson.source_name} · {lesson.concept_count} concepts
                {lesson.metadata_updated_at && <> · edited {new Date(lesson.metadata_updated_at).toLocaleDateString()}</>}
                {isArchived && lesson.archived_at && <> · archived {new Date(lesson.archived_at).toLocaleDateString()}</>}
              </p>
            </div>
            <Link href={`/dashboard/${lesson.id}`}
              className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
              Open & generate →
            </Link>
          </div>
          <p className="mt-2 whitespace-pre-line text-sm text-slate-600 line-clamp-3" data-testid="lesson-summary">{lesson.summary}</p>
          <div className="mt-3 flex flex-wrap gap-1">
            {lesson.generated.length === 0 ? (
              <span className="text-xs text-amber-500">⚠ nothing generated yet — students see an empty lesson</span>
            ) : (
              lesson.generated.map((g) => (
                <span key={g} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                  ✓ {g.replace("_", " ")}
                </span>
              ))
            )}
          </div>

          {mode === "confirm-archive" ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="group" aria-label="Confirm archive" data-testid="confirm-archive">
              <p>
                Archive <span className="font-semibold">“{lesson.title}”</span>? Students won&apos;t see it in their lessons and links to it will show an
                “archived” notice. Anyone who has it open can still finish and save. Progress and generated formats are kept, and you can restore it any time.
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setArchived(true)} disabled={busy} data-testid="confirm-archive-button"
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                  {busy ? "Archiving…" : "Archive lesson"}
                </button>
                <button type="button" onClick={() => setMode("view")} disabled={busy}
                  className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <button ref={editButton} type="button" onClick={startEdit} disabled={busy} data-testid="edit-lesson"
                aria-label={`Edit title and summary of ${lesson.title}`}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-violet-300 hover:text-violet-700">
                ✏️ Edit
              </button>
              {isArchived ? (
                <button type="button" onClick={() => setArchived(false)} disabled={busy} data-testid="restore-lesson"
                  aria-label={`Restore ${lesson.title}`}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                  {busy ? "Restoring…" : "↩ Restore"}
                </button>
              ) : (
                <button type="button" onClick={() => setMode("confirm-archive")} disabled={busy} data-testid="archive-lesson"
                  aria-label={`Archive ${lesson.title}`}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-amber-300 hover:text-amber-700">
                  🗄️ Archive
                </button>
              )}
            </div>
          )}
          {error && <p role="alert" className="mt-2 rounded-xl bg-red-50 p-2 text-sm text-red-600" data-testid="lesson-error">{error}</p>}
        </>
      )}
    </div>
  );
}
