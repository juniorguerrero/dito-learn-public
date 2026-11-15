"use client";

import { useState } from "react";
import { SongSpecData } from "@/lib/types";
import { GenState } from "../Dashboard";
import TabShell from "../TabShell";

export default function SongTab({
  data,
  state,
  onGenerate,
}: {
  data?: SongSpecData;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
}) {
  const [rendering, setRendering] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [renderNote, setRenderNote] = useState("");

  // Prefer a persisted (pre-baked) track over anything rendered this session.
  const effectiveUrl = audioUrl || data?.audio_url || null;

  async function renderSong() {
    if (!data) return;
    setRendering(true);
    setRenderNote("");
    try {
      const res = await fetch("/api/generate/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: data.music_prompt, lyrics: data.lyrics, duration: 90 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Music generation failed");
      if (json.status === "mock_unavailable") {
        setRenderNote("No RUNPOD_MUSIC_ENDPOINT configured — connect ACE-Step or MusicGen to render the track.");
      } else if (json.audio_url) {
        setAudioUrl(json.audio_url);
      }
    } catch (err) {
      setRenderNote(err instanceof Error ? err.message : "Render failed");
    } finally {
      setRendering(false);
    }
  }

  return (
    <TabShell
      title="Song"
      description="A catchy study song — lyrics that encode the key concepts, plus a music prompt ready for ACE-Step or MusicGen."
      emoji="🎵"
      hasData={Boolean(data)}
      state={state}
      onGenerate={onGenerate}
      generateLabel="Write my Song"
      loadingLabel="Writing your study anthem…"
    >
      {data && (
        <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-[1fr_300px]">
          {/* Lyrics */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold">🎤 {data.song_title}</h2>
            <pre className="nice-scroll mt-4 max-h-[420px] overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
              {data.lyrics}
            </pre>
          </div>

          {/* Meta */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Genre</dt>
                  <dd className="font-medium">{data.genre}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Tempo</dt>
                  <dd className="font-medium">{data.tempo}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Learning hook</dt>
                  <dd className="rounded-xl bg-fuchsia-50 p-2.5 font-semibold text-fuchsia-700">🪝 {data.learning_hook}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Music prompt</dt>
                  <dd className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-500">{data.music_prompt}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {effectiveUrl ? (
                <audio controls src={effectiveUrl} className="w-full" />
              ) : (
                <button
                  onClick={renderSong}
                  disabled={rendering}
                  className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-2.5 font-semibold text-white shadow transition hover:opacity-95 disabled:opacity-50"
                >
                  {rendering ? "Composing… 🎧" : "🎶 Generate the track"}
                </button>
              )}
              {renderNote && <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-700">{renderNote}</p>}
            </div>
          </div>
        </div>
      )}
    </TabShell>
  );
}
