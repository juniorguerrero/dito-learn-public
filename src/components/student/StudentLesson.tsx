"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Project, OutputType } from "@/lib/types";
import { getLocalStudent, track, LocalStudent } from "@/lib/studentClient";
import { GenState } from "../Dashboard";
import MindMapTab from "../tabs/MindMapTab";
import FlashcardsTab from "../tabs/FlashcardsTab";
import StorySlidesTab from "../tabs/StorySlidesTab";
import PodcastTab from "../tabs/PodcastTab";
import StoryAudioTab from "../tabs/StoryAudioTab";
import GameTab from "../tabs/GameTab";
import VideoTab from "../tabs/VideoTab";
import SongTab from "../tabs/SongTab";
import LessonChat from "./LessonChat";
import { useLessonProgress } from "./useLessonProgress";
import { useGameResults } from "./useGameResults";

const MODALITIES: { key: OutputType; label: string; icon: string; blurb: string }[] = [
  { key: "mindmap", label: "Mind Map", icon: "🧠", blurb: "See how it all connects" },
  { key: "flashcards", label: "Flashcards", icon: "🃏", blurb: "Quick self-quiz" },
  { key: "story_slides", label: "Story", icon: "📖", blurb: "Learn through a tale" },
  { key: "podcast", label: "Podcast", icon: "🎙️", blurb: "Listen to a chat" },
  { key: "story_audio", label: "Audio Story", icon: "🔊", blurb: "Narrated adventure" },
  { key: "game", label: "Game", icon: "🎮", blurb: "Play & win" },
  { key: "video", label: "Video", icon: "🎬", blurb: "Watch it unfold" },
  { key: "song", label: "Song", icon: "🎵", blurb: "Learn by singing" },
];

