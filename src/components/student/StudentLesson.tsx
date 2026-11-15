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
  const [completed, setCompleted] = useState<Set<OutputType>>(new Set());
  const [student, setStudent] = useState<LocalStudent | null>(null);
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

  function markComplete(type: OutputType) {
    setCompleted((c) => new Set(c).add(type));
    if (student) track({ classroom_id: classroom.id, student_id: student.id, student_name: student.name, lesson_id: project.id, type: "modality_complete", modality: type });
  }

  const bp = project.blueprint;

  function renderActive() {
    if (!active) return null;
    const state = genStates[active];
    const shared = { state, onGenerate: (f?: boolean) => generate(active, f) };
    switch (active) {
      case "mindmap": return <MindMapTab data={project.outputs.mindmap} {...shared} />;
      case "flashcards": return <FlashcardsTab data={project.outputs.flashcards} {...shared} />;
      case "story_slides": return <StorySlidesTab data={project.outputs.story_slides} {...shared} />;
      case "podcast": return <PodcastTab data={project.outputs.podcast} {...shared} onSynthesize={() => synthesizeAudio("podcast")} />;
      case "story_audio": return <StoryAudioTab data={project.outputs.story_audio} {...shared} onSynthesize={() => synthesizeAudio("story_audio")} />;
      case "game": return <GameTab data={project.outputs.game} {...shared} />;
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
        </div>
      </div>

      <div className="mt-4 grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_360px]">
        <div className="nice-scroll lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          {!active ? (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">How do you want to learn this?</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {MODALITIES.map((m) => (
                  <button key={m.key} onClick={() => openModality(m.key)}
                    className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-fuchsia-300 hover:shadow-md">
                    <div className="text-3xl">{m.icon}</div>
                    <h3 className="mt-2 font-bold">{m.label}</h3>
                    <p className="text-xs text-slate-400">{m.blurb}</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      {project.outputs[m.key] ? (
                        <span className="text-[10px] font-medium text-emerald-500">● ready</span>
                      ) : (
                        <span className="text-[10px] font-medium text-fuchsia-500">✨ generate on open</span>
                      )}
                      {completed.has(m.key) && <span className="text-[10px] font-medium text-emerald-600">✓ done</span>}
                    </div>
                  </button>
                ))}
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
                      className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm transition ${active === m.key ? "bg-fuchsia-600 text-white" : "text-slate-400 hover:bg-slate-100"}`}
                      title={m.label}>
                      {m.icon}
                    </button>
                  ))}
                </div>
                <button onClick={() => markComplete(active)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    completed.has(active) ? "bg-emerald-100 text-emerald-700" : "bg-emerald-500 text-white hover:bg-emerald-600"
                  }`}>
                  {completed.has(active) ? "✓ Completed" : "I got this ✓"}
                </button>
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
            student={student}
            lessonTitle={bp.title}
          />
        </div>
      </div>
    </main>
  );
}
