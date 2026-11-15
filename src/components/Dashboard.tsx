"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Project, OutputType } from "@/lib/types";
import BlueprintPanel from "./BlueprintPanel";
import MindMapTab from "./tabs/MindMapTab";
import FlashcardsTab from "./tabs/FlashcardsTab";
import StorySlidesTab from "./tabs/StorySlidesTab";
import PodcastTab from "./tabs/PodcastTab";
import StoryAudioTab from "./tabs/StoryAudioTab";
import GameTab from "./tabs/GameTab";
import VideoTab from "./tabs/VideoTab";
import SongTab from "./tabs/SongTab";
import GenerateMenu, { OUTPUT_ITEMS } from "./GenerateMenu";

const TABS: { key: OutputType | "blueprint"; label: string; icon: string }[] = [
  { key: "blueprint", label: "Blueprint", icon: "🧭" },
  { key: "mindmap", label: "Mind Map", icon: "🧠" },
  { key: "flashcards", label: "Flashcards", icon: "🃏" },
  { key: "story_slides", label: "Story Slides", icon: "📖" },
  { key: "podcast", label: "Podcast", icon: "🎙️" },
  { key: "story_audio", label: "Story Audio", icon: "🔊" },
  { key: "game", label: "Game", icon: "🎮" },
  { key: "video", label: "Video", icon: "🎬" },
  { key: "song", label: "Song", icon: "🎵" },
];

export type GenState = { loading: boolean; error: string | null };

export default function Dashboard({ initialProject }: { initialProject: Project }) {
  const [project, setProject] = useState<Project>(initialProject);
  const [tab, setTab] = useState<OutputType | "blueprint">("blueprint");
  const [genStates, setGenStates] = useState<Partial<Record<OutputType, GenState>>>({});
  const [bulk, setBulk] = useState<{ active: boolean; current: OutputType | null; doneCount: number; total: number }>(
    { active: false, current: null, doneCount: 0, total: 0 }
  );

  const generate = useCallback(
    async (type: OutputType, force = false): Promise<boolean> => {
      setGenStates((s) => ({ ...s, [type]: { loading: true, error: null } }));
      try {
        const res = await fetch(`/api/projects/${project.id}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, force }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Generation failed");
        setProject((p) => ({ ...p, outputs: { ...p.outputs, [type]: json.data } }));
        setGenStates((s) => ({ ...s, [type]: { loading: false, error: null } }));
        return true;
      } catch (err) {
        setGenStates((s) => ({
          ...s,
          [type]: { loading: false, error: err instanceof Error ? err.message : "Failed" },
        }));
        return false;
      }
    },
    [project.id]
  );

  // Generate every output one after another (sequential is gentler on Claude/RunPod rate limits).
  const generateAll = useCallback(async () => {
    const items = OUTPUT_ITEMS.map((i) => i.key);
    setBulk({ active: true, current: null, doneCount: 0, total: items.length });
    let done = 0;
    for (const type of items) {
      setBulk((b) => ({ ...b, current: type }));
      await generate(type, true);
      done += 1;
      setBulk((b) => ({ ...b, doneCount: done }));
    }
    setBulk({ active: false, current: null, doneCount: items.length, total: items.length });
  }, [generate]);

  const synthesizeAudio = useCallback(
    async (type: "podcast" | "story_audio") => {
      setGenStates((s) => ({ ...s, [type]: { loading: true, error: null } }));
      try {
        const res = await fetch(`/api/projects/${project.id}/audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Audio synthesis failed");
        setProject((p) => ({ ...p, outputs: { ...p.outputs, [type]: json.data } }));
        setGenStates((s) => ({ ...s, [type]: { loading: false, error: null } }));
      } catch (err) {
        setGenStates((s) => ({
          ...s,
          [type]: { loading: false, error: err instanceof Error ? err.message : "Failed" },
        }));
      }
    },
    [project.id]
  );

  const bp = project.blueprint;
  const doneSet = new Set(Object.keys(project.outputs) as OutputType[]);
  const busySet = new Set(
    (Object.keys(genStates) as OutputType[]).filter((k) => genStates[k]?.loading)
  );
  const anyBusy = bulk.active || busySet.size > 0;
  const currentLabel = bulk.current ? OUTPUT_ITEMS.find((i) => i.key === bulk.current)?.label : "";

  const backHref = project.classroom_id ? `/teacher/${project.classroom_id}` : "/upload";
  const backLabel = project.classroom_id ? "Back to classroom" : "Back to upload";

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <Link href={backHref} className="text-sm text-slate-400 hover:text-violet-600">← {backLabel}</Link>
      {/* Header */}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{bp.title}</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {project.source_name} · {bp.subject} · {bp.student_level} ·{" "}
            <span className="capitalize">{bp.quiz_difficulty}</span> difficulty
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden flex-wrap gap-1.5 sm:flex">
            {bp.learning_objectives.slice(0, 2).map((o, i) => (
              <span key={i} className="max-w-[200px] truncate rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                🎯 {o}
              </span>
            ))}
          </div>
          <GenerateMenu
            done={doneSet}
            busy={busySet}
            anyBusy={anyBusy}
            onGenerateOne={(t) => { setTab(t); generate(t, true); }}
            onGenerateAll={generateAll}
          />
        </div>
      </div>

      {/* Bulk generation progress */}
      {bulk.active && (
        <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-violet-700">
              🚀 Generating everything… {currentLabel && <span className="font-normal">— now: {currentLabel}</span>}
            </span>
            <span className="text-violet-500">
              {bulk.doneCount} / {bulk.total}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
              style={{ width: `${(bulk.doneCount / bulk.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="mt-5 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {TABS.map((t) => {
          const generated = t.key !== "blueprint" && Boolean(project.outputs[t.key as OutputType]);
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                tab === t.key ? "bg-violet-600 text-white shadow" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
              {generated && tab !== t.key && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="mt-5">
        {tab === "blueprint" && <BlueprintPanel project={project} />}
        {tab === "mindmap" && (
          <MindMapTab data={project.outputs.mindmap} state={genStates.mindmap} onGenerate={(f) => generate("mindmap", f)} />
        )}
        {tab === "flashcards" && (
          <FlashcardsTab data={project.outputs.flashcards} state={genStates.flashcards} onGenerate={(f) => generate("flashcards", f)} />
        )}
        {tab === "story_slides" && (
          <StorySlidesTab data={project.outputs.story_slides} state={genStates.story_slides} onGenerate={(f) => generate("story_slides", f)} />
        )}
        {tab === "podcast" && (
          <PodcastTab
            data={project.outputs.podcast}
            state={genStates.podcast}
            onGenerate={(f) => generate("podcast", f)}
            onSynthesize={() => synthesizeAudio("podcast")}
          />
        )}
        {tab === "story_audio" && (
          <StoryAudioTab
            data={project.outputs.story_audio}
            state={genStates.story_audio}
            onGenerate={(f) => generate("story_audio", f)}
            onSynthesize={() => synthesizeAudio("story_audio")}
          />
        )}
        {tab === "game" && (
          <GameTab data={project.outputs.game} state={genStates.game} onGenerate={(f) => generate("game", f)} />
        )}
        {tab === "video" && (
          <VideoTab data={project.outputs.video} state={genStates.video} onGenerate={(f) => generate("video", f)} />
        )}
        {tab === "song" && (
          <SongTab data={project.outputs.song} state={genStates.song} onGenerate={(f) => generate("song", f)} />
        )}
      </div>
    </main>
  );
}
