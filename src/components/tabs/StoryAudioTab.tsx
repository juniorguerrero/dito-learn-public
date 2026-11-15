"use client";

import { StoryAudioData } from "@/lib/types";
import { GenState } from "../Dashboard";
import TabShell from "../TabShell";

export default function StoryAudioTab({
  data,
  state,
  onGenerate,
  onSynthesize,
}: {
  data?: StoryAudioData;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
  onSynthesize: () => void;
}) {
  const cuesByLine = new Map<number, string[]>();
  data?.sound_cues.forEach((c) => {
    cuesByLine.set(c.at_line, [...(cuesByLine.get(c.at_line) || []), c.description]);
  });

  return (
    <TabShell
      title="Story Audio"
      description="A dramatic narrated audio story with sound-design cues — like an audiobook made from your document."
      emoji="🔊"
      hasData={Boolean(data)}
      state={state}
      onGenerate={onGenerate}
      generateLabel="Write Audio Story"
      loadingLabel="Composing your audio story…"
    >
      {data && (
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="font-bold">{data.title}</h2>
              <p className="text-xs text-slate-400">
                {data.narration_lines.length} narration lines · {data.sound_cues.length} sound cues
              </p>
            </div>
            {data.narration_audio_url ? (
              <audio controls src={data.narration_audio_url} className="h-10" />
            ) : (
              <button
                onClick={onSynthesize}
                className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2.5 font-semibold text-white shadow transition hover:opacity-95"
              >
                🎧 Narrate it
              </button>
            )}
          </div>

          <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {data.narration_lines.map((line, i) => (
              <div key={i}>
                {cuesByLine.get(i)?.map((cue, j) => (
                  <p key={j} className="my-2 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-medium italic text-indigo-500">
                    🎛️ [{cue}]
                  </p>
                ))}
                <p className="leading-relaxed text-slate-700">{line}</p>
              </div>
            ))}
          </div>

          <p className="mt-3 text-center text-xs text-slate-400">
            Sound cues are listed inline for the MVP — hook up MusicGen / Stable Audio on RunPod to render them.
          </p>
        </div>
      )}
    </TabShell>
  );
}
