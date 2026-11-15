"use client";

import { useRef, useState } from "react";
import { PodcastData } from "@/lib/types";
import { GenState } from "../Dashboard";
import TabShell from "../TabShell";

export default function PodcastTab({
  data,
  state,
  onGenerate,
  onSynthesize,
}: {
  data?: PodcastData;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
  onSynthesize: () => void;
}) {
  const [playingLine, setPlayingLine] = useState<number | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopFlag = useRef(false);

  const lines = data?.lines || [];
  const hasAudio = lines.some((l) => l.audio_url);

  function stop() {
    stopFlag.current = true;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingLine(null);
    setPlayingAll(false);
  }

  function playLine(i: number): Promise<void> {
    return new Promise((resolve) => {
      const url = lines[i]?.audio_url;
      if (!url) return resolve();
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingLine(i);
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  }

  async function playAll(from = 0) {
    stopFlag.current = false;
    setPlayingAll(true);
    for (let i = from; i < lines.length; i++) {
      if (stopFlag.current) break;
      await playLine(i);
    }
    setPlayingLine(null);
    setPlayingAll(false);
  }

  return (
    <TabShell
      title="Podcast"
      description="A two-voice teacher & student conversation about your material — the student even makes the classic mistakes so the teacher can correct them."
      emoji="🎙️"
      hasData={lines.length > 0}
      state={state}
      onGenerate={onGenerate}
      generateLabel="Write Podcast Script"
      loadingLabel="Recording the script…"
    >
      {data && (
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="font-bold">{data.episode_title}</h2>
              <p className="text-xs text-slate-400">{lines.length} lines · Teacher 🧑‍🏫 + Student 🧑‍🎓 · Kokoro TTS</p>
            </div>
            {hasAudio ? (
              playingAll ? (
                <button onClick={stop} className="rounded-xl bg-rose-500 px-5 py-2.5 font-semibold text-white shadow transition hover:bg-rose-600">
                  ⏹ Stop
                </button>
              ) : (
                <button onClick={() => playAll()} className="rounded-xl bg-violet-600 px-5 py-2.5 font-semibold text-white shadow transition hover:bg-violet-700">
                  ▶ Play episode
                </button>
              )
            ) : (
              <button
                onClick={onSynthesize}
                className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2.5 font-semibold text-white shadow transition hover:opacity-95"
              >
                🎧 Synthesize voices
              </button>
            )}
          </div>

          <div className="space-y-3">
            {lines.map((line, i) => {
              const isTeacher = line.speaker === "Teacher";
              return (
                <div key={i} className={`flex gap-3 ${isTeacher ? "" : "flex-row-reverse"}`}>
                  <div
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg ${
                      isTeacher ? "bg-violet-100" : "bg-emerald-100"
                    }`}
                  >
                    {isTeacher ? "🧑‍🏫" : "🧑‍🎓"}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-2xl border p-3.5 shadow-sm transition ${
                      playingLine === i
                        ? "border-violet-400 bg-violet-50 ring-2 ring-violet-200"
                        : isTeacher
                        ? "border-slate-200 bg-white"
                        : "border-emerald-200 bg-emerald-50/60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${isTeacher ? "text-violet-600" : "text-emerald-600"}`}>{line.speaker}</span>
                      {line.audio_url && (
                        <button
                          onClick={() => (playingLine === i ? stop() : (stopFlag.current = true, playLine(i).then(() => setPlayingLine(null))))}
                          className="text-xs text-slate-400 hover:text-violet-600"
                        >
                          {playingLine === i ? "⏸" : "▶"}
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-slate-700">{line.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </TabShell>
  );
}