export default function StudentLesson({
  classroom,
  project: initialProject,
}: {
  classroom: { id: string; name: string };
  project: Project;
}) {
  const [project, setProject] = useState<Project>(initialProject);
  const [active, setActive] = useState<OutputType | null>(null);
  const [genStates, setGenStates] = useState<Partial<Record<OutputType, GenState>>>({});
  // undefined until the local identity has been read (avoids a flash of "not saved").
  const [student, setStudent] = useState<LocalStudent | null | undefined>(undefined);
  // Flashcard choices/position + completed formats, persisted per student + lesson.
  const progress = useLessonProgress(project.id, student);
  const completed = progress.completed;
  // Concept Quest attempts + results. A saved victory completes the game format
  // on the server (idempotent); mirror it here without another request.
  const gameResults = useGameResults(project.id, student, { onCompleted: progress.mergeCompleted });
  const openedRef = useRef(false);

  useEffect(() => {
    const s = getLocalStudent();
    setStudent(s);
    if (s && !openedRef.current) {
      openedRef.current = true;
      track({ classroom_id: classroom.id, student_id: s.id, student_name: s.name, lesson_id: project.id, type: "lesson_open" });
    }
  }, [classroom.id, project.id]);

  const generate = useCallback(
    async (type: OutputType, force = false): Promise<boolean> => {
      setGenStates((s) => ({ ...s, [type]: { loading: true, error: null } }));
      try {
        const res = await fetch(`/api/projects/${project.id}/generate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, force }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Generation failed");
        setProject((p) => ({ ...p, outputs: { ...p.outputs, [type]: json.data } }));
        setGenStates((s) => ({ ...s, [type]: { loading: false, error: null } }));
        return true;
      } catch (err) {
        setGenStates((s) => ({ ...s, [type]: { loading: false, error: err instanceof Error ? err.message : "Failed" } }));
        return false;
      }
    },
    [project.id]
  );

  const synthesizeAudio = useCallback(
    async (type: "podcast" | "story_audio") => {
      setGenStates((s) => ({ ...s, [type]: { loading: true, error: null } }));
      try {
        const res = await fetch(`/api/projects/${project.id}/audio`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Audio failed");
        setProject((p) => ({ ...p, outputs: { ...p.outputs, [type]: json.data } }));
        setGenStates((s) => ({ ...s, [type]: { loading: false, error: null } }));
      } catch (err) {
        setGenStates((s) => ({ ...s, [type]: { loading: false, error: err instanceof Error ? err.message : "Failed" } }));
      }
    },
    [project.id]
  );

  function openModality(type: OutputType) {
    setActive(type);
    if (student) track({ classroom_id: classroom.id, student_id: student.id, student_name: student.name, lesson_id: project.id, type: "modality_open", modality: type });
    if (!project.outputs[type]) generate(type);
  }

  // Idempotent on the server: a format counts once per student + lesson.
  function markComplete(type: OutputType) {
    void progress.complete(type);
  }

  const bp = project.blueprint;
  const doneCount = MODALITIES.filter((m) => completed.has(m.key)).length;
  const allDone = doneCount === MODALITIES.length;
  // The next format the student hasn't finished, starting after `after` (wraps around).
  function nextUp(after: OutputType): (typeof MODALITIES)[number] | null {
    const start = MODALITIES.findIndex((m) => m.key === after);
    for (let step = 1; step < MODALITIES.length; step++) {
      const m = MODALITIES[(start + step) % MODALITIES.length];
      if (!completed.has(m.key)) return m;
    }
    return null;
  }

  function renderActive() {
    if (!active) return null;
    const state = genStates[active];
    const shared = { state, onGenerate: (f?: boolean) => generate(active, f) };
    switch (active) {
      case "mindmap": return <MindMapTab data={project.outputs.mindmap} {...shared} />;
      case "flashcards":
        // Wait for the saved deck position so it isn't overwritten by a fresh one.
        if (progress.mode === "loading") {
          return <div className="rounded-2xl border border-slate-200 bg-white p-14 text-center text-sm text-slate-400">Restoring your progress…</div>;
        }
        return (
          <FlashcardsTab
            data={project.outputs.flashcards}
            {...shared}
            savedProgress={progress.flashcards}
            onProgressChange={progress.saveFlashcards}
            onDeckComplete={() => progress.complete("flashcards")}
          />
        );
      case "story_slides": return <StorySlidesTab data={project.outputs.story_slides} {...shared} />;
      case "podcast": return <PodcastTab data={project.outputs.podcast} {...shared} onSynthesize={() => synthesizeAudio("podcast")} />;
      case "story_audio": return <StoryAudioTab data={project.outputs.story_audio} {...shared} onSynthesize={() => synthesizeAudio("story_audio")} />;
      case "game": return <GameTab data={project.outputs.game} {...shared} results={gameResults} allowRegenerate={false} />;
      case "video": return <VideoTab data={project.outputs.video} {...shared} />;
      case "song": return <SongTab data={project.outputs.song} {...shared} />;
    }
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col px-4 py-4 lg:h-[calc(100vh-3.5rem)] lg:overflow-hidden">
      <div className="shrink-0">
        <Link href={`/student/${classroom.id}`} className="text-sm text-slate-400 hover:text-fuchsia-600">← {classroom.name}</Link>
        <div className="mt-2">
          <h1 className="text-2xl font-bold">{bp.title}</h1>
          <p className="mt-0.5 text-slate-500 line-clamp-2">{bp.summary}</p>
          <ProgressStatus mode={progress.mode} saveStatus={progress.saveStatus} notice={progress.notice} />
        </div>
      </div>

      <div className="mt-4 grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_360px]">
        <div className="nice-scroll lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          {!active ? (
            <div>
              {/* Lesson progress */}
              {allDone ? (
                <div className="mb-4 rounded-2xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 p-4" data-testid="lesson-progress">
                  <p className="text-lg font-bold text-emerald-800">🎉 Lesson complete!</p>
                  <p className="text-sm text-emerald-700">You finished all {MODALITIES.length} formats. Open any of them again to review.</p>
                </div>
              ) : (
                <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="lesson-progress">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-700">Your progress</span>
                    <span className="font-medium text-emerald-700">{doneCount} of {MODALITIES.length} formats done</span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all"
                      style={{ width: `${(doneCount / MODALITIES.length) * 100}%` }} />
                  </div>
                </div>
              )}
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">How do you want to learn this?</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {MODALITIES.map((m) => {
                  const done = completed.has(m.key);
                  return (
                  <button key={m.key} onClick={() => openModality(m.key)} data-done={done ? "true" : "false"}
                    className={`group relative rounded-2xl border-2 p-5 text-left shadow-sm transition hover:shadow-md ${
                      done ? "border-emerald-300 bg-emerald-50 hover:border-emerald-400" : "border-slate-200 bg-white hover:border-fuchsia-300"
                    }`}>
                    {done && (
                      <span className="absolute right-3 top-3 rounded-full bg-emerald-500 px-2.5 py-0.5 text-xs font-bold text-white shadow-sm">
                        ✓ Done
                      </span>
                    )}
                    <div className="text-3xl">{m.icon}</div>
                    <h3 className={`mt-2 font-bold ${done ? "text-emerald-800" : ""}`}>{m.label}</h3>
                    <p className={`text-xs ${done ? "text-emerald-600" : "text-slate-400"}`}>{m.blurb}</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      {done ? (
                        <span className="text-[10px] font-medium text-emerald-600">Open again to review</span>
                      ) : project.outputs[m.key] ? (
                        <span className="text-[10px] font-medium text-emerald-500">● ready</span>
                      ) : (
                        <span className="text-[10px] font-medium text-fuchsia-500">✨ generate on open</span>
                      )}
                    </div>
                  </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <button onClick={() => setActive(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm hover:border-fuchsia-300">
                  ← All formats
                </button>
                <div className="flex gap-1 overflow-x-auto">
                  {MODALITIES.map((m) => (
                    <button key={m.key} onClick={() => openModality(m.key)}
                      className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm transition ${
                        active === m.key ? "bg-fuchsia-600 text-white" : completed.has(m.key) ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "text-slate-400 hover:bg-slate-100"
                      }`}
                      title={completed.has(m.key) ? `${m.label} — done` : m.label}>
                      {m.icon}
                    </button>
                  ))}
                </div>
                <button onClick={() => markComplete(active)}
                  disabled={completed.has(active) || progress.pending.has(active) || progress.mode === "loading"}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-default ${
                    completed.has(active) ? "bg-emerald-100 text-emerald-700" : "bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60"
                  }`}>
                  {completed.has(active) ? "✓ Completed" : progress.pending.has(active) ? "Saving…" : "I got this ✓"}
                </button>
                {/* Finished this format: go straight to one not done yet */}
                {completed.has(active) && (() => {
                  const next = nextUp(active);
                  return next ? (
                    <button onClick={() => openModality(next.key)}
                      className="rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-fuchsia-700">
                      Next: {next.icon} {next.label} →
                    </button>
                  ) : (
                    <button onClick={() => setActive(null)}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
                      🎉 All formats done
                    </button>
                  );
                })()}
              </div>
              {renderActive()}
            </div>
          )}
        </div>

        {/* AI tutor chat — always visible, input pinned at the bottom (ChatGPT-style) */}
        <div className="h-[540px] lg:h-auto lg:min-h-0">
          <LessonChat
            lessonId={project.id}
            classroomId={classroom.id}
            student={student ?? null}
            lessonTitle={bp.title}
          />
        </div>
      </div>
    </main>
  );
}

function ProgressStatus({
  mode,
  saveStatus,
  notice,
}: {
  mode: ReturnType<typeof useLessonProgress>["mode"];
  saveStatus: ReturnType<typeof useLessonProgress>["saveStatus"];
  notice: string | null;
}) {
  let text: string;
  let tone = "text-slate-400";
  if (notice) {
    text = `⚠️ ${notice}`;
    tone = "text-amber-600";
  } else if (mode === "loading") {
    text = "Restoring your progress…";
  } else if (mode === "local") {
    text = "Progress isn't being saved.";
  } else if (saveStatus === "saving") {
    text = "Saving…";
  } else if (saveStatus === "error") {
    text = "⚠️ Couldn't save your latest changes — we'll retry when you continue.";
    tone = "text-amber-600";
  } else {
    text = "✓ Progress saved";
  }
  return (
    <p className="mt-1 text-xs">
      <span className={tone} role="status" aria-live="polite">{text}</span>
      {mode === "local" && (
        <Link href="/student" className="ml-2 font-semibold text-fuchsia-600 hover:underline">
          Join the class →
        </Link>
      )}
    </p>
  );
}
